import { BigDecimal, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Vault, VolumeStats } from "../generated/schema";
import { exp } from "./math-utils";

// Constants for EWMA volume calculation
const SECONDS_PER_YEAR = BigDecimal.fromString("31557600"); // 365.25 days

// Decay constants (lambda = ln(2) / half-life in years)
// 1-day half-life: ln(2) / (1/365.25) = 253.35
export const LAMBDA_1D = BigDecimal.fromString("253.35");
// 7-day half-life: ln(2) / (7/365.25) = 36.19
export const LAMBDA_7D = BigDecimal.fromString("36.19");
// 30-day half-life: ln(2) / (30/365.25) = 8.445
export const LAMBDA_30D = BigDecimal.fromString("8.445");

// Singleton ID for VolumeStats
const VOLUME_STATS_ID = Bytes.fromUTF8("volume-stats");

/**
 * Loads or creates the VolumeStats singleton entity
 */
export function loadOrCreateVolumeStats(): VolumeStats {
  let stats = VolumeStats.load(VOLUME_STATS_ID);
  if (!stats) {
    stats = new VolumeStats(VOLUME_STATS_ID);
    stats.totalVolumeUsd1d = BigDecimal.fromString("0");
    stats.totalVolumeUsd7d = BigDecimal.fromString("0");
    stats.totalVolumeUsd30d = BigDecimal.fromString("0");
    stats.lastTimestamp = BigInt.fromI32(0);
    stats.save();
  }
  return stats;
}

/**
 * Calculates a single EWMA update for volume.
 *
 * Algorithm:
 *   v_i = volume / dt_years                    # annualized volume rate
 *   alpha = 1 - exp(-lambda * dt_years)        # time-corrected weight
 *   ewma_new = (1 - alpha) * ewma_prev + alpha * v_i
 *
 * @param prevEwma Previous EWMA value
 * @param volumeUsd Volume in USD (scaled by 10^6)
 * @param dtYears Time delta in years
 * @param lambda Decay constant for the desired half-life
 * @returns New EWMA value
 */
function calculateEwmaUpdate(
  prevEwma: BigDecimal,
  volumeUsd: BigDecimal,
  dtYears: BigDecimal,
  lambda: BigDecimal
): BigDecimal {
  const zero = BigDecimal.fromString("0");
  const one = BigDecimal.fromString("1");

  // Skip if no time has passed
  if (dtYears.le(zero)) {
    // For dt=0, just add the volume directly (instantaneous impulse)
    // v_i = volume / dt -> infinity, but we approximate by adding lambda * volume
    // This maintains consistency with impulse-based estimators
    return prevEwma.plus(lambda.times(volumeUsd));
  }

  // Calculate annualized volume rate: v_i = volume / dt_years
  const volumeRate = volumeUsd.div(dtYears);

  // Time-corrected exponential weighting: alpha = 1 - exp(-lambda * dt)
  const alpha = one.minus(exp(lambda.neg().times(dtYears)));

  // EWMA update: ewma_new = (1 - alpha) * ewma_prev + alpha * v_i
  return one.minus(alpha).times(prevEwma).plus(alpha.times(volumeRate));
}

/**
 * Updates the per-vault EWMA volume estimators (1d, 7d, 30d half-lives).
 *
 * @param vault The vault entity to update
 * @param volumeUsd Volume in USD (already scaled by 10^6)
 * @param timestamp Current block timestamp
 */
export function updateVolumeEwma(vault: Vault, volumeUsd: BigDecimal, timestamp: BigInt): void {
  const zero = BigDecimal.fromString("0");

  // Skip if volume is zero or negative
  if (volumeUsd.le(zero)) {
    return;
  }

  // Calculate time delta
  const dtSeconds = timestamp.minus(vault.volumeLastTimestamp).toBigDecimal();
  const dtYears = dtSeconds.div(SECONDS_PER_YEAR);

  // First volume event for this vault
  if (vault.volumeLastTimestamp.equals(BigInt.fromI32(0))) {
    // Initialize with annualized rate contribution: lambda * volume
    vault.volumeUsdEwma1d = LAMBDA_1D.times(volumeUsd);
    vault.volumeUsdEwma7d = LAMBDA_7D.times(volumeUsd);
    vault.volumeUsdEwma30d = LAMBDA_30D.times(volumeUsd);
  } else {
    // Update each EWMA with the appropriate half-life
    vault.volumeUsdEwma1d = calculateEwmaUpdate(vault.volumeUsdEwma1d, volumeUsd, dtYears, LAMBDA_1D);
    vault.volumeUsdEwma7d = calculateEwmaUpdate(vault.volumeUsdEwma7d, volumeUsd, dtYears, LAMBDA_7D);
    vault.volumeUsdEwma30d = calculateEwmaUpdate(vault.volumeUsdEwma30d, volumeUsd, dtYears, LAMBDA_30D);
  }

  vault.volumeLastTimestamp = timestamp;
  // Note: vault.save() should be called by the caller after all updates
}

/**
 * Updates the global EWMA volume estimators (1d, 7d, 30d half-lives).
 * Uses the same formula as per-vault EWMA - each volume event directly
 * updates the global EWMA.
 *
 * @param volumeUsd Volume in USD (already scaled by 10^6)
 * @param timestamp Current block timestamp
 */
export function updateGlobalVolumeEwma(volumeUsd: BigDecimal, timestamp: BigInt): void {
  const zero = BigDecimal.fromString("0");

  // Skip if volume is zero or negative
  if (volumeUsd.le(zero)) {
    return;
  }

  const stats = loadOrCreateVolumeStats();

  // Calculate time delta
  const dtSeconds = timestamp.minus(stats.lastTimestamp).toBigDecimal();
  const dtYears = dtSeconds.div(SECONDS_PER_YEAR);

  // First volume event globally
  if (stats.lastTimestamp.equals(BigInt.fromI32(0))) {
    // Initialize with annualized rate contribution: lambda * volume
    stats.totalVolumeUsd1d = LAMBDA_1D.times(volumeUsd);
    stats.totalVolumeUsd7d = LAMBDA_7D.times(volumeUsd);
    stats.totalVolumeUsd30d = LAMBDA_30D.times(volumeUsd);
  } else {
    // Update each EWMA with the appropriate half-life
    stats.totalVolumeUsd1d = calculateEwmaUpdate(stats.totalVolumeUsd1d, volumeUsd, dtYears, LAMBDA_1D);
    stats.totalVolumeUsd7d = calculateEwmaUpdate(stats.totalVolumeUsd7d, volumeUsd, dtYears, LAMBDA_7D);
    stats.totalVolumeUsd30d = calculateEwmaUpdate(stats.totalVolumeUsd30d, volumeUsd, dtYears, LAMBDA_30D);
  }

  stats.lastTimestamp = timestamp;
  stats.save();
}
