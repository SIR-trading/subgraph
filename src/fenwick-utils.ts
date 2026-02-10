import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { FenwickNode, VaultLockTree } from "../generated/schema";

// Reference timestamp: offset so that lockEnd values fit in i32 range.
// Using a value near the MegaETH deployment time (adjust if needed).
// 1740000000 = ~Feb 19 2025 — gives ~68 years of range.
export const REFERENCE_TIMESTAMP = BigInt.fromI64(1740000000);

// Sentinel index for POL (Protocol Owned Liquidity) with infinite lock
export const POL_INDEX: i32 = -1;

// MAX_UINT40 = 2^40 - 1 = 1099511627775, used as sentinel for infinite lock
const MAX_UINT40 = BigInt.fromI64(1099511627775);

/**
 * Converts a lockEnd timestamp to a Fenwick tree index.
 * Returns:
 *   0  if unlocked (lockEnd == 0 or lockEnd <= REFERENCE_TIMESTAMP)
 *  -1  if POL (lockEnd >= MAX_UINT40, infinite lock)
 *  >0  otherwise (lockEnd - REFERENCE_TIMESTAMP)
 */
export function lockEndToIndex(lockEnd: BigInt): i32 {
  // Unlocked
  if (lockEnd.equals(BigInt.fromI32(0))) {
    return 0;
  }

  // POL: infinite lock sentinel
  if (lockEnd.ge(MAX_UINT40)) {
    return POL_INDEX;
  }

  // Compute offset
  const offset = lockEnd.minus(REFERENCE_TIMESTAMP);

  // If offset <= 0, treat as unlocked (expired or at reference)
  if (offset.le(BigInt.fromI32(0))) {
    return 0;
  }

  // Guard i32 bounds (max ~2.1 billion, ~68 years from reference)
  if (offset.gt(BigInt.fromI32(i32.MAX_VALUE))) {
    return i32.MAX_VALUE;
  }

  return offset.toI32();
}

/**
 * Generates a deterministic Fenwick node entity ID.
 * Format: "{vaultId_hex}-fw-{index}"
 */
export function fenwickNodeId(vaultId: Bytes, index: i32): string {
  return vaultId.toHexString() + "-fw-" + index.toString();
}

/**
 * Loads or creates the VaultLockTree entity for a vault.
 */
export function loadOrCreateVaultLockTree(vaultId: Bytes): VaultLockTree {
  let tree = VaultLockTree.load(vaultId);
  if (!tree) {
    tree = new VaultLockTree(vaultId);
    tree.vault = vaultId;
    tree.polLockedSupply = BigInt.fromI32(0);
    tree.maxIndex = 0;
    tree.save();
  }
  return tree;
}

/**
 * Suffix-sum Fenwick tree update.
 * Matching Strategy.sol pattern: start at index i, apply delta, move backward via i -= i & (-i).
 * Also updates maxIndex on VaultLockTree if index > current maxIndex.
 *
 * Early-returns for index <= 0 (unlocked positions are not tracked in the tree).
 */
export function fenwickUpdate(vaultId: Bytes, index: i32, delta: BigInt): void {
  if (index <= 0) return;
  if (delta.equals(BigInt.fromI32(0))) return;

  // Update maxIndex if needed
  const tree = loadOrCreateVaultLockTree(vaultId);
  if (index > tree.maxIndex) {
    tree.maxIndex = index;
    tree.save();
  }

  // Suffix-sum update: start at index, move backward
  let i = index;
  while (i > 0) {
    const nodeId = fenwickNodeId(vaultId, i);
    let node = FenwickNode.load(nodeId);
    if (!node) {
      node = new FenwickNode(nodeId);
      node.vault = vaultId;
      node.index = i;
      node.value = BigInt.fromI32(0);
    }
    node.value = node.value.plus(delta);
    node.save();

    // Move backward: clear the lowest set bit
    // In AssemblyScript, i32 bitwise ops work natively
    i = i - (i & (-i));
  }
}

/**
 * Updates the polLockedSupply on VaultLockTree (for infinite lock / POL positions).
 */
export function updatePolLockedSupply(vaultId: Bytes, delta: BigInt): void {
  if (delta.equals(BigInt.fromI32(0))) return;

  const tree = loadOrCreateVaultLockTree(vaultId);
  tree.polLockedSupply = tree.polLockedSupply.plus(delta);
  tree.save();
}

/**
 * Single entry point for all Fenwick tree updates.
 * Dispatches to fenwickUpdate() or updatePolLockedSupply() based on index.
 *   index > 0:  normal Fenwick tree update
 *   index == -1 (POL_INDEX): update polLockedSupply
 *   index == 0:  unlocked, skip (not tracked in tree)
 */
export function applyLockDelta(vaultId: Bytes, index: i32, delta: BigInt): void {
  if (index == 0) return; // Unlocked, not tracked
  if (index == POL_INDEX) {
    updatePolLockedSupply(vaultId, delta);
  } else {
    fenwickUpdate(vaultId, index, delta);
  }
}
