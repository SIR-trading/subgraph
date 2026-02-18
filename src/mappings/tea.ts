import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  TransferBatch,
  TransferSingle,
} from "../../generated/Vault/Vault";
import { Vault as VaultSchema } from "../../generated/schema";
import { vaultAddress } from "../contracts";
import { bigIntToHex } from "../helpers";

/**
 * Handles ERC1155 single token transfers for TEA positions
 */
export function handleSingleTransfer(event: TransferSingle): void {
  handleTeaTransfer(
    event.params.id,
    event.params.to,
    event.params.from,
    event.params.amount,
  );
}

/**
 * Handles ERC1155 batch token transfers for TEA positions
 */
export function handleBatchTransfer(event: TransferBatch): void {
  const vaults = event.params.vaultIds;
  const to = event.params.to;
  const from = event.params.from;
  const amounts = event.params.amounts;
  for (let i = 0; i < vaults.length; i++) {
    handleTeaTransfer(vaults[i], to, from, amounts[i]);
  }
}

/**
 * Core logic for handling TEA token transfers
 * Updates vault locked liquidity and total TEA supply
 */
function handleTeaTransfer(
  vaultId: BigInt,
  recipientAddress: Address,
  senderAddress: Address,
  transferAmount: BigInt,
): void {
  const vaultAddressBytes = Address.fromString(vaultAddress);

  // Update vault locked liquidity when tokens move to/from vault
  updateVaultLiquidity(vaultId, recipientAddress, senderAddress, transferAmount, vaultAddressBytes);

  // Update total TEA supply when tokens are minted/burned
  updateTotalTeaSupply(vaultId, recipientAddress, senderAddress, transferAmount);
}

/**
 * Updates vault locked liquidity when TEA tokens move to/from the vault contract
 */
function updateVaultLiquidity(
  vaultId: BigInt,
  recipientAddress: Address,
  senderAddress: Address,
  transferAmount: BigInt,
  vaultAddr: Address,
): void {
  const vaultIdBytes = Bytes.fromHexString(bigIntToHex(vaultId));
  const vault = VaultSchema.load(vaultIdBytes);
  if (!vault) return;

  // Tokens moving TO the vault (locking liquidity)
  if (recipientAddress.equals(vaultAddr)) {
    vault.lockedLiquidity = vault.lockedLiquidity.plus(transferAmount);
    vault.save();
  }

  // Tokens moving FROM the vault (unlocking)
  if (senderAddress.equals(vaultAddr)) {
    vault.lockedLiquidity = vault.lockedLiquidity.minus(transferAmount);
    vault.save();
  }
}

/**
 * Updates total TEA supply when tokens are minted (from zero) or burned (to zero)
 */
function updateTotalTeaSupply(
  vaultId: BigInt,
  recipientAddress: Address,
  senderAddress: Address,
  transferAmount: BigInt,
): void {
  const vaultIdBytes = Bytes.fromHexString(bigIntToHex(vaultId));
  const vault = VaultSchema.load(vaultIdBytes);
  if (!vault) return;

  const zeroAddr = Address.zero();

  // Tokens minted (from zero address) - increase total supply
  if (senderAddress.equals(zeroAddr)) {
    vault.teaSupply = vault.teaSupply.plus(transferAmount);
    vault.save();
  }

  // Tokens burned (to zero address) - decrease total supply
  if (recipientAddress.equals(zeroAddr)) {
    vault.teaSupply = vault.teaSupply.minus(transferAmount);
    vault.save();
  }
}
