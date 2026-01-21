import { Address, BigDecimal, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { TokenPairVolatility, Vault } from "../generated/schema";
import { oracleAddress } from "./contracts";
import { ln, exp, sqrt, H_SECONDS, TAU } from "./math-utils";

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
 */
export function loadOrCreateTokenPairVolatility(
  collateralToken: Bytes,
  debtToken: Bytes
): TokenPairVolatility {
  const pairId = generateTokenPairId(collateralToken, debtToken);
  let entity = TokenPairVolatility.load(pairId);

  if (!entity) {
    entity = new TokenPairVolatility(pairId);
    entity.collateralToken = collateralToken;
    entity.debtToken = debtToken;
    entity.ewmaN = BigDecimal.fromString("0");
    entity.ewmaD = BigDecimal.fromString("0");
    entity.lastPrice = BigInt.fromI32(0);
    entity.lastTimestamp = BigInt.fromI32(0);
    entity.volatility30d = BigDecimal.fromString("0");
    entity.vaultCount = 0;
    entity.save();
  }

  return entity;
}

/**
 * Updates the EWMA volatility estimator with a new price observation
 *
 * Algorithm:
 * r_i = ln(P_i / P_{i-1})           # log return
 * dt_i = t_i - t_{i-1}              # time delta (seconds)
 * a_i = exp(-dt_i / tau)            # decay factor
 * N_i = a_i * N_{i-1} + r_i^2       # numerator
 * D_i = a_i * D_{i-1} + dt_i        # denominator
 * v_i = N_i / D_i                   # variance rate (per second)
 * Vol_30d_i = sqrt(v_i * H)         # 30-day volatility
 */
export function updateVolatility(
  entity: TokenPairVolatility,
  currentPrice: BigInt,
  currentTimestamp: BigInt
): void {
  const zero = BigDecimal.fromString("0");

  // Skip if price is zero or negative
  if (currentPrice.le(BigInt.fromI32(0))) {
    return;
  }

  // Skip if same timestamp as last update (prevents duplicates)
  if (currentTimestamp.equals(entity.lastTimestamp)) {
    return;
  }

  // If first observation, just store price and timestamp
  if (entity.lastPrice.equals(BigInt.fromI32(0)) || entity.lastTimestamp.equals(BigInt.fromI32(0))) {
    entity.lastPrice = currentPrice;
    entity.lastTimestamp = currentTimestamp;
    entity.save();
    return;
  }

  // Calculate time delta in seconds
  const dt = currentTimestamp.minus(entity.lastTimestamp);
  const dtDecimal = dt.toBigDecimal();

  // Skip if time delta is zero or negative
  if (dt.le(BigInt.fromI32(0))) {
    return;
  }

  // Calculate log return: r = ln(P_current / P_previous)
  const priceRatio = currentPrice.toBigDecimal().div(entity.lastPrice.toBigDecimal());
  const logReturn = ln(priceRatio);

  // Calculate decay factor: a = exp(-dt / tau)
  const decayExponent = dtDecimal.div(TAU).neg();
  const decayFactor = exp(decayExponent);

  // Update EWMA numerator: N = a * N_prev + r^2
  const logReturnSquared = logReturn.times(logReturn);
  const newN = decayFactor.times(entity.ewmaN).plus(logReturnSquared);

  // Update EWMA denominator: D = a * D_prev + dt
  const newD = decayFactor.times(entity.ewmaD).plus(dtDecimal);

  // Calculate variance rate and 30-day volatility
  let volatility30d = zero;
  if (newD.gt(zero)) {
    // v = N / D (variance per second)
    const varianceRate = newN.div(newD);

    // Vol_30d = sqrt(v * H)
    const varianceH = varianceRate.times(H_SECONDS);
    volatility30d = sqrt(varianceH);
  }

  // Update entity
  entity.ewmaN = newN;
  entity.ewmaD = newD;
  entity.lastPrice = currentPrice;
  entity.lastTimestamp = currentTimestamp;
  entity.volatility30d = volatility30d;
  entity.save();
}

/**
 * Updates volatility for a vault by fetching price from Oracle
 * Called from event handlers after vault state changes
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

  // Fetch current price from Oracle
  const oracle = Oracle.bind(Address.fromString(oracleAddress));
  const priceResult = oracle.try_getPrice(
    Address.fromBytes(vault.collateralToken),
    Address.fromBytes(vault.debtToken)
  );

  if (priceResult.reverted) {
    return;
  }

  const currentPrice = priceResult.value;

  // Update the volatility estimator
  updateVolatility(volatilityEntity, currentPrice, timestamp);
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
