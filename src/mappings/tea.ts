import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  Vault,
  TransferBatch,
  TransferSingle,
} from "../../generated/Vault/Vault";
import { UserPositionTea } from "../../generated/schema";
import { ERC20 } from "../../generated/VaultExternal/ERC20";
export function handleSingleTransfer(event: TransferSingle): void {
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
    Address.fromString("0x81f4f47aa3bBd154171C877b4d70F6C9EeCAb216"),
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
    const params = contract.paramsById(vaultId);
    const debtToken = params.debtToken;
    const collToken = params.collateralToken;
    const leverageTier = params.leverageTier;
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
    userPosition.vaultId = vaultId.toString();
    userPosition.save();
  }
}

export function handleBatchTransfer(event: TransferBatch): void {
  const vaults = event.params.vaultIds;
  const to = event.params.to;
  const from = event.params.to;
  const amounts = event.params.amounts;
  for (let i = 0; i++; i < vaults.length) {
    const amount = amounts[i];
    handleTransfer(vaults[i], to, from, amount);
  }
}
