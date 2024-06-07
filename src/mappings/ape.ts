import { dataSource } from "@graphprotocol/graph-ts";
import { UserPosition } from "../../generated/schema";
import { Transfer } from "../../generated/templates/APE/APE";

export function handleTransferFrom(event: Transfer): void {
  let context = dataSource.context();
  let apeAddress = context.getString("apeAddress");
  const up = UserPosition.load(event.params.to.toHexString() + apeAddress);

  if (up) {
    up.balance = event.params.amount.plus(up.balance);
    up.save();
  } else {
    const newUP = new UserPosition(event.params.to.toHexString() + apeAddress);
    newUP.User = event.params.to;
    newUP.balance = event.params.amount;
    newUP.APE = apeAddress;
    newUP.save();
    return;
  }
}
