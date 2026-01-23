import { Address, BigDecimal, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { TokenPairVolatility, Vault } from "../generated/schema";
import { oracleAddress } from "./contracts";
import { exp, sqrt, LN_1_0001, SCALE_2_42 } from "./math-utils";

// Constants for EWMA volatility calculation (30-day half-life)
const SECONDS_PER_YEAR = BigDecimal.fromString("31557600"); // 365.25 days
const LAMBDA = BigDecimal.fromString("8.445"); // ln(2) / (30/365.25) ≈ 8.445

/**
 * Oracle contract interface for fetching TWAP prices
 */
class Oracle extends ethereum.SmartContract {
  static bind(address: Address): Oracle {
    return new Oracle("Oracle", address);
  }

  try_getPrice(collateralToken: Address, debtToken: Address): ethereum.CallResult<BigInt> {
    let result = super.tryCall("getPrice", "getPrice(address,address):(int64)", [
      ethereum.Value.fromAddress(collateralToken),
      ethereum.Value.fromAddress(debtToken)
    ]);
    if (result.reverted) {
      return new ethereum.CallResult();
    }
    return ethereum.CallResult.fromValue(result.value[0].toBigInt());
  }
}

/**
 * Generates a deterministic ID for a token pair by sorting addresses
 * This ensures the same pair always gets the same ID regardless of order
 */
export function generateTokenPairId(tokenA: Bytes, tokenB: Bytes): Bytes {
  const aHex = tokenA.toHexString().toLowerCase();
  const bHex = tokenB.toHexString().toLowerCase();

  // Sort addresses to create deterministic ID
  if (aHex < bHex) {
    return Bytes.fromHexString(aHex + bHex.slice(2));
  } else {
    return Bytes.fromHexString(bHex + aHex.slice(2));
  }
}

/**
 * Loads or creates a TokenPairVolatility entity
 * Tokens are stored in sorted order (token0 < token1) to ensure consistent price direction
 */
export function loadOrCreateTokenPairVolatility(
  collateralToken: Bytes,
  debtToken: Bytes
): TokenPairVolatility {
  const pairId = generateTokenPairId(collateralToken, debtToken);
  let entity = TokenPairVolatility.load(pairId);

  if (!entity) {
    entity = new TokenPairVolatility(pairId);

    // Sort tokens: token0 has the smaller address
    const collateralHex = collateralToken.toHexString().toLowerCase();
    const debtHex = debtToken.toHexString().toLowerCase();
    if (collateralHex < debtHex) {
      entity.token0 = collateralToken;
      entity.token1 = debtToken;
    } else {
      entity.token0 = debtToken;
      entity.token1 = collateralToken;
    }

    entity.ewmaVarianceRate = BigDecimal.fromString("0");
    entity.lastPrice = BigInt.fromI32(0);
    entity.lastTimestamp = BigInt.fromI32(0);
    entity.volatilityAnnual = BigDecimal.fromString("0");
    entity.vaultCount = 0;
    entity.save();
  }

  return entity;
}

/**
 * Updates the EWMA volatility estimator with a new tick observation
 * Uses 30-day half-life, matching the LP APY estimator
 *
 * The Oracle returns prices in Q21.42 tick format:
 *   tickPriceX42 = log_1.0001(price) * 2^42
 *
 * Algorithm (30-day half-life):
 * 1. r_i = (tick_i - tick_{i-1}) × ln(1.0001) / 2^42    # log return
 * 2. v_i = r_i² / dt_i × SECONDS_PER_YEAR               # annualized variance rate for this observation
 * 3. α_i = 1 - exp(-λ × dt_i)                           # time-corrected weight (dt in years)
 * 4. v̂_i = (1 - α_i) × v̂_{i-1} + α_i × v_i             # EWMA of variance rate
 * 5. σ_annual = sqrt(v̂_i)                               # annualized volatility
 */
export function updateVolatility(
  entity: TokenPairVolatility,
  currentTick: BigInt,
  currentTimestamp: BigInt
): void {
  const zero = BigDecimal.fromString("0");
  const one = BigDecimal.fromString("1");

  // Skip if same timestamp as last update (prevents duplicates)
  if (currentTimestamp.equals(entity.lastTimestamp)) {
    return;
  }

  // If first observation, just store tick and timestamp
  if (entity.lastTimestamp.equals(BigInt.fromI32(0))) {
    entity.lastPrice = currentTick;
    entity.lastTimestamp = currentTimestamp;
    entity.save();
    return;
  }

  // Calculate time delta
  const dtSeconds = currentTimestamp.minus(entity.lastTimestamp).toBigDecimal();

  // Skip if time delta is zero or negative
  if (dtSeconds.le(zero)) {
    return;
  }

  const dtYears = dtSeconds.div(SECONDS_PER_YEAR);

  // Step 1: Calculate log return from tick difference
  // r = (currentTick - lastTick) × ln(1.0001) / 2^42
  const tickDiff = currentTick.minus(entity.lastPrice).toBigDecimal();
  const logReturn = tickDiff.times(LN_1_0001).div(SCALE_2_42);

  // Step 2: Calculate annualized variance rate for this observation
  // v = r² / dt × SECONDS_PER_YEAR = r² / dtYears
  const logReturnSquared = logReturn.times(logReturn);
  const varianceRate = logReturnSquared.div(dtYears);

  // Step 3: Time-corrected exponential weighting
  // α = 1 - exp(-λ × dt)
  const alpha = one.minus(exp(LAMBDA.neg().times(dtYears)));

  // Step 4: EWMA update
  // v̂ = (1 - α) × v̂_prev + α × v
  const newVarianceRate = one.minus(alpha).times(entity.ewmaVarianceRate).plus(alpha.times(varianceRate));

  // Step 5: Annualized volatility = sqrt(variance rate)
  const volatilityAnnual = sqrt(newVarianceRate);

  // Update entity
  entity.ewmaVarianceRate = newVarianceRate;
  entity.lastPrice = currentTick;
  entity.lastTimestamp = currentTimestamp;
  entity.volatilityAnnual = volatilityAnnual;
  entity.save();
}

/**
 * Updates volatility for a vault by fetching price from Oracle
 * Called from event handlers after vault state changes
 *
 * IMPORTANT: Always fetches price in canonical direction (token0, token1)
 * to ensure consistent price observations regardless of vault token ordering
 *
 * Also copies the volatilityAnnual to the vault for server-side sorting
 */
export function updateVaultVolatility(vault: Vault, timestamp: BigInt): void {
  // Skip if vault doesn't have a volatility entity linked
  if (vault.volatility === null) {
    return;
  }

  const volatilityEntity = TokenPairVolatility.load(vault.volatility as Bytes);
  if (!volatilityEntity) {
    return;
  }

  // Fetch current price from Oracle using canonical direction (token0, token1)
  // This ensures all vaults sharing this pair use the same price direction
  const oracle = Oracle.bind(Address.fromString(oracleAddress));
  const priceResult = oracle.try_getPrice(
    Address.fromBytes(volatilityEntity.token0),
    Address.fromBytes(volatilityEntity.token1)
  );

  if (priceResult.reverted) {
    return;
  }

  const currentPrice = priceResult.value;

  // Update the volatility estimator
  updateVolatility(volatilityEntity, currentPrice, timestamp);

  // Copy volatilityAnnual to vault for server-side sorting
  // vault.save() happens in the calling handler
  vault.volatilityAnnual = volatilityEntity.volatilityAnnual;
}

/**
 * Links a vault to its token pair volatility entity
 * Called during vault initialization
 */
export function linkVaultToVolatility(vault: Vault): void {
  const volatilityEntity = loadOrCreateTokenPairVolatility(
    vault.collateralToken,
    vault.debtToken
  );

  // Increment vault count for this pair
  volatilityEntity.vaultCount = volatilityEntity.vaultCount + 1;
  volatilityEntity.save();

  // Link vault to volatility entity
  vault.volatility = volatilityEntity.id;
}
