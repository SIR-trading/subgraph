// Consolidated mappings file for optimized subgraph
// Combines tea.ts and auction.ts handlers to reduce redundancy

import { Address, BigInt, Bytes, BigDecimal, store } from "@graphprotocol/graph-ts";
import {
  AuctionedTokensSentToWinner,
  AuctionStarted,
  BidReceived,
  DividendsPaid,
  RewardsClaimed,
} from "../../generated/Claims/Sir";
import {
  Auction,
  AuctionsParticipant,
  AuctionStats,
  CurrentAuction,
  Dividend,
} from "../../generated/schema";
import { Vault as VaultContract } from "../../generated/Claims/Vault";
import { sirAddress, vaultAddress, wethAddress } from "../contracts";
import { getBestPoolPrice, generateUserPositionId, loadOrCreateToken } from "../helpers";

// ===== DIVIDEND HANDLERS =====

/**
 * Handles dividend payments to SIR token stakers
 * Creates a new Dividend entity with ETH amount, staked SIR amount, and SIR/ETH price
 */
export function handleDividendsPaid(event: DividendsPaid): void {
  // Create unique entity ID using transaction hash
  const dividendsEntity = new Dividend(event.transaction.hash);
  
  // Get current SIR token price in ETH directly from Uniswap pool
  const sirAddress_addr = Address.fromString(sirAddress);
  const wethAddress_addr = Address.fromString(wethAddress);
  const sirTokenEthPrice = getBestPoolPrice(sirAddress_addr, wethAddress_addr);

  // Set entity properties from event parameters
  dividendsEntity.timestamp = event.block.timestamp;
  dividendsEntity.ethAmount = event.params.amountETH;
  dividendsEntity.stakedAmount = event.params.amountStakedSIR;
  // Only set price if it's not zero (pool exists and has liquidity)
  if (!sirTokenEthPrice.equals(BigDecimal.fromString("0"))) {
    dividendsEntity.sirEthPrice = sirTokenEthPrice;
  }
  dividendsEntity.save();
}

/**
 * Handles reward claims for TEA token holders
 * Removes user position if both TEA balance and unclaimed rewards are zero
 */
export function handleClaim(event: RewardsClaimed): void {
  const vaultId = event.params.vaultId;
  const userAddress = event.params.contributor;
  
  // Get vault contract instance to check balances
  const vaultContract = VaultContract.bind(Address.fromString(vaultAddress));
  const userTeaBalance = vaultContract.balanceOf(userAddress, vaultId);
  const userUnclaimedRewards = vaultContract.unclaimedRewards(vaultId, userAddress);

  // Remove user position if both TEA balance and unclaimed rewards are zero
  const hasNoTeaTokens = userTeaBalance.equals(BigInt.fromI32(0));
  const hasNoUnclaimedRewards = userUnclaimedRewards.equals(BigInt.fromI32(0));
  
  if (hasNoTeaTokens && hasNoUnclaimedRewards) {
    const userPositionId = generateUserPositionId(userAddress, vaultId);
    store.remove("TeaPosition", userPositionId.toHexString());
  }
}

// ===== AUCTION HANDLERS =====

const STATS_ID = Bytes.fromUTF8("stats");

function loadOrCreateStats(): AuctionStats {
  let stats = AuctionStats.load(STATS_ID);
  if (!stats) {
    stats = new AuctionStats(STATS_ID);
    stats.totalAuctions = BigInt.zero();
    stats.save();
  }
  return stats;
}

export function handleAuctionStarted(event: AuctionStarted): void {
  const tokenAddress = event.params.token;
  const startTime = event.block.timestamp;

  // Create unique auction ID: token address + startTime
  const auctionId = Bytes.fromUTF8(
    tokenAddress.toHexString() + "-" + startTime.toString()
  );

  // Check if there's a current auction for this token and clean up its participants
  const currentAuctionLookup = CurrentAuction.load(tokenAddress);
  if (currentAuctionLookup) {
    const previousAuction = Auction.load(currentAuctionLookup.auction);
    if (previousAuction) {
      // Clean up participants from previous auction
      const participants = previousAuction.participants.load();
      participants.forEach((participant) => {
        store.remove("AuctionsParticipant", participant.id.toHexString());
      });
    }
  }

  // Get or create Token entity for the auction token
  const tokenEntity = loadOrCreateToken(tokenAddress);

  // Create new auction with unique ID
  const auction = new Auction(auctionId);
  auction.token = tokenEntity.id;
  auction.startTime = startTime;
  auction.amount = event.params.feesToBeAuctioned;
  auction.highestBid = BigInt.zero();
  auction.highestBidder = Address.zero();
  auction.isClaimed = false;
  auction.save();

  // Update CurrentAuction lookup
  let currentAuction = CurrentAuction.load(tokenAddress);
  if (!currentAuction) {
    currentAuction = new CurrentAuction(tokenAddress);
  }
  currentAuction.auction = auctionId;
  currentAuction.save();

  // Increment total auctions counter
  const stats = loadOrCreateStats();
  stats.totalAuctions = stats.totalAuctions.plus(BigInt.fromI32(1));
  stats.save();
}

export function handleBidReceived(event: BidReceived): void {
  // Look up current auction via CurrentAuction entity
  const currentAuctionLookup = CurrentAuction.load(event.params.token);
  if (currentAuctionLookup == null) {
    return;
  }

  const auction = Auction.load(currentAuctionLookup.auction);
  if (auction == null) {
    return;
  }

  // Use auction ID + bidder for participant ID (unique per auction)
  const userID = Bytes.fromUTF8(auction.id.toHexString() + event.params.bidder.toHexString());
  let participant = AuctionsParticipant.load(userID);

  if (!participant) {
    participant = new AuctionsParticipant(userID);
    participant.auctionId = auction.id;
    participant.user = event.params.bidder;
    participant.bid = BigInt.zero();
  }

  // Update participant's bid
  participant.bid = event.params.newBid;
  participant.save();

  // Update auction if this is the highest bid
  if (event.params.newBid.gt(auction.highestBid)) {
    auction.highestBid = event.params.newBid;
    auction.highestBidder = event.params.bidder;
    auction.save();
  }
}

export function handleAuctionedClaimed(event: AuctionedTokensSentToWinner): void {
  // Look up current auction via CurrentAuction entity
  const currentAuctionLookup = CurrentAuction.load(event.params.token);
  if (currentAuctionLookup == null) {
    return;
  }

  const auction = Auction.load(currentAuctionLookup.auction);
  if (auction == null) {
    return;
  }

  auction.isClaimed = true;
  auction.save();
}
