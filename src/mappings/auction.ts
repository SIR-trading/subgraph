import { Address, BigInt, store } from "@graphprotocol/graph-ts";
import {
  AuctionedTokensSentToWinner,
  AuctionStarted,
  BidReceived,
} from "../../generated/Auctions/Sir";
import {
  Auction,
  AuctionsParticipant,
  AuctionsHistory,
} from "../../generated/schema";

export function handleAuctionStarted(event: AuctionStarted): void {
  const auctionId = event.params.token.toHex();
  let auction = Auction.load(auctionId);
  if (auction) {
    const pastAuctionId = auctionId + "-" + auction.startTime.toString();
    const pastAuction = new AuctionsHistory(pastAuctionId);
    pastAuction.token = auction.token;
    pastAuction.startTime = auction.startTime;
    pastAuction.amount = auction.amount;
    pastAuction.highestBid = auction.highestBid;
    pastAuction.highestBidder = auction.highestBidder;

    pastAuction.save();

    const participants = auction.participants.load();
    participants.forEach((participant) => {
      store.remove("AuctionsParticipant", participant.id);
    });
    auction = null;
  }

  auction = new Auction(auctionId);
  auction.token = event.params.token;
  auction.startTime = event.block.timestamp;
  auction.amount = event.params.feesToBeAuctioned;
  auction.highestBid = BigInt.zero();
  auction.highestBidder = Address.empty();

  auction.save();
}

export function handleBidReceived(event: BidReceived): void {
  const auction = Auction.load(event.params.token.toHex());
  const userID = event.params.token.toHex() + "-" + event.params.bidder.toHex();

  const participants = AuctionsParticipant.load(userID);
  if (auction == null) {
    return;
  }

  auction.highestBid = event.params.newBid;
  auction.highestBidder = event.params.bidder;

  if (participants == null) {
    const participants = new AuctionsParticipant(userID);
    participants.auctionId = auction.id;
    participants.user = event.params.bidder;
    participants.bid = event.params.newBid;
    participants.save();
  } else {
    participants.bid = event.params.newBid;
    participants.save();
  }

  auction.save();
}

export function handleAuctionedClaimed(
  event: AuctionedTokensSentToWinner
): void {
  const auctionId = event.params.token.toHex();
  const auction = Auction.load(auctionId);

  if (auction) {
    auction.highestBid = BigInt.zero();
  }
}
