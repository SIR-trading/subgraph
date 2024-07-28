import { VaultInitialized } from "../../generated/VaultExternal/VaultExternal";
import { Mint, Burn } from "../../generated/Vault/Vault";
import { Vault } from "../../generated/schema";
import { ERC20 } from "../../generated/VaultExternal/ERC20";
import { APE } from "../../generated/templates";
import { BigInt, DataSourceContext, bigInt } from "@graphprotocol/graph-ts";

export function handleVaultInitialized(event: VaultInitialized): void {
  const collateralTokenContract = ERC20.bind(event.params.collateralToken);
  const debtTokenContract = ERC20.bind(event.params.debtToken);
  const debtSymbol = debtTokenContract.symbol();
  const collateralSymbol = collateralTokenContract.symbol();
  let vault = Vault.load(event.params.vaultId.toHexString());
  let context = new DataSourceContext();
  context.setString("apeAddress", event.params.apeAddress.toHexString());
  context.setString("collateralSymbol", collateralSymbol);
  context.setString(
    "collateralToken",
    event.params.collateralToken.toHexString(),
  );
  context.setString("debtSymbol", debtSymbol);
  context.setString("debtToken", event.params.debtToken.toHexString());
  context.setString("leverageTier", event.params.leverageTier.toString());
  context.setString("vaultId", event.params.vaultId.toString());

  APE.createWithContext(event.params.apeAddress, context);
  if (vault) {
    return;
  } else {
    vault = new Vault(event.params.vaultId.toHexString());
    vault.collateralToken = event.params.collateralToken.toHexString();
    vault.debtToken = event.params.debtToken.toHex();
    vault.leverageTier = event.params.leverageTier;
    vault.collateralSymbol = collateralSymbol;
    vault.debtSymbol = debtSymbol;
    vault.vaultId = event.params.vaultId.toString();
    vault.totalValueLocked = BigInt.fromI32(0);
    vault.save();
    return;
  }
}

export function handleMint(event: Mint): void {
  const collateralIn = event.params.collateralIn;
  const feeA = event.params.collateralFeeToLPers;
  const feeB = event.params.collateralFeeToStakers;
  const fee = feeA.plus(feeB);
  const total = collateralIn.minus(fee);

  let vault = Vault.load(event.params.vaultId.toHexString());
  if (vault) {
    const newLocked = vault.totalValueLocked.plus(total);
    vault.totalValueLocked = newLocked;
    vault.save();
  }
}

export function handleBurn(event: Burn): void {
  const collateralOut = event.params.collateralWithdrawn;

  let vault = Vault.load(event.params.vaultId.toHexString());
  if (vault) {
    const newLocked = vault.totalValueLocked.minus(collateralOut);
    vault.totalValueLocked = newLocked;
    vault.save();
  }
}
