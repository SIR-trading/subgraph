import { Address, BigInt, BigDecimal } from "@graphprotocol/graph-ts";
import { Vault } from "../generated/schema";
import { ERC20 } from "../generated/VaultExternal/ERC20";
import { getTokenUsdPrice, priceToScaledBigInt, USDC, WETH } from "./helpers";

/**
 * Safely loads or creates a vault entity
 * Reduces code duplication across handlers
 */
export function loadOrCreateVault(vaultId: string): Vault {
  let vault = Vault.load(vaultId);
  if (!vault) {
    vault = new Vault(vaultId);
    vault.vaultId = vaultId;
    vault.collateralToken = "";
    vault.debtToken = "";
    vault.leverageTier = 0;
    vault.collateralSymbol = "";
    vault.debtSymbol = "";
    vault.apeAddress = Address.zero();
    vault.apeDecimals = 0;
    vault.totalValueUsd = BigInt.fromI32(0);
    vault.totalVolumeUsd = BigInt.fromI32(0);
    vault.sortKey = BigInt.fromI32(0);
    vault.totalValue = BigInt.fromI32(0);
    vault.teaCollateral = BigInt.fromI32(0);
    vault.apeCollateral = BigInt.fromI32(0);
    vault.lockedLiquidity = BigInt.fromI32(0);
    vault.taxAmount = BigInt.fromI32(0);
    vault.totalTea = BigInt.fromI32(0);
  }
  return vault;
}

/**
 * Calculates USD value of vault collateral with caching
 * Optimized to reduce redundant price calculations
 */
export function calculateVaultUsdValue(vault: Vault, blockNumber: BigInt): BigInt {
  const collateralToken = Address.fromString(vault.collateralToken);
  
  // Use cached price calculation
  const priceUsd = getTokenUsdPrice(collateralToken, blockNumber);
  const priceScaled = priceToScaledBigInt(priceUsd, 6); // USDC has 6 decimals
  
  if (collateralToken.equals(USDC)) {
    return vault.totalValue;
  }
  
  if (collateralToken.equals(WETH)) {
    return vault.totalValue
      .times(priceScaled)
      .div(BigInt.fromI32(10).pow(18));
  } else {
    const decimals = ERC20.bind(collateralToken).decimals();
    return vault.totalValue
      .times(priceScaled)
      .div(BigInt.fromI32(10).pow(decimals as u8));
  }
}


/**
 * Updates vault sort key based on volume and tax status
 * Centralizes sort key logic
 */
export function updateVaultSortKey(vault: Vault): void {
  if (vault.taxAmount.gt(BigInt.fromI32(0))) {
    vault.sortKey = BigInt.fromI32(10).pow(20).plus(vault.totalVolumeUsd);
  } else {
    vault.sortKey = vault.totalVolumeUsd;
  }
}
