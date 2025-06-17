import { VaultInitialized } from "../../generated/VaultExternal/VaultExternal";
import { VaultNewTax } from "../../generated/Vault/Vault";
import { Vault } from "../../generated/schema";
import { ERC20 } from "../../generated/VaultExternal/ERC20";
import { Sir } from "../../generated/Tvl/Sir";
import { APE } from "../../generated/templates";
import { Address, BigInt, DataSourceContext } from "@graphprotocol/graph-ts";
import { sirAddress } from "../contracts";
import { USDC, WETH, getUsdPriceWeth, quoteToken } from "../helpers";
import { ReservesChanged } from "../../generated/Claims/Vault";

export function handleVaultTax(event: VaultNewTax): void {
  const multiplier = 100000;
  const tax = BigInt.fromU64(event.params.tax).times(
    BigInt.fromU32(multiplier)
  );
  const cumulativeTax = BigInt.fromU64(event.params.cumTax);
  const contract = Sir.bind(Address.fromString(sirAddress));
  const issuanceRate = contract.LP_ISSUANCE_FIRST_3_YEARS();
  let vault = Vault.load(event.params.vault.toHexString());
  if (!cumulativeTax.gt(BigInt.fromI32(0))) {
    if (vault) {
      vault.taxAmount = BigInt.fromI32(0);
      vault.save();
    } else {
      vault = new Vault(event.params.vault.toHexString());
      vault.taxAmount = BigInt.fromI32(0);
      vault.save();
    }
    return;
  } // ensure no division by 0
  const rate = tax
    .div(cumulativeTax)
    .times(issuanceRate)
    .div(BigInt.fromU32(multiplier));

  if (vault) {
    vault.taxAmount = rate;
    vault.save();
  } else {
    vault = new Vault(event.params.vault.toHexString());
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
  const context = new DataSourceContext();
  context.setString("apeAddress", event.params.ape.toHexString());
  context.setString("collateralSymbol", collateralSymbol);
  context.setString(
    "collateralToken",
    event.params.collateralToken.toHexString()
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
    vault.totalValueUsd = BigInt.fromI32(0);
    vault.totalVolumeUsd = BigInt.fromI32(0);
    vault.sortKey = BigInt.fromI32(0);
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

export function handleReservesChanged(event: ReservesChanged): void {
  const params = event.params;
  const isMint = params.isMint;

  if (isMint) {
    handleMint(event);
  } else {
    handleBurn(event);
  }
}

export function handleMint(event: ReservesChanged): void {
  const params = event.params;
  const fee = event.params.reserveLPers;
  const total = params.reserveApes.plus(fee);

  const vault = Vault.load(event.params.vaultId.toHexString());
  if (vault) {
    if (event.params.isAPE) {
      vault.apeCollateral = vault.apeCollateral.plus(params.reserveApes);

      vault.teaCollateral = vault.teaCollateral.plus(event.params.reserveLPers);
    } else {
      vault.teaCollateral = vault.teaCollateral.plus(
        params.reserveApes.plus(params.reserveLPers)
      );
    }
    vault.totalValue = vault.totalValue.plus(total);

    vault.totalValueUsd = getVaultUsdValue(vault);
    vault.totalVolumeUsd = vault.totalVolumeUsd.plus(getVaultUsdValue(vault));
    if (vault.taxAmount.gt(BigInt.fromI32(0))) {
      vault.sortKey = BigInt.fromI32(10).pow(20).plus(vault.totalVolumeUsd);
    } else {
      vault.sortKey = vault.totalVolumeUsd;
    }
    vault.save();
  }
}

export function handleBurn(event: ReservesChanged): void {
  const params = event.params;

  const collateralOut = params.reserveApes.plus(params.reserveLPers);

  const vault = Vault.load(event.params.vaultId.toHexString());

  if (vault) {
    if (event.params.isAPE) {
      vault.apeCollateral = vault.apeCollateral.minus(
        params.reserveApes.plus(params.reserveLPers.plus(params.reserveLPers))
      );
      vault.teaCollateral = vault.teaCollateral.plus(params.reserveLPers);
    } else {
      vault.teaCollateral = vault.teaCollateral.minus(
        params.reserveApes.plus(params.reserveLPers)
      );
    }
    vault.totalValue = vault.totalValue.minus(collateralOut);
    vault.totalValueUsd = getVaultUsdValue(vault);

    vault.totalVolumeUsd = vault.totalVolumeUsd.plus(getVaultUsdValue(vault));
    if (vault.taxAmount.gt(BigInt.fromI32(0))) {
      vault.sortKey = BigInt.fromI32(10).pow(20).plus(vault.totalVolumeUsd);
    } else {
      vault.sortKey = vault.totalVolumeUsd;
    }
    vault.save();
  }
}

function getVaultUsdValue(Vault: Vault): BigInt {
  if (Address.fromString(Vault.collateralToken).equals(USDC)) {
    return Vault.totalValue;
  }
  if (Address.fromString(Vault.collateralToken).equals(WETH)) {
    const quoteUsdcPrice = quoteToken(WETH, USDC, 3000);
    return Vault.totalValue
      .times(quoteUsdcPrice.value)
      .div(BigInt.fromI32(10).pow(18));
  } else {
    const decimals = ERC20.bind(
      Address.fromString(Vault.collateralToken),
    ).decimals();
    const priceFromUsdc = getUsdcPrice(Vault, u8(decimals));
    if (priceFromUsdc.equals(BigInt.fromI32(0))) {
      // maybe there is not usdc/collateral pool
      // try WETH instead
      return getUsdPriceFromWethVault(Vault);
    }
    return priceFromUsdc;
  }
}
function getUsdPriceFromWethVault(vault: Vault): BigInt {
  return getUsdPriceWeth(vault.collateralToken);
}
function getUsdcPrice(Vault: Vault, collateralDecimals: u8): BigInt {
  const USDC = Address.fromString("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
  const CollateralAddress = Address.fromString(Vault.collateralToken);
  const collateralPriceUsd = quoteToken(CollateralAddress, USDC, 3000);
  if (collateralPriceUsd.value.equals(BigInt.fromI32(0))) {
    return BigInt.fromI32(0);
  }
  // ======
  const totalValueUsd = Vault.totalValue
    .times(collateralPriceUsd.value)
    .div(BigInt.fromI32(10).pow(collateralDecimals));
  // =======
  return totalValueUsd;
}
