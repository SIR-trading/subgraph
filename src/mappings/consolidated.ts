// Consolidated mappings file for optimized subgraph
// Combines tea.ts and auction.ts handlers to reduce redundancy

import { Address, BigInt, store } from "@graphprotocol/graph-ts";
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
  AuctionsHistory,
  Dividend,
} from "../../generated/schema";
import { Vault as VaultContract } from "../../generated/Claims/Vault";
import { sirAddress, vaultAddress, wethAddress } from "../contracts";
import { getBestPoolPrice, generateUserPositionId } from "../helpers";

// ===== DIVIDEND HANDLERS =====

/**
 * Handles dividend payments to SIR token stakers
 * Creates a new Dividend entity with ETH amount, staked SIR amount, and SIR/ETH price
 */
export function handleDividendsPaid(event: DividendsPaid): void {
  // Create unique entity ID using transaction hash
  const dividendsEntity = new Dividend(event.transaction.hash.toHex());
  
  // Get current SIR token price in ETH directly from Uniswap pool
  const sirAddress_addr = Address.fromString(sirAddress);
  const wethAddress_addr = Address.fromString(wethAddress);
  const sirTokenEthPrice = getBestPoolPrice(sirAddress_addr, wethAddress_addr);
  
  // Set entity properties from event parameters
  dividendsEntity.timestamp = event.block.timestamp;
  dividendsEntity.ethAmount = event.params.amountETH;
  dividendsEntity.stakedAmount = event.params.amountStakedSIR;
  dividendsEntity.sirEthPrice = sirTokenEthPrice;
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
    store.remove("TeaPosition", userPositionId);
  }
}

// ===== AUCTION HANDLERS =====

export function handleAuctionStarted(event: AuctionStarted): void {
  const auctionId = event.params.token.toHex();
  let auction = Auction.load(auctionId);
  
  if (auction) {
    // Move current auction to history
    const pastAuctionId = auctionId + "-" + auction.startTime.toString();
    const pastAuction = new AuctionsHistory(pastAuctionId);
    pastAuction.token = auction.token;
    pastAuction.startTime = auction.startTime;
    pastAuction.amount = auction.amount;
    pastAuction.highestBid = auction.highestBid;
    pastAuction.highestBidder = auction.highestBidder;
    pastAuction.save();

    // Clean up participants from previous auction
    const participants = auction.participants.load();
    participants.forEach((participant) => {
      store.remove("AuctionsParticipant", participant.id);
    });
  }

  // Create new auction
  auction = new Auction(auctionId);
  auction.token = event.params.token;
  auction.startTime = event.block.timestamp;
  auction.amount = event.params.feesToBeAuctioned;
  auction.highestBid = BigInt.zero();
  auction.highestBidder = Address.zero();
  auction.isClaimed = false;
  auction.save();
}

export function handleBidReceived(event: BidReceived): void {
  const auction = Auction.load(event.params.token.toHex());
  if (auction == null) {
    return;
  }

  const userID = event.params.token.toHex() + "-" + event.params.bidder.toHex();
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
  const auction = Auction.load(event.params.token.toHex());
  if (auction == null) {
    return;
  }

  auction.isClaimed = true;
  auction.save();
}
