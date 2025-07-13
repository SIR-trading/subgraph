import { ApePosition } from "../../generated/schema";
import { Transfer } from "../../generated/templates/APE/APE";
import { Address, BigInt, dataSource, store } from "@graphprotocol/graph-ts";

import { ERC20 } from "../../generated/templates/APE/ERC20";
import { generateApePositionId } from "../helpers";

export function handleTransferFrom(event: Transfer): void {
  // Skip mint and burn operations (from/to zero address)
  // These are handled by vault.ts handleMint/handleBurn functions
  const zeroAddress = Address.zero();
  if (event.params.from.equals(zeroAddress) || event.params.to.equals(zeroAddress)) {
    return;
  }

  const context = dataSource.context();
  const apeAddress = context.getString("apeAddress");
  const debtToken = context.getString("debtToken");
  const debtSymbol = context.getString("debtSymbol");
  const collateralToken = context.getString("collateralToken");
  const collateralSymbol = context.getString("collateralSymbol");
  const leverageTier = context.getString("leverageTier");
  const vaultId = context.getString("vaultId");
  
  const vaultIdBigInt = BigInt.fromString(vaultId);
  const transferAmount = event.params.amount;
  
  // Load recipient and sender positions
  const recipientPositionId = generateApePositionId(event.params.to, vaultIdBigInt);
  let recipientPosition = ApePosition.load(recipientPositionId);
  
  const senderPositionId = generateApePositionId(event.params.from, vaultIdBigInt);
  const senderPosition = ApePosition.load(senderPositionId);
  
  if (senderPosition) {
    // Ensure position has cost tracking data
    if (senderPosition.balance.equals(BigInt.fromI32(0))) {
      // Handle edge case where position exists but has zero balance
      store.remove("ApePosition", senderPosition.id);
      return;
    }
    
    // Calculate the proportion being transferred
    const transferProportion = transferAmount.toBigDecimal().div(senderPosition.balance.toBigDecimal());
    
    // Calculate collateral and dollar amounts to transfer based on proportion
    const collateralToTransfer = senderPosition.collateralTotal.toBigDecimal().times(transferProportion);
    const dollarToTransfer = senderPosition.dollarTotal.toBigDecimal().times(transferProportion);
    
    // Update sender position
    senderPosition.balance = senderPosition.balance.minus(transferAmount);
    senderPosition.collateralTotal = senderPosition.collateralTotal.minus(BigInt.fromString(collateralToTransfer.truncate(0).toString()));
    senderPosition.dollarTotal = senderPosition.dollarTotal.minus(BigInt.fromString(dollarToTransfer.truncate(0).toString()));
    
    // Remove position if balance is zero
    if (senderPosition.balance.equals(BigInt.fromI32(0))) {
      store.remove("ApePosition", senderPosition.id);
    } else {
      senderPosition.save();
    }
    
    // Update or create recipient position
    if (recipientPosition) {
      // Merge positions with weighted average cost
      const newTotalBalance = recipientPosition.balance.plus(transferAmount);
      const newCollateralTotal = recipientPosition.collateralTotal.plus(BigInt.fromString(collateralToTransfer.truncate(0).toString()));
      const newDollarTotal = recipientPosition.dollarTotal.plus(BigInt.fromString(dollarToTransfer.truncate(0).toString()));
      
      recipientPosition.balance = newTotalBalance;
      recipientPosition.collateralTotal = newCollateralTotal;
      recipientPosition.dollarTotal = newDollarTotal;
      recipientPosition.save();
    } else {
      // Create new position with transferred amounts
      const collateralTokenAddress = Address.fromString(collateralToken);
      const collateralTokenContract = ERC20.bind(collateralTokenAddress);
      
      recipientPosition = new ApePosition(recipientPositionId);
      recipientPosition.user = event.params.to;
      recipientPosition.balance = transferAmount;
      recipientPosition.vaultId = vaultId;
      recipientPosition.decimals = collateralTokenContract.decimals();
      recipientPosition.ape = apeAddress;
      recipientPosition.collateralToken = collateralToken;
      recipientPosition.debtToken = debtToken;
      recipientPosition.debtSymbol = debtSymbol;
      recipientPosition.collateralSymbol = collateralSymbol;
      recipientPosition.leverageTier = leverageTier;
      recipientPosition.collateralTotal = BigInt.fromString(collateralToTransfer.truncate(0).toString());
      recipientPosition.dollarTotal = BigInt.fromString(dollarToTransfer.truncate(0).toString());
      recipientPosition.save();
    }
  } else {
    // Sender position doesn't exist - this shouldn't happen in normal operation
    // This indicates a data inconsistency or the position was created outside of our tracking
    // Log and skip this transfer to avoid creating invalid data
    return;
  }
}
