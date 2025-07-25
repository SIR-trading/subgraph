import { Address, BigInt, BigDecimal, ethereum } from "@graphprotocol/graph-ts";
import { usdcAddress, wethAddress, uniswapV3FactoryAddress } from "./contracts";
import { ERC20 } from "../generated/VaultExternal/ERC20";

// Price cache to avoid redundant calculations within the same block
class PriceCache {
  private blockNumber: BigInt;
  private prices: Map<string, BigDecimal>;

  constructor() {
    this.blockNumber = BigInt.fromI32(0);
    this.prices = new Map<string, BigDecimal>();
  }

  get(tokenAddress: Address, currentBlock: BigInt): BigDecimal | null {
    if (!this.blockNumber.equals(currentBlock)) {
      this.clear();
      this.blockNumber = currentBlock;
      return null;
    }
    
    const key = tokenAddress.toHexString();
    return this.prices.has(key) ? this.prices.get(key) : null;
  }

  set(tokenAddress: Address, price: BigDecimal, currentBlock: BigInt): void {
    if (!this.blockNumber.equals(currentBlock)) {
      this.clear();
      this.blockNumber = currentBlock;
    }
    
    const key = tokenAddress.toHexString();
    this.prices.set(key, price);
  }

  private clear(): void {
    this.prices = new Map<string, BigDecimal>();
  }
}

// Global price cache instance
const priceCache = new PriceCache();

// Uniswap V3 Factory interface
class UniswapV3Factory extends ethereum.SmartContract {
  static bind(address: Address): UniswapV3Factory {
    return new UniswapV3Factory("UniswapV3Factory", address);
  }

  getPool(tokenA: Address, tokenB: Address, fee: i32): Address {
    let result = super.call("getPool", "getPool(address,address,uint24):(address)", [
      ethereum.Value.fromAddress(tokenA),
      ethereum.Value.fromAddress(tokenB),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(fee))
    ]);
    return result[0].toAddress();
  }

  try_getPool(tokenA: Address, tokenB: Address, fee: i32): ethereum.CallResult<Address> {
    let result = super.tryCall("getPool", "getPool(address,address,uint24):(address)", [
      ethereum.Value.fromAddress(tokenA),
      ethereum.Value.fromAddress(tokenB),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(fee))
    ]);
    if (result.reverted) {
      return new ethereum.CallResult();
    }
    return ethereum.CallResult.fromValue(result.value[0].toAddress());
  }
}

// Uniswap V3 Pool interface
class UniswapV3Pool extends ethereum.SmartContract {
  static bind(address: Address): UniswapV3Pool {
    return new UniswapV3Pool("UniswapV3Pool", address);
  }

  slot0(): ethereum.CallResult<UniswapV3Pool__slot0Result> {
    let result = super.call("slot0", "slot0():(uint160,int24,uint16,uint16,uint16,uint8,bool)", []);
    return ethereum.CallResult.fromValue(new UniswapV3Pool__slot0Result(
      result[0].toBigInt(),
      result[1].toI32(),
      result[2].toI32(),
      result[3].toI32(),
      result[4].toI32(),
      result[5].toI32(),
      result[6].toBoolean()
    ));
  }

  try_slot0(): ethereum.CallResult<UniswapV3Pool__slot0Result> {
    let result = super.tryCall("slot0", "slot0():(uint160,int24,uint16,uint16,uint16,uint8,bool)", []);
    if (result.reverted) {
      return new ethereum.CallResult();
    }
    let value = result.value;
    return ethereum.CallResult.fromValue(new UniswapV3Pool__slot0Result(
      value[0].toBigInt(),
      value[1].toI32(),
      value[2].toI32(),
      value[3].toI32(),
      value[4].toI32(),
      value[5].toI32(),
      value[6].toBoolean()
    ));
  }

  liquidity(): BigInt {
    let result = super.call("liquidity", "liquidity():(uint128)", []);
    return result[0].toBigInt();
  }

  try_liquidity(): ethereum.CallResult<BigInt> {
    let result = super.tryCall("liquidity", "liquidity():(uint128)", []);
    if (result.reverted) {
      return new ethereum.CallResult();
    }
    return ethereum.CallResult.fromValue(result.value[0].toBigInt());
  }
}

class UniswapV3Pool__slot0Result {
  value0: BigInt; // sqrtPriceX96
  value1: i32;    // tick
  value2: i32;    // observationIndex
  value3: i32;    // observationCardinality
  value4: i32;    // observationCardinalityNext
  value5: i32;    // feeProtocol
  value6: boolean; // unlocked

  constructor(
    value0: BigInt,
    value1: i32,
    value2: i32,
    value3: i32,
    value4: i32,
    value5: i32,
    value6: boolean
  ) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
    this.value4 = value4;
    this.value5 = value5;
    this.value6 = value6;
  }
}

export const USDC = Address.fromString(usdcAddress);
export const WETH = Address.fromString(wethAddress);
export const UNISWAP_V3_FACTORY = Address.fromString(uniswapV3FactoryAddress);

export function getTokenUsdcPrice(tokenAddress: Address, blockNumber: BigInt | null = null): BigDecimal {
  // Use cached price if available for the current block
  if (blockNumber) {
    const cachedPrice = priceCache.get(tokenAddress, blockNumber);
    if (cachedPrice !== null) {
      return cachedPrice;
    }
  }

  let price: BigDecimal;
  
  if (tokenAddress.equals(USDC)) {
    price = BigDecimal.fromString("1");
  } else if (tokenAddress.equals(WETH)) {
    price = getBestPoolPrice(WETH, USDC);
  } else {
    // Try direct USDC pair first
    const directPrice = getBestPoolPrice(tokenAddress, USDC);
    if (directPrice.gt(BigDecimal.fromString("0"))) {
      price = directPrice;
    } else {
      // Fallback to WETH route
      const wethToUsdcPrice = getBestPoolPrice(WETH, USDC);
      const tokenToWethPrice = getBestPoolPrice(tokenAddress, WETH);
      price = tokenToWethPrice.times(wethToUsdcPrice);
    }
  }
  
  // Cache the price if block number is provided
  if (blockNumber) {
    priceCache.set(tokenAddress, price, blockNumber);
  }
  
  return price;
}

/**
 * Gets the instant price from the most liquid Uniswap V3 pool
 * Returns price as BigDecimal (tokenOut per tokenIn)
 */
export function getBestPoolPrice(
  tokenIn: Address,
  tokenOut: Address,
): BigDecimal {
  const factory = UniswapV3Factory.bind(UNISWAP_V3_FACTORY);
  
  // Common Uniswap V3 fee tiers in order of typical liquidity
  const feeTiers: i32[] = [3000, 500, 10000, 100];
  
  let bestPrice = BigDecimal.fromString("0");
  let highestLiquidity = BigInt.fromI32(0);
  
  for (let i = 0; i < feeTiers.length; i++) {
    const fee = feeTiers[i];
    const poolResult = factory.try_getPool(tokenIn, tokenOut, fee);
    
    if (poolResult.reverted || poolResult.value.equals(Address.zero())) {
      continue; // Pool doesn't exist
    }
    
    const pool = UniswapV3Pool.bind(poolResult.value);
    const liquidityResult = pool.try_liquidity();
    
    if (liquidityResult.reverted || liquidityResult.value.equals(BigInt.fromI32(0))) {
      continue; // No liquidity
    }
    
    // Only use pools with higher liquidity than current best
    if (liquidityResult.value.le(highestLiquidity)) {
      continue;
    }
    
    const slot0Result = pool.try_slot0();
    if (slot0Result.reverted) {
      continue;
    }
    
    const sqrtPriceX96 = slot0Result.value.value0;
    const price = calculatePriceFromSqrtPrice(sqrtPriceX96, tokenIn, tokenOut);
    
    if (price.gt(BigDecimal.fromString("0"))) {
      bestPrice = price;
      highestLiquidity = liquidityResult.value;
    }
  }
  
  return bestPrice;
}

/**
 * Converts sqrtPriceX96 to actual price considering token decimals
 * Price = (sqrtPriceX96 / 2^96)^2 * (10^decimalsIn / 10^decimalsOut)
 */
function calculatePriceFromSqrtPrice(
  sqrtPriceX96: BigInt,
  tokenIn: Address,
  tokenOut: Address,
): BigDecimal {
  if (sqrtPriceX96.equals(BigInt.fromI32(0))) {
    return BigDecimal.fromString("0");
  }
  
  const tokenInContract = ERC20.bind(tokenIn);
  const tokenOutContract = ERC20.bind(tokenOut);
  
  const decimalsIn = tokenInContract.decimals();
  const decimalsOut = tokenOutContract.decimals();
  
  // Convert sqrtPriceX96 to BigDecimal
  const sqrtPrice = sqrtPriceX96.toBigDecimal();
  const q96 = BigDecimal.fromString("79228162514264337593543950336"); // 2^96
  
  // Calculate (sqrtPrice / 2^96)^2
  const normalizedSqrtPrice = sqrtPrice.div(q96);
  let price = normalizedSqrtPrice.times(normalizedSqrtPrice);
  
  // Determine token ordering (Uniswap V3 orders tokens alphabetically)
  const token0IsTokenIn = tokenIn.toHexString().toLowerCase() < tokenOut.toHexString().toLowerCase();
  
  // If tokenIn is token1 (second alphabetically), we need the inverse price
  if (!token0IsTokenIn) {
    price = BigDecimal.fromString("1").div(price);
  }
  
  // Adjust for token decimals: price * (10^decimalsIn / 10^decimalsOut)
  let decimalAdjustment = BigDecimal.fromString("1");
  
  // Apply decimal adjustments
  if (decimalsIn > decimalsOut) {
    const diff = decimalsIn - decimalsOut;
    const powerOf10 = BigInt.fromI32(10).pow(diff as u8);
    decimalAdjustment = decimalAdjustment.times(powerOf10.toBigDecimal());
  } else if (decimalsOut > decimalsIn) {
    const diff = decimalsOut - decimalsIn;
    const powerOf10 = BigInt.fromI32(10).pow(diff as u8);
    decimalAdjustment = decimalAdjustment.div(powerOf10.toBigDecimal());
  }
  
  return price.times(decimalAdjustment);
}

/**
 * Converts a BigDecimal price to a scaled BigInt for storage
 * Scales the price by the specified number of decimals
 */
export function priceToScaledBigInt(price: BigDecimal, decimals: i32): BigInt {
  const powerOf10 = BigInt.fromI32(10).pow(decimals as u8);
  const scaledPrice = price.times(powerOf10.toBigDecimal());
  
  // Convert to BigInt, handling the decimal part
  const priceString = scaledPrice.toString();
  const integerPart = priceString.split('.')[0];
  
  return BigInt.fromString(integerPart);
}

/**
 * Generates a deterministic ID by combining two hex strings
 * More efficient than string concatenation
 */
export function generateCompositeId(part1: string, part2: string): string {
  return part1 + "-" + part2;
}

/**
 * Generates a user position ID for TEA tokens
 */
export function generateUserPositionId(userAddress: Address, vaultId: BigInt): string {
  return generateCompositeId(userAddress.toHexString(), vaultId.toHexString());
}

/**
 * Generates an APE position ID
 */
export function generateApePositionId(userAddress: Address, vaultId: BigInt): string {
  return generateCompositeId(userAddress.toHexString(), vaultId.toHexString());
}

/**
 * Calculates collateral USD price with caching
 */
export function getCollateralUsdPrice(tokenAddress: string, blockNumber: BigInt): BigDecimal {
  const token = Address.fromString(tokenAddress);
  const priceUsd = getTokenUsdcPrice(token, blockNumber);
  return priceUsd; // Return BigDecimal directly
}
