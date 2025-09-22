# Frontend Migration Guide

## Changes Since Commit 7d9733b (2024-12-18)

This document outlines all breaking changes and updates to the subgraph schema that require frontend modifications.

## Breaking Changes

### 1. Entity ID Type Changes
**All entity IDs changed from `String!` to `Bytes!`**

#### Before:
```graphql
type Vault {
  id: String!
  vaultId: String!
  ...
}
```

#### After:
```graphql
type Vault {
  id: Bytes!
  ...
}
```

**Migration Required:**
- Update all GraphQL queries to handle Bytes type for IDs
- Remove `.toString()` calls when using IDs
- Update any ID comparisons or storage logic

**Affected Entities:**
- Vault
- Fee
- TeaPosition
- ApePosition
- ApePositionClosed (renamed from ClosedApePosition)
- Dividend
- Auction
- AuctionsParticipant
- AuctionsHistory

### 2. New Token Entity
A new `Token` entity has been introduced to properly represent ERC20 tokens.

```graphql
type Token @entity {
  id: Bytes!           # Token contract address
  symbol: String       # Token symbol (nullable)
  decimals: Int!       # Token decimals
}
```

**Note:** The `id` field contains the token's contract address. There is no separate `address` field.

### 3. Vault Entity Changes

#### Removed Fields:
- `vaultId: String!` - Use `id` instead
- `collateralSymbol: String!` - Access via `collateralToken.symbol`
- `debtSymbol: String!` - Access via `debtToken.symbol`
- `apeAddress: Bytes!` - Access via `ape.id`
- `apeDecimals: Int!` - Access via `ape.decimals`
- `totalTea: BigInt!` - Renamed to `teaSupply`
- `apeCollateral: BigInt!` - Renamed to `reserveApes`
- `teaCollateral: BigInt!` - Renamed to `reserveLPers`
- `taxAmount: BigInt!` - Renamed to `tax`

#### Changed Fields:
- `collateralToken: String!` → `collateralToken: Token! @link`
- `debtToken: String!` → `debtToken: Token! @link`
- `totalValueUsd: BigInt!` → `totalValueUsd: BigDecimal!`
- `feesIds: [String!]!` → `feesIds: [Bytes!]!`

#### New Fields:
- `ape: Token! @link` - Reference to the APE token entity

#### Query Migration Example:
```graphql
# Before
query GetVault {
  vault(id: "vault-123") {
    collateralSymbol
    debtSymbol
    apeAddress
    totalTea
  }
}

# After
query GetVault {
  vault(id: "0x...") {
    collateralToken {
      id
      symbol
    }
    debtToken {
      symbol
    }
    ape {
      id
    }
    teaSupply
  }
}
```

### 4. Position Entity Changes

#### TeaPosition Changes:
- **Removed:** `decimals`, `collateralSymbol`, `debtSymbol`, `collateralToken`, `debtToken`, `leverageTier`, `vaultId`
- **Added:** `vault: Vault! @link` - Direct reference to vault entity
- **Added:** `collateralTotal: BigInt!` - Cost basis denominated in collateral token units
- **Added:** `dollarTotal: BigDecimal!` - Cost basis denominated in USD
- **Added:** `debtTokenTotal: BigInt!` - Cost basis denominated in debt token units

#### ApePosition Changes:
- **Removed:** `vaultId`, `decimals`, `ape`, `collateralSymbol`, `debtSymbol`, `collateralToken`, `debtToken`, `leverageTier`
- **Added:** `vault: Vault! @link` - Direct reference to vault entity
- **Changed:** `dollarTotal: BigInt!` → `dollarTotal: BigDecimal!`
- **Added:** `debtTokenTotal: BigInt!` - Cost basis denominated in debt token units

### 5. ClosedApePosition → ApePositionClosed
Entity renamed and restructured:
- **Renamed:** `ClosedApePosition` → `ApePositionClosed`
- **Removed:** `vaultId: String!`, `decimal: Int!`
- **Added:** `vault: Vault! @link`
- **Changed:** `dollarDeposited: BigInt!` → `dollarDeposited: BigDecimal!`
- **Changed:** `dollarWithdrawn: BigInt!` → `dollarWithdrawn: BigDecimal!`

### 6. Dividend Entity Changes
- **Changed:** `sirEthPrice: BigDecimal!` → `sirEthPrice: BigDecimal` (now nullable/optional)

**Important:** `sirEthPrice` may be `null` when the SIR/ETH price cannot be determined (no pool or no liquidity)

### 7. Auction Entity Changes
- **Changed:** `token: Bytes!` → `token: Token! @link`

### 8. AuctionsHistory Entity Changes
- **Changed:** `token: Bytes!` → `token: Token! @link`

## Non-Breaking Improvements

### 1. Cost Basis Tracking
All position entities now track cost basis in three different units:
- `collateralTotal`: Total cost basis denominated in collateral token units
- `dollarTotal`: Total cost basis denominated in USD
- `debtTokenTotal`: Total cost basis denominated in debt token units (NOT borrowed amount - just another unit of measurement)

**Important**: The debt token is simply another token used as a reference for pricing. The `debtTokenTotal` field does NOT represent borrowed amounts or actual debt - it's just the cost basis expressed in debt token units (similar to expressing a price in EUR vs USD).

These values are maintained proportionally during transfers to provide accurate average cost basis.

### 2. BigDecimal for USD Values
All USD-denominated values now use `BigDecimal` type for better precision:
- `Vault.totalValueUsd`
- `ApePosition.dollarTotal`
- `TeaPosition.dollarTotal`
- `ApePositionClosed.dollarDeposited`
- `ApePositionClosed.dollarWithdrawn`

## Frontend Update Checklist

- [ ] Update GraphQL schema and regenerate types
- [ ] Update all ID handling from String to Bytes
- [ ] Update queries to use nested Token entity instead of direct string fields
- [ ] Handle nullable `sirEthPrice` in Dividend entity
- [ ] Update position queries to use `vault` relationship instead of `vaultId`
- [ ] Rename `ClosedApePosition` to `ApePositionClosed` in queries
- [ ] Update field names: `totalTea` → `teaSupply`, `apeCollateral` → `reserveApes`, etc.
- [ ] Update BigInt to BigDecimal parsing for USD values
- [ ] Add cost basis display using new `collateralTotal`, `dollarTotal`, `debtTokenTotal` fields
- [ ] Update any caching or local storage that depends on entity structure

## Example Query Updates

### Fetching Vaults with Token Info
```graphql
query GetVaults {
  vaults {
    id
    exists
    collateralToken {
      id
      symbol
      decimals
    }
    debtToken {
      symbol
      decimals
    }
    ape {
      id
      symbol
    }
    leverageTier
    totalValueUsd
    teaSupply
    reserveApes
    reserveLPers
  }
}
```

### Fetching User Positions
```graphql
query GetUserPositions($user: Bytes!) {
  apePositions(where: { user: $user }) {
    id
    balance
    collateralTotal
    dollarTotal
    debtTokenTotal
    vault {
      id
      leverageTier
      collateralToken {
        symbol
        decimals
      }
    }
  }

  teaPositions(where: { user: $user }) {
    id
    balance
    collateralTotal
    dollarTotal
    debtTokenTotal
    vault {
      id
      collateralToken {
        symbol
      }
    }
  }
}
```

### Fetching Dividends (with optional price)
```graphql
query GetDividends {
  dividends(orderBy: timestamp, orderDirection: desc) {
    id
    ethAmount
    sirEthPrice  # May be null
    stakedAmount
    timestamp
  }
}
```

## Testing Recommendations

1. Test with both mainnet and testnet subgraphs
2. Verify cost basis calculations are correct after position transfers
3. Handle null `sirEthPrice` gracefully in UI
4. Ensure proper decimal formatting for BigDecimal fields
5. Test pagination with new Bytes ID format

## Support

For questions or issues related to this migration, please refer to:
- The subgraph repository issues
- The CLAUDE.md file for detailed entity documentation
- The schema.graphql file for the complete current schema