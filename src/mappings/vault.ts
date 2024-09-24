import { VaultInitialized } from "../../generated/VaultExternal/VaultExternal";
import { Mint, Burn, VaultNewTax } from "../../generated/Vault/Vault";
import { Vault } from "../../generated/schema";
import { ERC20 } from "../../generated/VaultExternal/ERC20";
import { Sir } from "../../generated/Tvl/Sir";
import { Vault as VaultContract } from "../../generated/Vault/Vault";
import { APE } from "../../generated/templates";
import { Address, BigInt, DataSourceContext } from "@graphprotocol/graph-ts";

export function handleVaultTax(event: VaultNewTax): void {
  const tax = BigInt.fromU64(event.params.tax);
  const culmTax = BigInt.fromU64(event.params.cumTax);
  const contract = Sir.bind(
    Address.fromString("0x3fc14d473E9967c81F03C669E928aC90e6306bDD"),
  );
  const issuanceRate = contract.LP_ISSUANCE_FIRST_3_YEARS();
  const rate = tax.div(culmTax).times(issuanceRate);
  let vault = Vault.load(event.params.vault.toHexString());
  if (vault) {
    vault.taxAmount = rate;
    vault.save();
  }
}
// POL [%] = vault.balanceOf(balanceOf(address(vault),vaultId)) / vault.totalSupply(vaultId) * 100
export function handleVaultInitialized(event: VaultInitialized): void {
  const collateralTokenContract = ERC20.bind(event.params.collateralToken);
  const debtTokenContract = ERC20.bind(event.params.debtToken);
  const debtSymbol = debtTokenContract.symbol();
  const collateralSymbol = collateralTokenContract.symbol();
  let vault = Vault.load(event.params.vaultId.toHexString());
  let context = new DataSourceContext();
  context.setString("apeAddress", event.params.ape.toHexString());
  context.setString("collateralSymbol", collateralSymbol);
  context.setString(
    "collateralToken",
    event.params.collateralToken.toHexString(),
  );
  context.setString("debtSymbol", debtSymbol);
  context.setString("debtToken", event.params.debtToken.toHexString());
  context.setString("leverageTier", event.params.leverageTier.toString());
  context.setString("vaultId", event.params.vaultId.toString());

  APE.createWithContext(event.params.ape, context);
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
    vault.totalApeLocked = BigInt.fromI32(0);

    vault.totalTeaLocked = BigInt.fromI32(0);
    vault.lockedLiquidity = BigInt.fromI32(0);
    vault.taxAmount = BigInt.fromI32(0);
    vault.save();
    return;
  }
}

export function handleMint(event: Mint): void {
  const collateralIn = event.params.collateralIn;
  const fee = event.params.collateralFeeToLPers;
  const total = collateralIn.plus(fee);

  let vault = Vault.load(event.params.vaultId.toHexString());
  if (vault) {
    const vaultContract = VaultContract.bind(event.address);
    const lockedLiquidity = vaultContract.balanceOf(
      event.address,
      event.params.vaultId,
    );
    const newLocked = event.params.isAPE
      ? vault.totalApeLocked.plus(total)
      : vault.totalTeaLocked.plus(total);
    vault.lockedLiquidity = lockedLiquidity;
    if (event.params.isAPE) {
      vault.totalApeLocked = newLocked;
    } else {
      vault.totalTeaLocked = newLocked;
    }
    vault.save();
  }
}

export function handleBurn(event: Burn): void {
  const collateralOut = event.params.collateralWithdrawn.plus(
    event.params.collateralFeeToStakers,
  );
  let vault = Vault.load(event.params.vaultId.toHexString());
  if (vault) {
    const vaultContract = VaultContract.bind(event.address);
    const lockedLiquidity = vaultContract.balanceOf(
      event.address,
      event.params.vaultId,
    );
    const newLocked = event.params.isAPE
      ? vault.totalApeLocked.minus(collateralOut)
      : vault.totalTeaLocked.minus(collateralOut);
    vault.lockedLiquidity = lockedLiquidity;
    if (event.params.isAPE) {
      vault.totalApeLocked = newLocked;
    } else {
      vault.totalTeaLocked = newLocked;
    }
    // const newLocked = vault.totalValueLocked.minus(collateralOut);
    // vault.totalValueLocked = newLocked;
    vault.lockedLiquidity = lockedLiquidity;
    vault.save();
  }
}
