import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { quoterAddress, usdcAddress, wethAddress } from "./contracts";
import {
  Quoter as QuoterContract,
  Quoter__quoteExactInputSingleInputParamsStruct,
} from "../generated/VaultExternal/Quoter";
import { ERC20 } from "../generated/VaultExternal/ERC20";

export const USDC = Address.fromString(usdcAddress);
export const WETH = Address.fromString(wethAddress);
export function getTokenUsdPriceViaWeth(tokenAddress: string): BigInt {
  const wethToUsdcQuote = getBestPriceQuote(WETH, USDC);
  let tokenToWethQuote = getBestPriceQuote(Address.fromString(tokenAddress), WETH);

  return tokenToWethQuote.priceQuote
    .times(wethToUsdcQuote.priceQuote)
    .div(BigInt.fromI32(10).pow(18));
}

export class PriceQuoteResult {
  public priceQuote: BigInt;
  public inputTokenDecimals: i32;
  constructor(priceQuote: BigInt, inputTokenDecimals: i32) {
    this.priceQuote = priceQuote;
    this.inputTokenDecimals = inputTokenDecimals;
  }
}
export function getBestPriceQuote(
  tokenIn: Address,
  tokenOut: Address,
): PriceQuoteResult {
  if (tokenIn.equals(tokenOut)) {
    const decimals = ERC20.bind(tokenIn).decimals();
    return new PriceQuoteResult(BigInt.fromI32(10).pow(u8(decimals)), decimals);
  }
  
  const quoter = QuoterContract.bind(Address.fromString(quoterAddress));
  const decimals = ERC20.bind(tokenIn).decimals();
  
  // Common Uniswap V3 fee tiers in order of typical liquidity
  const feeTiers: i32[] = [3000, 500, 10000, 100];
  
  let bestQuote = new PriceQuoteResult(BigInt.fromI32(0), decimals);
  
  for (let i = 0; i < feeTiers.length; i++) {
    const fee = feeTiers[i];
    const params = new Quoter__quoteExactInputSingleInputParamsStruct();
    params.push(ethereum.Value.fromAddress(tokenIn));
    params.push(ethereum.Value.fromAddress(tokenOut));
    params.push(
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(10).pow(u8(decimals))),
    );
    params.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(fee)));
    params.push(ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)));
    
    const quote = quoter.try_quoteExactInputSingle(params);
    if (!quote.reverted && quote.value.value0.gt(bestQuote.priceQuote)) {
      bestQuote = new PriceQuoteResult(quote.value.value0, decimals);
    }
  }
  
  return bestQuote;
}
