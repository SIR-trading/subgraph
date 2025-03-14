import { store } from "@graphprotocol/graph-ts";
import { AuctionStarted, BidReceived } from "../../generated/Auctions/Sir";
import {
  Auctions,
  AuctionsParticipants,
  AuctionsHistory,
} from "../../generated/schema";

export function handleAuctionStarted(event: AuctionStarted): void {
  const auctionId = event.params.token.toHex();
  let auction = Auctions.load(auctionId);
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
      store.remove("AuctionsParticipants", participant.id);
    });
    auction = null;
  }

  auction = new Auctions(auctionId);
  auction.token = event.params.token;
  auction.startTime = event.block.timestamp;
  auction.amount = event.params.feesToBeAuctioned;

  auction.save();
}

export function handleBidReceived(event: BidReceived): void {
  const auction = Auctions.load(event.params.token.toHex());
  const userID = event.params.token.toHex() + "-" + event.params.bidder.toHex();

  const participants = AuctionsParticipants.load(userID);
  if (auction == null) {
    return;
  }

  auction.highestBid = event.params.newBid;
  auction.highestBidder = event.params.bidder;

  if (participants == null) {
    const participants = new AuctionsParticipants(userID);
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
