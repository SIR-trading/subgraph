import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { ERC20 } from "../generated/VaultExternal/ERC20";
import { Token } from "../generated/schema";

/**
 * Converts a BigInt to a padded hex string suitable for Bytes.fromHexString
 * Ensures the hex string has even length by padding with a leading zero if needed
 */
export function bigIntToHex(value: BigInt): string {
  let hex = value.toHexString();
  // Remove 0x prefix
  if (hex.startsWith("0x")) {
    hex = hex.slice(2);
  }
  // Pad with leading zero if odd length
  if (hex.length % 2 !== 0) {
    hex = "0" + hex;
  }
  return "0x" + hex;
}

/**
 * Loads or creates a Token entity
 */
export function loadOrCreateToken(tokenAddress: Address): Token {
  const tokenId = Bytes.fromHexString(tokenAddress.toHexString());
  let token = Token.load(tokenId);

  if (!token) {
    token = new Token(tokenId);

    // Fetch token details from ERC20 contract
    const tokenContract = ERC20.bind(tokenAddress);

    // Try to get symbol, handle failure gracefully
    const symbolResult = tokenContract.try_symbol();
    if (!symbolResult.reverted) {
      token.symbol = symbolResult.value;
    } else {
      token.symbol = null; // Symbol is optional
    }

    // Try to get decimals, default to 18 if fails
    const decimalsResult = tokenContract.try_decimals();
    if (!decimalsResult.reverted) {
      token.decimals = decimalsResult.value;
    } else {
      token.decimals = 18; // Default to 18 decimals
    }

    token.save();
  }

  return token;
}
