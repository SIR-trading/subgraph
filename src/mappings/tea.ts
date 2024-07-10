import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  Vault,
  transferbatch,
  transfersingle,
} from "../../generated/Vault/Vault";
import { UserPositionTea } from "../../generated/schema";
import { ERC20 } from "../../generated/VaultExternal/ERC20";
export function handleSingleTransfer(event: transfersingle): void {
  const amount = event.params.amount;
  const to = event.params.to;
  const from = event.params.from;
  const vaultId = event.params.id;
  handleTransfer(vaultId, to, from, amount);
}

function handleTransfer(
  vaultId: BigInt,
  to: Address,
  from: Address,
  amount: BigInt,
): void {
  const contract = Vault.bind(
    Address.fromString("0x43dfd957bb91b568176e976a8d4e8ab4e94aebfd"),
  );
  // address debtToken;
  // address collateralToken;
  // int8 leverageTier;

  const senderUserPosition = UserPositionTea.load(
    from.toHexString() + vaultId.toHexString(),
  );
  if (senderUserPosition) {
    senderUserPosition.balance = senderUserPosition.balance.minus(amount);
    senderUserPosition.save();
  }

  const userPosition = UserPositionTea.load(
    to.toHexString() + vaultId.toHexString(),
  );

  if (userPosition !== null) {
    userPosition.balance = userPosition.balance.plus(amount);
    userPosition.save();
  } else {
    const params = contract.paramsbyid(vaultId);
    const debtToken = params.value0;
    const collToken = params.value1;
    const leverageTier = params.value2;
    const collateralTokenContract = ERC20.bind(collToken);
    const debtTokenContract = ERC20.bind(debtToken);
    const userPosition = new UserPositionTea(
      to.toHexString() + vaultId.toHexString(),
    );
    userPosition.user = to;
    userPosition.balance = amount;
    userPosition.debtToken = debtToken;
    userPosition.collateralToken = collToken;
    userPosition.leverageTier = leverageTier.toString();
    userPosition.debtSymbol = debtTokenContract.symbol();
    userPosition.collateralSymbol = collateralTokenContract.symbol();
    userPosition.save();
  }
}

export function handleBatchTransfer(event: transferbatch): void {
  const vaults = event.params.vaultids;
  const to = event.params.to;
  const from = event.params.to;
  const amounts = event.params.amounts;
  for (let i = 0; i++; i < vaults.length) {
    const amount = amounts[i];
    handleTransfer(vaults[i], to, from, amount);
  }
}

// const contract = Vault.bind(
//   Address.fromString("0x43dfd957bb91b568176e976a8d4e8ab4e94aebfd"),
// );
// // address debtToken;
// // address collateralToken;
// // int8 leverageTier;
//
// const senderUserPosition = UserPositionTea.load(
//   event.params.from.toHexString() + vaultId.toHexString(),
// );
// if (senderUserPosition) {
//   senderUserPosition.balance = senderUserPosition.balance.minus(amount);
//   senderUserPosition.save();
// }
//
// const userPosition = UserPositionTea.load(
//   to.toHexString() + vaultId.toHexString(),
// );
//
// if (userPosition !== null) {
//   userPosition.balance = userPosition.balance.plus(amount);
//   userPosition.save();
// } else {
//   const params = contract.paramsbyid(vaultId);
//   const debtToken = params.value0;
//   const collToken = params.value1;
//   const leverageTier = params.value2;
//   const collateralTokenContract = ERC20.bind(collToken);
//   const debtTokenContract = ERC20.bind(debtToken);
//   const userPosition = new UserPositionTea(
//     to.toHexString() + vaultId.toHexString(),
//   );
//   userPosition.user = to;
//   userPosition.balance = amount;
//   userPosition.debtToken = debtToken;
//   userPosition.collateralToken = collToken;
//   userPosition.leverageTier = leverageTier.toString();
//   userPosition.debtSymbol = debtTokenContract.symbol();
//   userPosition.collateralSymbol = collateralTokenContract.symbol();
//   userPosition.save();
// }
