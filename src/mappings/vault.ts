import { VaultInitialized } from "../../generated/VaultExternal/VaultExternal";
import { Vault, Fee } from "../../generated/schema";
import { Sir } from "../../generated/Vault/Sir";
import { Address, BigInt, BigDecimal, Bytes, store } from "@graphprotocol/graph-ts";
import { sirAddress } from "../contracts";
import { loadOrCreateToken, bigIntToHex } from "../helpers";
import { loadOrCreateVault } from "../vault-utils";
import {
  Burn,
  Mint,
  ReservesChanged,
  VaultNewTax,
} from "../../generated/Vault/Vault";

/**
 * Generates a unique Fee entity ID based on vault ID and timestamp
 */
function generateFeesId(vaultId: Bytes, timestamp: BigInt): Bytes {
  return Bytes.fromHexString(vaultId.toHexString() + bigIntToHex(timestamp).slice(2));
}

/**
 * Creates or updates a Fee entity and adds it to the vault's fees tracking
 * Calculates LP APY based on fees deposited divided by tea collateral for LPers
 */
function createFeesEntity(
  vaultId: Bytes,
  vault: Vault,
  collateralFeeToLPers: BigInt,
  timestamp: BigInt
): void {
  const feesId = generateFeesId(vaultId, timestamp);

  // Calculate LP APY: fees deposited divided by tea collateral
  let newLpApy = BigDecimal.fromString("0");

  // Since ReservesChanged comes before Mint/Burn, reserveLPers already includes the fees
  const baseTeaCollateral = vault.reserveLPers.minus(collateralFeeToLPers);

  if (baseTeaCollateral.gt(BigInt.fromI32(0))) {
    const feesDecimal = collateralFeeToLPers.toBigDecimal();
    const baseTeaCollateralDecimal = baseTeaCollateral.toBigDecimal();
    newLpApy = feesDecimal.div(baseTeaCollateralDecimal);
  }

  // Check if fees entity already exists for this timestamp
  let fees = Fee.load(feesId);
  if (fees) {
    fees.lpApy = fees.lpApy.plus(newLpApy);
    fees.save();
  } else {
    fees = new Fee(feesId);
    fees.vaultId = vaultId;
    fees.timestamp = timestamp;
    fees.lpApy = newLpApy;
    fees.save();

    const currentFeesIds = vault.feesIds;
    currentFeesIds.push(feesId);
    vault.feesIds = currentFeesIds;
  }

  // Clean up fees older than 1 month (2592000 seconds = 30 days)
  cleanupOldFees(vault, timestamp);

  vault.save();
}

/**
 * Removes fees entities older than 1 month and updates vault's fees tracking
 */
function cleanupOldFees(vault: Vault, currentTimestamp: BigInt): void {
  const oneMonthInSeconds = BigInt.fromI32(2592000);
  const cutoffTimestamp = currentTimestamp.minus(oneMonthInSeconds);

  const currentFeesIds = vault.feesIds;

  while (currentFeesIds.length > 0) {
    const oldestFeesId = currentFeesIds[0];
    const fees = Fee.load(oldestFeesId);

    if (fees && fees.timestamp.lt(cutoffTimestamp)) {
      store.remove("Fee", oldestFeesId.toHexString());
      currentFeesIds.shift();
    } else {
      break;
    }
  }

  vault.feesIds = currentFeesIds;
}

export function handleVaultTax(event: VaultNewTax): void {
  const tax = BigInt.fromU32(event.params.tax);
  const cumulativeTax = BigInt.fromU32(event.params.cumulativeTax);
  const vaultId = Bytes.fromHexString(bigIntToHex(event.params.vault));

  let vault = loadOrCreateVault(vaultId);

  if (!cumulativeTax.gt(BigInt.fromI32(0))) {
    vault.rate = BigInt.fromI32(0);
    vault.save();
    return;
  }

  // Calculate rate
  const contract = Sir.bind(Address.fromString(sirAddress));
  const issuanceRate = contract.LP_ISSUANCE_FIRST_3_YEARS();
  const rate = tax
    .times(issuanceRate)
    .div(cumulativeTax);

  vault.rate = rate;
  vault.save();
}

export function handleVaultInitialized(event: VaultInitialized): void {
  const vaultId = Bytes.fromHexString(bigIntToHex(event.params.vaultId));

  let vault = loadOrCreateVault(vaultId);

  // Get or create Token entities
  const collateralToken = loadOrCreateToken(event.params.collateralToken);
  const debtToken = loadOrCreateToken(event.params.debtToken);

  vault.collateralToken = collateralToken.id;
  vault.debtToken = debtToken.id;
  vault.leverageTier = event.params.leverageTier;
  vault.exists = true;

  vault.save();
}

export function handleReservesChanged(event: ReservesChanged): void {
  const vaultId = Bytes.fromHexString(bigIntToHex(event.params.vaultId));

  let vault = Vault.load(vaultId);
  if (!vault) return;

  vault.reserveLPers = event.params.reserveLPers;
  vault.save();
}

export function handleMint(event: Mint): void {
  const vaultId = Bytes.fromHexString(bigIntToHex(event.params.vaultId));
  const vault = Vault.load(vaultId);
  if (!vault) return;

  const isAPE = event.params.isAPE;

  // Only process LP fees from APE mints when TEA supply > 0
  if (isAPE && vault.teaSupply.gt(BigInt.fromI32(0))) {
    const collateralFeeToLPers = event.params.collateralFeeToLPers;
    if (collateralFeeToLPers.gt(BigInt.fromI32(0))) {
      createFeesEntity(vaultId, vault, collateralFeeToLPers, event.block.timestamp);
    }
  }
}

export function handleBurn(event: Burn): void {
  const vaultId = Bytes.fromHexString(bigIntToHex(event.params.vaultId));
  const vault = Vault.load(vaultId);
  if (!vault) return;

  const isAPE = event.params.isAPE;

  // Only process LP fees from APE burns
  if (isAPE) {
    const collateralFeeToLPers = event.params.collateralFeeToLPers;
    if (collateralFeeToLPers.gt(BigInt.fromI32(0))) {
      createFeesEntity(vaultId, vault, collateralFeeToLPers, event.block.timestamp);
    }
  }
}

// TEA transfer handlers
export { handleSingleTransfer, handleBatchTransfer } from "./tea";
