import { Address, BigInt, BigDecimal, Bytes } from "@graphprotocol/graph-ts";
import { Vault } from "../generated/schema";

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
    vault.leverageTier = 0;
    vault.reserveLPers = BigInt.fromI32(0);
    vault.lockedLiquidity = BigInt.fromI32(0);
    vault.rate = BigInt.fromI32(0);
    vault.teaSupply = BigInt.fromI32(0);
    vault.feesIds = [];
  }
  return vault;
}
