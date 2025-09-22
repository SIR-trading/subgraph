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