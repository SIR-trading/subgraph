import { dataSource } from "@graphprotocol/graph-ts";
import { UserPosition } from "../../generated/schema";
import { Transfer } from "../../generated/templates/APE/APE";

export function handleTransferFrom(event: Transfer): void {
  let context = dataSource.context();
  let apeAddress = context.getString("apeAddress");
  const toUP = UserPosition.load(event.params.to.toHexString() + apeAddress);
  const fromUP = UserPosition.load(
    event.params.from.toHexString() + apeAddress
  );
  // TODO
  // NEED TO CHECK FOR BURNING
  if (toUP) {
    toUP.balance = event.params.amount.plus(toUP.balance);
    toUP.save();
  } else {
    const newUP = new UserPosition(event.params.to.toHexString() + apeAddress);
    newUP.User = event.params.to;
    newUP.balance = event.params.amount;
    newUP.APE = apeAddress;
    newUP.save();
    return;
  }
}
