import { VaultInitialized } from "../../generated/VaultExternal/VaultExternal";
import { Mint, Burn, VaultNewTax } from "../../generated/Vault/Vault";
import { Vault } from "../../generated/schema";
import { ERC20 } from "../../generated/VaultExternal/ERC20";
import { Sir } from "../../generated/Tvl/Sir";
import { APE } from "../../generated/templates";
import {
  Quoter as QuoterContract,
  Quoter__quoteExactInputSingleInputParamsStruct,
} from "../../generated/VaultExternal/Quoter";
import {
  Address,
  BigInt,
  DataSourceContext,
  ethereum,
} from "@graphprotocol/graph-ts";
import { sirAddress } from "../contracts";

export function handleVaultTax(event: VaultNewTax): void {
  const multiplier = 100000;
  const tax = BigInt.fromU64(event.params.tax).times(
    BigInt.fromU32(multiplier),
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
    vault.totalValueUsd = BigInt.fromI32(0);
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

  const vault = Vault.load(event.params.vaultId.toHexString());
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
    vault.totalValueUsd = getVaultUsdValue(vault);
    vault.save();
  }
}

export function handleBurn(event: Burn): void {
  const params = event.params;

  const collateralOut = params.collateralWithdrawn.plus(
    params.collateralFeeToStakers,
  );

  const vault = Vault.load(event.params.vaultId.toHexString());

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
    vault.totalValueUsd = getVaultUsdValue(vault);
    vault.save();
  }
}

function getVaultUsdValue(Vault: Vault): BigInt {
  const quoter = QuoterContract.bind(
    Address.fromString("0x5e55c9e631fae526cd4b0526c4818d6e0a9ef0e3"),
  );
  const USDC = Address.fromString("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
  if (Address.fromString(Vault.collateralToken).equals(USDC)) {
    return Vault.totalValue;
  }
  const params = new Quoter__quoteExactInputSingleInputParamsStruct();
  params.push(ethereum.Value.fromAddress(USDC));
  params.push(
    ethereum.Value.fromAddress(Address.fromString(Vault.collateralToken)),
  );
  const decimals = ERC20.bind(
    Address.fromString(Vault.collateralToken),
  ).decimals();

  params.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(10 * 10 ** 6)));
  params.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(3000)));
  params.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)));
  const quote = quoter.try_quoteExactInputSingle(params);
  if (quote.reverted) {
    return BigInt.fromI32(0);
  }
  const usdc = quote.value.value0;
  const d = u8(decimals) + u8(1);
  const oneTokenOfUsdc = BigInt.fromI32(10).pow(u8(d)).div(usdc);
  const e = u8(decimals) - u8(6);
  const result = Vault.totalValue
    .times(oneTokenOfUsdc)
    .div(BigInt.fromI32(10).pow(u8(e)));
  return result;
}
// Tuple([Address, Address, Uint(256), Uint(24), Uint(160)])

// tokenIn: USDC,
// tokenOut: token,
// amountIn: parseUnits("1000", 6),
// fee: 3000,
// sqrtPriceLimitX96: 0n,
