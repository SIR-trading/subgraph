import { UserPosition } from "../../generated/schema";
import { Transfer } from "../../generated/templates/APE/APE";
import { dataSource } from "@graphprotocol/graph-ts";

export function handleTransferFrom(event: Transfer): void {
  let context = dataSource.context();
  let apeAddress = context.getString("apeAddress");
  let debtToken = context.getString("debtToken");
  let debtSymbol = context.getString("debtSymbol");
  let collateralToken = context.getString("collateralToken");
  let collateralSymbol = context.getString("collateralSymbol");
  let leverageTier = context.getString("leverageTier");
  let vaultId = context.getString("vaultId");
  const toUP = UserPosition.load(event.params.to.toHexString() + apeAddress);
  const fromUP = UserPosition.load(
    event.params.from.toHexString() + apeAddress,
  );
  if (fromUP) {
    fromUP.balance = fromUP.balance.minus(event.params.amount);
    fromUP.save();
  }

  if (toUP) {
    toUP.balance = event.params.amount.plus(toUP.balance);
    toUP.save();
  } else {
    const newUP = new UserPosition(event.params.to.toHexString() + apeAddress);
    newUP.User = event.params.to;
    newUP.balance = event.params.amount;
    newUP.vautlId = vaultId;
    newUP.APE = apeAddress;
    newUP.collateralToken = collateralToken;
    newUP.debtToken = debtToken;
    newUP.debtSymbol = debtSymbol;
    newUP.collateralSymbol = collateralSymbol;
    newUP.leverageTier = leverageTier;
    newUP.save();
  }

  return;
}
