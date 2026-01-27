# SIR Protocol Subgraph Documentation

## Overview

This subgraph indexes the SIR Protocol, a DeFi system that enables leveraged positions on tokens through vaults. The protocol consists of:
- **Vaults**: Pools where users can deposit collateral to mint leveraged positions (APE tokens) or provide liquidity (TEA tokens)
- **SIR Token**: The protocol's governance token that receives dividends from protocol fees
- **Auction System**: Mechanism for distributing accumulated fees to SIR stakers

## Key Contracts

- **VaultExternal**: Main vault factory contract
- **Tea**: TEA token contract (ERC1155) for liquidity provider positions
- **Vault**: Individual vault logic for managing positions and reserves
- **Sir**: SIR token and auction contract for governance and fee distribution
- **APE**: Dynamic contracts deployed per vault - Leveraged position tokens (ERC20)

## Entities

### Token
Represents any ERC20 token in the system.
- `id`: Token contract address (Bytes)
- `symbol`: Token symbol (e.g., "WETH", "USDC")
- `decimals`: Number of decimals for the token

### Vault
Represents a liquidity vault for a specific token pair and leverage tier.
- `id`: Unique vault identifier
- `exists`: Whether the vault is active
- `collateralToken`: The token deposited as collateral (linked Token entity)
- `debtToken`: The token borrowed for leverage (linked Token entity)
- `leverageTier`: Leverage level (-3 to 3, where negative means short)
- `totalValue`: Total value locked in the vault (in collateral token units)
- `totalValueUsd`: Total value locked in USD
- `lockedLiquidity`: Amount of liquidity locked in positions
- `teaSupply`: Total TEA tokens minted (liquidity provider tokens)
- `reserveApes`: Reserve amount for APE holders
- `reserveLPers`: Reserve amount for liquidity providers
- `tax`: Current tax rate on the vault
- `rate`: Exchange rate between APE and collateral
- `ape`: The APE token for this vault (linked Token entity)
- `feesIds`: List of fee record IDs

### Fee
Tracks fee distributions and APY for vaults.
- `id`: Unique fee record identifier
- `vaultId`: Associated vault ID
- `timestamp`: When the fee was recorded
- `lpApy`: Annual percentage yield for liquidity providers

### TeaPosition
Represents a user's liquidity provider position in a vault.
- `id`: Unique position identifier (user + vault)
- `vault`: Associated vault (linked Vault entity)
- `user`: User's address
- `balance`: TEA token balance
- `collateralTotal`: Total cost basis in collateral token units
- `dollarTotal`: Total cost basis in USD
- `debtTokenTotal`: Total cost basis in debt token units

### ApePosition
Represents a user's leveraged position in a vault.
- `id`: Unique position identifier (user + APE token)
- `vault`: Associated vault (linked Vault entity)
- `user`: User's address
- `balance`: APE token balance
- `collateralTotal`: Total cost basis in collateral token units
- `dollarTotal`: Total cost basis in USD
- `debtTokenTotal`: Total cost basis in debt token units (not borrowed, just another unit of measurement)

### ApePositionClosed
Historical record of closed APE positions.
- `id`: Unique record identifier
- `vault`: Associated vault (linked Vault entity)
- `user`: User's address
- `collateralDeposited`: Total collateral deposited over position lifetime
- `dollarDeposited`: Total USD value deposited
- `collateralWithdrawn`: Total collateral withdrawn
- `dollarWithdrawn`: Total USD value withdrawn
- `timestamp`: When position was closed

### Dividend
Records dividend distributions to SIR stakers.
- `id`: Unique dividend identifier
- `ethAmount`: Amount of ETH distributed
- `sirEthPrice`: SIR/ETH price at distribution time (optional - may be null if price unavailable)
- `stakedAmount`: Total SIR staked at distribution
- `timestamp`: When dividend was distributed

### Auction
Active auctions for distributing accumulated fees.
- `id`: Unique auction identifier
- `token`: Token being auctioned (linked Token entity)
- `amount`: Amount of tokens in auction
- `highestBid`: Current highest bid in SIR tokens
- `highestBidder`: Address of highest bidder
- `startTime`: When auction started
- `isClaimed`: Whether winner has claimed tokens
- `participants`: List of auction participants (derived from AuctionsParticipant)

### AuctionsParticipant
Records individual bids in auctions.
- `id`: Unique participant record
- `auctionId`: Associated auction (linked Auction entity)
- `user`: Bidder's address
- `bid`: Bid amount in SIR tokens

### AuctionsHistory
Historical record of completed auctions.
- `id`: Unique history record
- `token`: Token that was auctioned (linked Token entity)
- `amount`: Amount of tokens auctioned
- `highestBid`: Winning bid amount
- `highestBidder`: Winner's address
- `startTime`: When auction started

## Key Concepts

### LP APY Estimator (Kernel Density)

LP APY is calculated using a **kernel density estimator** for impulse processes with a 30-day half-life. This treats fee events as discrete impulses rather than returns spread over time intervals.

#### Definitions
- `fee_i`: fee paid at time t_i
- `nav_i`: NAV just before fee (`reserveLPers - fee`)
- `dt_i`: elapsed time since previous fee, in years (`dt_i = (t_i - t_{i-1}) / 31,557,600`)
- `H = 30/365.25`: half-life in years
- `λ = ln(2) / H ≈ 8.445`: decay constant (units: 1/year)

#### Algorithm
```
x_i = ln(1 + fee_i / nav_i)                       # log return
decay_i = exp(-λ × dt_i)                          # exponential decay
r̂_i = λ × x_i + decay_i × r̂_{i-1}                # kernel density update
```

The stored `lpApyEwma` is the continuous annualized rate `r̂`. The decay constant `λ` (with units 1/year) converts dimensionless log returns directly to annual rates. The exponential decay `exp(-λ × dt)` handles time-weighting.

The formula handles any `dt` value correctly, including `dt=0` (same-timestamp fees). When `dt=0`, `exp(-λ × 0) = 1`, so the formula becomes `r̂_i = λ × x_i + r̂_{i-1}`, which correctly accumulates same-timestamp impulses.

#### Conversion to APY (in App)
```
APY = exp(r̂) - 1
```

Located in `App/src/app/api/vault-metrics/route.ts` → `continuousRateToApy()`

#### Key Files
- `src/mappings/vault.ts` → `updateLpApyEwma()`
- `src/math-utils.ts` → `ln()`, `exp()`

---

### Volatility Estimator (EWMA)

The subgraph computes annualized volatility for each token pair using an EWMA (Exponentially Weighted Moving Average) algorithm with a 30-day half-life.

#### TokenPairVolatility Entity
- `token0` / `token1`: Tokens sorted by address (token0 < token1) to ensure consistent price direction
- `lastPrice`: Oracle tick in Q21.42 format (not a price ratio)
- `ewmaVarianceRate`: EWMA of annualized variance rate
- `volatilityAnnual`: Computed annualized volatility = sqrt(ewmaVarianceRate)

#### Oracle Price Format (Q21.42)
The Oracle returns `tickPriceX42 = log_1.0001(price) × 2^42`, not a direct price ratio. This is a logarithmic tick scaled by 2^42.

#### Algorithm
```
r_i = (tick_i - tick_{i-1}) × ln(1.0001) / 2^42   # log return from tick diff
v_i = r_i² / dt_i                                 # annualized variance rate (dt in years)
α_i = 1 - exp(-λ × dt_i)                          # time-corrected weight
v̂_i = (1 - α_i) × v̂_{i-1} + α_i × v_i            # EWMA of variance rate
σ_annual = sqrt(v̂_i)                              # annualized volatility
```

#### Constants
| Constant | Value | Description |
|----------|-------|-------------|
| `SECONDS_PER_YEAR` | 31,557,600 | 365.25 days in seconds |
| `LAMBDA` | 8.445 | ln(2) / (30/365.25) for 30-day half-life |
| `LN_1_0001` | 0.0000999950... | ln(1.0001) for tick conversion |
| `SCALE_2_42` | 4,398,046,511,104 | 2^42 for Q21.42 format |

#### Interpreting Volatility
| Annual Vol | 1σ yearly price range |
|------------|----------------------|
| 50% | 1.65x or 0.61x |
| 100% | 2.72x (e) or 0.37x |
| 200% | 7.39x or 0.14x |

The 2.72x factor comes from e (Euler's number) since we use natural logarithm.

#### Key Files
- `src/volatility-utils.ts` → `updateVolatility()`
- `src/math-utils.ts` → `exp()`, `sqrt()`, `LN_1_0001`, `SCALE_2_42`

---

### Volume Estimator (EWMA)

The subgraph tracks USD trading volume using EWMA (Exponentially Weighted Moving Average) with three different half-lives: 1-day, 7-day, and 30-day. This provides smooth, time-weighted volume metrics that naturally decay without activity.

#### Volume Sources
Volume is tracked from all mint and burn events:
- **APE Mint**: `collateralIn + collateralFeeToLPers + collateralFeeToStakers`
- **APE Burn**: `collateralWithdrawn + collateralFeeToLPers`
- **TEA Mint**: `collateralIn + collateralFeeToLPers`
- **TEA Burn**: `collateralWithdrawn`

All values are converted to USD using Uniswap V3 price oracles.

#### Entities

**Vault** (per-vault volume):
- `volumeUsdEwma1d`: 1-day half-life EWMA (annualized rate)
- `volumeUsdEwma7d`: 7-day half-life EWMA (annualized rate)
- `volumeUsdEwma30d`: 30-day half-life EWMA (annualized rate)
- `volumeLastTimestamp`: Timestamp of last volume event

**VolumeStats** (global volume, singleton):
- `totalVolumeUsd1d`: Global 1-day half-life EWMA
- `totalVolumeUsd7d`: Global 7-day half-life EWMA
- `totalVolumeUsd30d`: Global 30-day half-life EWMA
- `lastTimestamp`: Timestamp of last global volume update

#### Algorithm
```
v_i = volume / dt_years                    # annualized volume rate
α_i = 1 - exp(-λ × dt_i)                   # time-corrected weight
ewma_new = (1 - α_i) × ewma_prev + α_i × v_i
```

For the first event (no previous timestamp), initialize with: `ewma = λ × volume`

For `dt=0` (same-timestamp events): `ewma_new = ewma_prev + λ × volume`

#### Constants
| Constant | Value | Half-life | Description |
|----------|-------|-----------|-------------|
| `LAMBDA_1D` | 253.35 | 1 day | ln(2) / (1/365.25) |
| `LAMBDA_7D` | 36.19 | 7 days | ln(2) / (7/365.25) |
| `LAMBDA_30D` | 8.445 | 30 days | ln(2) / (30/365.25) |
| `SECONDS_PER_YEAR` | 31,557,600 | - | 365.25 days in seconds |

#### Conversion to Daily Volume (in App)
The stored EWMA values are annualized rates. To convert to daily volume:
```
dailyVolume = ewma / 365.25
```

#### Key Files
- `src/volume-utils.ts` → `updateVolumeEwma()`, `updateGlobalVolumeEwma()`, `loadOrCreateVolumeStats()`
- `src/mappings/vault.ts` → `calculateVolumeUsd()`, volume tracking in `handleMint()` and `handleBurn()`
- `src/math-utils.ts` → `exp()`

### Leverage Tiers
- Positive values (1-3): Long positions with increasing leverage
- Negative values (-1 to -3): Short positions with increasing leverage
- 0: No leverage (not used in practice)

### Cost Basis Tracking
The subgraph tracks cost basis for positions in three different units:
- `collateralTotal`: Total cost basis denominated in collateral token units
- `dollarTotal`: Total cost basis denominated in USD
- `debtTokenTotal`: Total cost basis denominated in debt token units

### Price Fetching
Prices are fetched from Uniswap V3 pools:
- Primary pools are checked first (0.3% fee tier)
- Falls back to other fee tiers if no liquidity
- Returns 0 if no pool exists or has no liquidity
- Optional fields (like `sirEthPrice`) may be null when price is unavailable

## Event Handlers

### Vault Events
- `VaultInitialized`: Creates new vault entity
- `ReservesChanged`: Updates vault reserves and rates
- `VaultNewTax`: Updates vault tax rate
- `Mint`: Creates/updates APE positions
- `Burn`: Updates/closes APE positions

### TEA Events
- `TransferSingle`: Updates TEA positions
- `TransferBatch`: Batch updates TEA positions

### APE Events
- `Transfer`: Tracks APE token transfers between users

### SIR Events
- `DividendsPaid`: Records dividend distributions
- `RewardsClaimed`: Tracks dividend claims
- `AuctionStarted`: Creates new auction
- `BidReceived`: Updates auction bids
- `AuctionedTokensSentToWinner`: Marks auction as claimed

## Development Commands

```bash
# Install dependencies
npm install

# Generate TypeScript types from schema
npm run codegen

# Build the subgraph
npm run build

# Deploy to The Graph
npm run deploy
```

## Notes for Developers

1. **BigDecimal vs BigInt**: USD values use BigDecimal for precision, token amounts use BigInt
2. **Immutable Entities**: Historical records (Dividend, ApePositionClosed, AuctionsHistory) are immutable
3. **Entity Links**: Use `@link` directive for entity relationships, accessed via `.load()` in mappings
4. **Price Handling**: Always check if prices are zero before using them, as this indicates no available price data
5. **Address Format**: All addresses stored as Bytes type for consistency