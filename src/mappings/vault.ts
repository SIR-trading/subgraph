import { VaultInitialized } from "../../generated/VaultExternal/VaultExternal";
import { ApePosition, Vault, ClosedApePosition } from "../../generated/schema";
import { ERC20 } from "../../generated/VaultExternal/ERC20";
import { Sir } from "../../generated/Tvl/Sir";
import { APE } from "../../generated/templates";
import { Address, BigInt, DataSourceContext, BigDecimal } from "@graphprotocol/graph-ts";
import { sirAddress } from "../contracts";
import { USDC, WETH, getTokenUsdPrice, priceToScaledBigInt, UNISWAP_V3_FACTORY } from "../helpers";
import {
  Burn,
  Mint,
  ReservesChanged,
  VaultNewTax,
} from "../../generated/Claims/Vault";

export function handleVaultTax(event: VaultNewTax): void {
  const multiplier = 100000;
  const tax = BigInt.fromU64(event.params.tax).times(
    BigInt.fromU32(multiplier)
  );
  const cumulativeTax = BigInt.fromU64(event.params.cumulativeTax);
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
  const total = params.reserveApes.plus(params.reserveLPers);

  const vault = Vault.load(event.params.vaultId.toHexString());
  if (vault) {
    vault.apeCollateral = params.reserveApes;
    vault.teaCollateral = params.reserveLPers;

    vault.totalValue = total;

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

export function handleMint(event: Mint): void {
  if (event.params.isAPE === false) {
    // this is not APE mint, so we do not handle it
    return;
  }
  const vault = Vault.load(event.params.vaultId.toHexString());
  const user = event.params.minter.toHexString();
  if (!vault) {
    return;
  }

  const apePositionId = user + "-" + event.params.vaultId.toHexString();

  let apePosition = ApePosition.load(apePositionId);
  if (!apePosition) {
    apePosition = new ApePosition(apePositionId);
    apePosition.vaultId = event.params.vaultId.toHexString();
    apePosition.user = event.params.minter;
    apePosition.collateralTotal = BigInt.fromI32(0);
    apePosition.dollarTotal = BigInt.fromI32(0);
    apePosition.apeBalance = BigInt.fromI32(0);
  }

  const collateralDeposited = event.params.collateralIn.plus(
    event.params.collateralFeeToLPers.plus(event.params.collateralFeeToStakers)
  );

  const collateralPriceUsd = getCollateralUsdPrice(vault.collateralToken);

  const dollarCollateralDeposited = collateralDeposited
    .times(collateralPriceUsd)
    .div(BigInt.fromI32(10).pow(u8(6))); // remove USDC decimals

  // Current APE position update
  apePosition.collateralTotal =
    apePosition.collateralTotal.plus(collateralDeposited);
  apePosition.dollarTotal = apePosition.dollarTotal.plus(
    dollarCollateralDeposited
  );
  apePosition.apeBalance = apePosition.apeBalance.plus(event.params.tokenOut);

  apePosition.save();
}

export function handleBurn(event: Burn): void {
  if (event.params.isAPE === false) {
    // this is not APE mint, so we do not handle it
    return;
  }
  const vault = Vault.load(event.params.vaultId.toHexString());
  const user = event.params.burner.toHexString();
  if (!vault) {
    return;
  }
  const apePositionId = user + "-" + event.params.vaultId.toHexString();
  const apePosition = ApePosition.load(apePositionId);
  if (!apePosition) {
    return;
  }

  const closedApePosition = new ClosedApePosition(
    event.transaction.hash.toHexString()
  );

  closedApePosition.vaultId = event.params.vaultId.toHexString();
  closedApePosition.user = event.params.burner;

  const collateralPriceUsd = getCollateralUsdPrice(vault.collateralToken);

  // Closed APE position update
  closedApePosition.collateralDeposited = apePosition.collateralTotal
    .times(event.params.tokenIn)
    .div(apePosition.apeBalance);
  closedApePosition.dollarDeposited = apePosition.dollarTotal
    .times(event.params.tokenIn)
    .div(apePosition.apeBalance);
  closedApePosition.collateralWithdrawn = event.params.collateralWithdrawn;
  closedApePosition.dollarWithdrawn = closedApePosition.collateralWithdrawn
    .times(collateralPriceUsd)
    .div(BigInt.fromI32(10).pow(u8(6))); // remove USDC decimals
  closedApePosition.timestamp = event.block.timestamp;
  closedApePosition.decimal = ERC20.bind(
    Address.fromString(vault.collateralToken)
  ).decimals();

  // Current APE position update
  apePosition.collateralTotal = apePosition.collateralTotal.minus(
    closedApePosition.collateralDeposited
  );
  apePosition.dollarTotal = apePosition.dollarTotal.minus(
    closedApePosition.dollarDeposited
  );
  apePosition.apeBalance = apePosition.apeBalance.minus(event.params.tokenIn);

  apePosition.save();
  closedApePosition.save();
}

function getCollateralUsdPrice(_token: string): BigInt {
  const token = Address.fromString(_token);
  const priceUsd = getTokenUsdPrice(token);
  return priceToScaledBigInt(priceUsd, 6); // USDC has 6 decimals
}

function getVaultUsdValue(Vault: Vault): BigInt {
  const collateralToken = Address.fromString(Vault.collateralToken);
  const priceUsd = getTokenUsdPrice(collateralToken);
  const priceScaled = priceToScaledBigInt(priceUsd, 6); // USDC has 6 decimals
  
  if (collateralToken.equals(USDC)) {
    return Vault.totalValue;
  }
  
  if (collateralToken.equals(WETH)) {
    return Vault.totalValue
      .times(priceScaled)
      .div(BigInt.fromI32(10).pow(18));
  } else {
    const decimals = ERC20.bind(collateralToken).decimals();
    return Vault.totalValue
      .times(priceScaled)
      .div(BigInt.fromI32(10).pow(decimals as u8));
  }
}
function getUsdcPrice(Vault: Vault, collateralDecimals: u8): BigInt {
  const CollateralAddress = Address.fromString(Vault.collateralToken);
  const priceUsd = getTokenUsdPrice(CollateralAddress);
  
  if (priceUsd.equals(BigDecimal.fromString("0"))) {
    return BigInt.fromI32(0);
  }
  
  // Convert BigDecimal price to scaled BigInt for calculation
  const priceScaled = priceToScaledBigInt(priceUsd, 6); // USDC has 6 decimals
  
  const totalValueUsd = Vault.totalValue
    .times(priceScaled)
    .div(BigInt.fromI32(10).pow(collateralDecimals));
  
  return totalValueUsd;
}
