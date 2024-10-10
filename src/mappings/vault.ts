import { VaultInitialized } from "../../generated/VaultExternal/VaultExternal";
import { Mint, Burn, VaultNewTax } from "../../generated/Vault/Vault";
import { Vault } from "../../generated/schema";
import { ERC20 } from "../../generated/VaultExternal/ERC20";
import { Sir } from "../../generated/Tvl/Sir";
import { Vault as VaultContract } from "../../generated/Vault/Vault";
import { APE } from "../../generated/templates";
import { Address, BigInt, DataSourceContext } from "@graphprotocol/graph-ts";
import { sirAddress } from "../contracts";

export function handleVaultTax(event: VaultNewTax): void {
  const tax = BigInt.fromU64(event.params.tax);
  const culmTax = BigInt.fromU64(event.params.cumTax);
  const contract = Sir.bind(Address.fromString(sirAddress));
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
  const collateralDecimals = collateralTokenContract.decimals();
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
    vault.apeDecimals = collateralDecimals;
    vault.collateralSymbol = collateralSymbol;
    vault.debtSymbol = debtSymbol;
    vault.vaultId = event.params.vaultId.toString();
    vault.apeAddress = event.params.ape;
    vault.totalValue = BigInt.fromI32(0);
    vault.teaCollateral = BigInt.fromI32(0);
    vault.apeCollateral = BigInt.fromI32(0);
    vault.lockedLiquidity = BigInt.fromI32(0);
    vault.taxAmount = BigInt.fromI32(0);
    vault.totalTea = BigInt.fromI32(0);
    vault.save();
    return;
  }
}

export function handleMint(event: Mint): void {
  const params = event.params;
  const fee = event.params.collateralFeeToLPers;
  const total = params.collateralIn.plus(fee);

  let vault = Vault.load(event.params.vaultId.toHexString());
  if (vault) {
    if (event.params.isAPE) {
      vault.apeCollateral = vault.apeCollateral.plus(params.collateralIn);

      vault.teaCollateral = vault.teaCollateral.plus(
        event.params.collateralFeeToLPers,
      );
    } else {
      vault.teaCollateral = vault.teaCollateral.plus(
        params.collateralIn.plus(params.collateralFeeToLPers),
      );
    }
    vault.totalValue = vault.totalValue.plus(total);
    vault.save();
  }
}

export function handleBurn(event: Burn): void {
  const params = event.params;

  const collateralOut = params.collateralWithdrawn.plus(
    params.collateralFeeToStakers,
  );

  let vault = Vault.load(event.params.vaultId.toHexString());

  if (vault) {
    if (event.params.isAPE) {
      vault.apeCollateral = vault.apeCollateral.minus(
        params.collateralWithdrawn.plus(
          params.collateralFeeToStakers.plus(params.collateralFeeToLPers),
        ),
      );
      vault.teaCollateral = vault.teaCollateral.plus(
        params.collateralFeeToLPers,
      );
    } else {
      vault.teaCollateral = vault.teaCollateral.minus(
        params.collateralWithdrawn.plus(params.collateralFeeToStakers),
      );
    }
    vault.totalValue = vault.totalValue.minus(collateralOut);
    vault.save();
  }
}
