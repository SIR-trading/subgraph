import { Address, BigInt, BigDecimal, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Vault, UsdRefreshState } from "../generated/schema";
import { ERC20 } from "../generated/VaultExternal/ERC20";
import { Vault as VaultContract, Vault__getReservesInputVaultParamsStruct as VaultContract__getReservesInputVaultParamsStruct } from "../generated/Vault/Vault";
import { getTokenUsdcPrice, USD_STABLECOIN, bigIntToHex } from "./helpers";
import { vaultAddress } from "./contracts";
import { updateVaultVolatility } from "./volatility-utils";

// Singleton ID for USD refresh state
const USD_REFRESH_STATE_ID = Bytes.fromUTF8("usd-refresh");

/**
 * Safely loads or creates a vault entity
 * Reduces code duplication across handlers
 */
export function loadOrCreateVault(vaultId: Bytes): Vault {
  let vault = Vault.load(vaultId);
  if (!vault) {
    vault = new Vault(vaultId);
    vault.exists = false;
    // These will be set properly when vault is initialized
    vault.collateralToken = Address.zero();
    vault.debtToken = Address.zero();
    vault.ape = Address.zero();
    vault.leverageTier = 0;
    vault.totalValueUsd = BigDecimal.fromString("0");
    vault.totalValue = BigInt.fromI32(0);
    vault.reserveLPers = BigInt.fromI32(0);
    vault.reserveApes = BigInt.fromI32(0);
    vault.lockedLiquidity = BigInt.fromI32(0);
    vault.tax = BigInt.fromI32(0);
    vault.rate = BigInt.fromI32(0);
    vault.teaSupply = BigInt.fromI32(0);
    vault.volatility = null;
    // Denormalized volatility for sorting
    vault.volatilityAnnual = BigDecimal.fromString("0");
    // LP APY EWMA state for sorting (stores continuous annualized rate)
    vault.lpApyEwma = BigDecimal.fromString("0");
    vault.lpApyLastTimestamp = BigInt.fromI32(0);
    // Volume EWMA state (annualized volume rates with 1d, 7d, 30d half-lives)
    vault.volumeUsdEwma1d = BigDecimal.fromString("0");
    vault.volumeUsdEwma7d = BigDecimal.fromString("0");
    vault.volumeUsdEwma30d = BigDecimal.fromString("0");
    vault.volumeLastTimestamp = BigInt.fromI32(0);
    vault.feesIds = [];
    // Will be set when vault is initialized
    vault.createdAt = BigInt.fromI32(0);
    vault.creator = Address.zero();
  }
  return vault;
}

/**
 * Calculates USD value of vault collateral with caching
 * Optimized to reduce redundant price calculations
 */
export function calculateVaultUsdcValue(vault: Vault, blockNumber: BigInt): BigDecimal {
  const collateralToken = Address.fromBytes(vault.collateralToken);

  if (collateralToken.equals(USD_STABLECOIN)) {
    // For USD stablecoin, totalValue is already in 6 decimals, convert to BigDecimal
    return vault.totalValue.toBigDecimal();
  }

  // Use full precision price calculation
  const priceUsd = getTokenUsdcPrice(collateralToken, blockNumber);

  const decimals = ERC20.bind(collateralToken).decimals();
  
  // Convert totalValue to BigDecimal and perform calculation in full precision
  const totalValueDecimal = vault.totalValue.toBigDecimal();
  const decimalsMultiplier = BigInt.fromI32(10).pow(decimals as u8).toBigDecimal();
  
  // Calculate in full precision: (totalValue * priceUsd) / 10^decimals
  const resultDecimal = totalValueDecimal.times(priceUsd).div(decimalsMultiplier);
  
  // Multiply by 10^6 to maintain USD scaling, then convert to BigInt
  const scaledResult = resultDecimal.times(BigDecimal.fromString("1000000"));

  // Return as BigDecimal (already in USD with 6 decimal precision)
  return scaledResult;
}

/**
 * Loads or creates the USD refresh state singleton
 */
export function loadOrCreateUsdRefreshState(): UsdRefreshState {
  let state = UsdRefreshState.load(USD_REFRESH_STATE_ID);
  if (!state) {
    state = new UsdRefreshState(USD_REFRESH_STATE_ID);
    state.nextVaultIdToRefresh = BigInt.fromI32(1);
    state.highestVaultId = BigInt.fromI32(0);
    state.save();
  }
  return state;
}

/**
 * Updates the highest vault ID when a new vault is created
 * Called from handleVaultInitialized
 */
export function updateHighestVaultId(vaultIdNum: BigInt): void {
  const state = loadOrCreateUsdRefreshState();
  if (vaultIdNum.gt(state.highestVaultId)) {
    state.highestVaultId = vaultIdNum;
    state.save();
  }
}

/**
 * Refreshes the USD value and reserves of the next vault in rotation
 * Called on each ReservesChanged event to keep stale vaults updated
 */
export function refreshNextStaleVault(blockNumber: BigInt, blockTimestamp: BigInt): void {
  const state = loadOrCreateUsdRefreshState();

  // No vaults exist yet
  if (state.highestVaultId.equals(BigInt.fromI32(0))) {
    return;
  }

  // Construct vault ID from the current index
  const vaultIdBytes = Bytes.fromHexString(bigIntToHex(state.nextVaultIdToRefresh));
  const vault = Vault.load(vaultIdBytes);

  // Only refresh if vault exists and is initialized
  if (vault && vault.exists) {
    // Fetch fresh reserves from contract
    const vaultContract = VaultContract.bind(Address.fromString(vaultAddress));

    // Build VaultParameters tuple for getReserves call
    const vaultParamsTuple = new ethereum.Tuple(3);
    vaultParamsTuple[0] = ethereum.Value.fromAddress(Address.fromBytes(vault.debtToken));
    vaultParamsTuple[1] = ethereum.Value.fromAddress(Address.fromBytes(vault.collateralToken));
    vaultParamsTuple[2] = ethereum.Value.fromI32(vault.leverageTier);

    const reservesResult = vaultContract.try_getReserves(
      changetype<VaultContract__getReservesInputVaultParamsStruct>(vaultParamsTuple)
    );

    if (!reservesResult.reverted) {
      vault.reserveApes = reservesResult.value.reserveApes;
      vault.reserveLPers = reservesResult.value.reserveLPers;
      vault.totalValue = vault.reserveApes.plus(vault.reserveLPers);
    }

    // Refresh USD value if vault has non-zero TVL
    if (vault.totalValue.gt(BigInt.fromI32(0))) {
      vault.totalValueUsd = calculateVaultUsdcValue(vault, blockNumber);
    }

    // Update volatility for this vault
    updateVaultVolatility(vault, blockTimestamp);

    vault.save();
  }

  // Advance to next vault, wrap to 1 when we exceed highest
  let nextId = state.nextVaultIdToRefresh.plus(BigInt.fromI32(1));
  if (nextId.gt(state.highestVaultId)) {
    nextId = BigInt.fromI32(1);
  }
  state.nextVaultIdToRefresh = nextId;
  state.save();
}