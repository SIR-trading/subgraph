# TEA Lock Duration Queries — Frontend Guide

## What This Solves

On MegaETH, TEA (liquidity provider) positions have time locks. The app needs to answer:

> "For vault V, how much TEA is locked for at least T more seconds?"

Without the Fenwick tree, you'd have to fetch every `TeaPosition` for a vault and sum balances client-side. With hundreds of LPs per vault, that's slow and expensive.

The Fenwick tree pre-computes **suffix sums** on lock times. The client fetches ~28 small entities by ID and sums them — O(log n) instead of O(n).

---

## Constants

```typescript
const REFERENCE_TIMESTAMP = 1740000000; // ~Feb 19 2025, offset for index calculation
```

---

## Entities

### `VaultLockTree`

One per vault. Stores tree metadata.

```graphql
vaultLockTree(id: "<vaultIdHex>") {
  maxIndex        # Highest Fenwick tree index in use
  polLockedSupply # TEA with infinite lock (POL), outside the tree
}
```

The `id` is the same as the vault's `id` (its hex-encoded vault number, e.g. `"0x01"` for vault 1).

### `FenwickNode`

Individual tree nodes. Sparse — only nodes touched by updates exist.

```graphql
fenwickNodes(where: { id_in: ["0x01-fw-100", "0x01-fw-128", ...] }) {
  id
  value   # Partial sum (NOT a raw balance at this lock time)
}
```

ID format: `"{vaultIdHex}-fw-{index}"` where `index` is a decimal integer.

### `TeaPosition` (existing, updated)

New field:
- `lockIndex`: `0` = unlocked, `-1` = POL (infinite), `>0` = `lockEnd - REFERENCE_TIMESTAMP`
- `lockEnd`: The raw lock-end unix timestamp (unchanged)

---

## Query 1: Total TEA Locked for >= T More Seconds

This is the primary use case. "How much TEA in this vault is still locked for at least T more seconds from now?"

### Algorithm

```typescript
function getLockedTeaSupply(
  vaultIdHex: string,       // e.g. "0x01"
  minRemainingSeconds: number,
  subgraphClient: GraphQLClient,
): Promise<bigint> {
  // 1. Compute the target index
  const nowSeconds = Math.floor(Date.now() / 1000);
  const targetLockEnd = nowSeconds + minRemainingSeconds;
  const targetIndex = Math.max(1, targetLockEnd - REFERENCE_TIMESTAMP);

  // 2. Fetch tree metadata
  const { vaultLockTree } = await subgraphClient.query(`{
    vaultLockTree(id: "${vaultIdHex}") {
      maxIndex
      polLockedSupply
    }
  }`);

  // No tree exists yet → no locked supply
  if (!vaultLockTree) return 0n;

  const maxIndex = vaultLockTree.maxIndex;
  const polSupply = BigInt(vaultLockTree.polLockedSupply);

  // Target is beyond all lock times → only POL is locked
  if (targetIndex > maxIndex) return polSupply;

  // 3. Compute which Fenwick node IDs to fetch (suffix-sum query)
  //    Walk forward: i += i & (-i)
  const nodeIds: string[] = [];
  let i = targetIndex;
  while (i <= maxIndex) {
    nodeIds.push(`${vaultIdHex}-fw-${i}`);
    i += i & (-i);  // add lowest set bit
  }

  // 4. Batch-fetch all nodes in one GraphQL request
  const { fenwickNodes } = await subgraphClient.query(`{
    fenwickNodes(where: { id_in: ${JSON.stringify(nodeIds)} }) {
      value
    }
  }`);

  // Missing nodes = 0 (sparse tree)
  const treeSum = (fenwickNodes ?? []).reduce(
    (sum: bigint, n: { value: string }) => sum + BigInt(n.value),
    0n,
  );

  // 5. Total = tree suffix sum + POL (always locked)
  return treeSum + polSupply;
}
```

### How Many Nodes?

At most `ceil(log2(maxIndex))` nodes per query — roughly **28** for a 10-year range. In practice it's fewer because `maxIndex` grows only as large as the furthest-future lock time.

---

## Query 2: Total Unlocked TEA

```typescript
// Unlocked = total supply - everything in the tree - POL
const unlockedTea = vault.teaSupply - getLockedTeaSupply(vaultId, 0) ;
```

Or equivalently, since `getLockedTeaSupply` with `minRemainingSeconds = 0` uses `targetIndex = max(1, now - REFERENCE_TIMESTAMP)`, it returns all TEA whose `lockEnd > now` plus POL. The remainder is unlocked.

---

## Query 3: Enumerate Locked/Unlocked LPs

The Fenwick tree gives **aggregate totals**, not per-user breakdowns. For per-user data, query `TeaPosition` directly:

```graphql
# All positions locked for at least T more seconds
{
  teaPositions(
    where: {
      vault: "0x01"
      lockEnd_gte: "${targetTimestamp}"  # now + T
    }
  ) {
    user
    balance
    lockEnd
    lockIndex
  }
}

# All unlocked positions (lockEnd in the past or zero)
{
  teaPositions(
    where: {
      vault: "0x01"
      lockEnd_lt: "${nowTimestamp}"
    }
  ) {
    user
    balance
  }
}
```

Use the Fenwick tree for the total, and `TeaPosition` queries for the breakdown.

---

## Query 4: Lock Distribution (Histogram)

To build a histogram of "how much TEA unlocks in each time bucket", query multiple suffix sums and diff them:

```typescript
const bucketEdges = [0, 7, 30, 90, 180, 365]; // days from now

const results = await Promise.all(
  bucketEdges.map(days => getLockedTeaSupply(vaultIdHex, days * 86400, client))
);

// results[i] = TEA locked for >= bucketEdges[i] days
// Bucket "7-30 days" = results[1] - results[2]
// Bucket "30-90 days" = results[2] - results[3]
// etc.
```

Each call is independent and can run in parallel. All use the same subgraph round-trip pattern (~28 entity reads each).

---

## How the Tree Stays Accurate Without Time-Based Updates

The tree is only written to when a mint, burn, or transfer happens. It is **never updated based on the passage of time**. This works because:

- Each position's lock time is stored as an **absolute timestamp** (converted to a tree index).
- When you query "locked for >= 30 days from now", you compute `targetIndex = now + 30days - REFERENCE_TIMESTAMP`. Tomorrow, `now` is larger, so `targetIndex` is larger, and the query naturally skips positions that have since expired.
- Expired entries remain in the tree but are invisible to future queries because the query start index has moved past them.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Vault has no lock tree yet | `vaultLockTree` returns `null` → locked supply = 0 |
| `targetIndex > maxIndex` | Only POL is locked beyond `maxIndex` → return `polLockedSupply` |
| Missing `FenwickNode` in batch query | Treat as value = 0 (sparse tree, node was never written) |
| `lockEnd = 0` (unlocked) | `lockIndex = 0`, not in tree, not in POL |
| `lockEnd >= 2^40` (POL / infinite) | `lockIndex = -1`, tracked in `polLockedSupply` only |
| Position fully burned | Fenwick tree decremented at burn time; entity removed from store |

---

## Full Worked Example

Vault `0x01` has 3 LPs:
- Alice: 100 TEA locked until timestamp 1741000000 → index = 1741000000 - 1740000000 = **1000000**
- Bob: 50 TEA locked until timestamp 1742000000 → index = **2000000**
- Carol: 200 TEA, POL (infinite lock) → `polLockedSupply = 200`

Current time: 1740500000. Query "locked for >= 0 more seconds" → targetIndex = max(1, 1740500000 - 1740000000) = **500000**.

Suffix query walks: 500000 → 500000 + (500000 & -500000) = 1000000 → ... → past maxIndex (2000000).
Sum of fetched nodes = 150 (Alice's 100 + Bob's 50) + POL 200 = **350 TEA locked**.

Query "locked for >= 600000 more seconds" → targetIndex = max(1, 1740500000 + 600000 - 1740000000) = **1100000**.
This skips Alice (expired relative to query). Fetched nodes sum = 50 (Bob) + POL 200 = **250 TEA locked**.
