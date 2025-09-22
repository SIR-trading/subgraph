import { Address, BigInt, BigDecimal, Bytes } from "@graphprotocol/graph-ts";
import { Vault } from "../generated/schema";
import { ERC20 } from "../generated/VaultExternal/ERC20";
import { getTokenUsdcPrice, USDC } from "./helpers";

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
    vault.feesIds = [];
  }
  return vault;
}

/**
 * Calculates USDC value of vault collateral with caching
 * Optimized to reduce redundant price calculations
 */
export function calculateVaultUsdcValue(vault: Vault, blockNumber: BigInt): BigDecimal {
  const collateralToken = Address.fromBytes(vault.collateralToken);
  
  if (collateralToken.equals(USDC)) {
    // For USDC, totalValue is already in 6 decimals, convert to BigDecimal
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