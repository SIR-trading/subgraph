import { Address, BigInt, BigDecimal } from "@graphprotocol/graph-ts";
import { Vault } from "../generated/schema";
import { ERC20 } from "../generated/VaultExternal/ERC20";
import { getTokenUsdcPrice, USDC } from "./helpers";

/**
 * Safely loads or creates a vault entity
 * Reduces code duplication across handlers
 */
export function loadOrCreateVault(vaultId: string): Vault {
  let vault = Vault.load(vaultId);
  if (!vault) {
    vault = new Vault(vaultId);
    vault.vaultId = vaultId;
    vault.exists = false;
    vault.collateralToken = "";
    vault.debtToken = "";
    vault.leverageTier = 0;
    vault.collateralSymbol = "";
    vault.debtSymbol = "";
    vault.apeAddress = Address.zero();
    vault.apeDecimals = 0;
    vault.totalValueUsd = BigInt.fromI32(0);
    vault.totalValue = BigInt.fromI32(0);
    vault.teaCollateral = BigInt.fromI32(0);
    vault.apeCollateral = BigInt.fromI32(0);
    vault.lockedLiquidity = BigInt.fromI32(0);
    vault.taxAmount = BigInt.fromI32(0);
    vault.rate = BigInt.fromI32(0);
    vault.totalTea = BigInt.fromI32(0);
    vault.feesIds = [];
  }
  return vault;
}

/**
 * Calculates USDC value of vault collateral with caching
 * Optimized to reduce redundant price calculations
 */
export function calculateVaultUsdcValue(vault: Vault, blockNumber: BigInt): BigInt {
  const collateralToken = Address.fromString(vault.collateralToken);
  
  if (collateralToken.equals(USDC)) {
    return vault.totalValue;
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
  
  // Convert final result to BigInt
  return BigInt.fromString(scaledResult.truncate(0).toString());
}