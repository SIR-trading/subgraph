import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { quoterAddress, usdcAddress, wethAddress } from "./contracts";
import {
  Quoter as QuoterContract,
  Quoter__quoteExactInputSingleInputParamsStruct,
} from "../generated/VaultExternal/Quoter";
import { ERC20 } from "../generated/VaultExternal/ERC20";

export const USDC = Address.fromString(usdcAddress);
export const WETH = Address.fromString(wethAddress);
export function getUsdPriceWeth(collateralToken: string): BigInt {
  const quoteUsdcPrice = quoteToken(WETH, USDC, 3000);
  let quoteColl = quoteToken(Address.fromString(collateralToken), WETH, 3000);

  if (quoteColl.value.equals(BigInt.fromI32(0))) {
    // if quote fails try with higher fee
    quoteColl = quoteToken(Address.fromString(collateralToken), WETH, 10_000);
  }
  return quoteColl.value
    .times(quoteUsdcPrice.value)
    .div(BigInt.fromI32(10).pow(18));
}

export class QuoteResult {
  public value: BigInt;
  public tokenInDecimals: i32;
  constructor(value: BigInt, tokenInDecimals: i32) {
    this.value = value;
    this.tokenInDecimals = tokenInDecimals;
  }
}
export function quoteToken(
  tokenIn: Address,
  tokenOut: Address,
  fee: i32,
): QuoteResult {
  if (tokenIn.equals(tokenOut)) {
  }
  const quoter = QuoterContract.bind(Address.fromString(quoterAddress));
  const params = new Quoter__quoteExactInputSingleInputParamsStruct();
  params.push(ethereum.Value.fromAddress(tokenIn));
  params.push(ethereum.Value.fromAddress(tokenOut));

  const decimals = ERC20.bind(tokenIn).decimals();

  params.push(
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(10).pow(u8(decimals))),
  );
  params.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(fee)));
  params.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)));
  const quote = quoter.try_quoteExactInputSingle(params);
  if (quote.reverted) {
    return new QuoteResult(BigInt.fromI32(0), decimals);
  } else {
    return new QuoteResult(quote.value.value0, decimals);
  }
}
