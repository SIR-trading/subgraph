import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  Vault,
  TransferBatch,
  TransferSingle,
} from "../../generated/Vault/Vault";
import { store } from "@graphprotocol/graph-ts";
import {
  Test,
  Vault as VaultSchema,
  UserPositionTea,
} from "../../generated/schema";
import { ERC20 } from "../../generated/VaultExternal/ERC20";
import { vaultAddress, zeroAddress } from "../contracts";
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
  const contract = Vault.bind(Address.fromString(vaultAddress));
  // address debtToken;
  // address collateralToken;
  // int8 leverageTier;

  if (to.equals(Address.fromString(vaultAddress))) {
    const vault = VaultSchema.load(vaultId.toHexString());
    if (vault) {
      vault.lockedLiquidity = vault.lockedLiquidity.plus(amount);
      vault.save();
    }
  }

  if (from.equals(Address.fromString(vaultAddress))) {
    const vault = VaultSchema.load(vaultId.toHexString());
    if (vault) {
      vault.lockedLiquidity = vault.lockedLiquidity.minus(amount);
      vault.save();
    }
  }

  if (from.equals(Address.fromString(zeroAddress))) {
    const vault = VaultSchema.load(vaultId.toHexString());
    if (vault) {
      vault.totalTea = vault.totalTea.plus(amount);
      vault.save();
    }
  }

  if (to.equals(Address.fromString(zeroAddress))) {
    const vault = VaultSchema.load(vaultId.toHexString());
    if (vault) {
      vault.totalTea = vault.totalTea.minus(amount);
      vault.save();
    }
  }

  const senderUserPosition = UserPositionTea.load(
    from.toHexString() + vaultId.toHexString(),
  );

  if (senderUserPosition) {
    senderUserPosition.balance = senderUserPosition.balance.minus(amount);
    if (senderUserPosition.balance.equals(BigInt.fromU64(0))) {
      //TODO make call to check if user has rewards
      store.remove("UserPositionTea", senderUserPosition.id);
    } else {
      senderUserPosition.save();
    }
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
