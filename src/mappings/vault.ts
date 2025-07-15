import { VaultInitialized } from "../../generated/VaultExternal/VaultExternal";
import { ApePosition, Vault, ClosedApePosition } from "../../generated/schema";
import { ERC20 } from "../../generated/VaultExternal/ERC20";
import { Sir } from "../../generated/Tvl/Sir";
import { APE } from "../../generated/templates";
import { Address, BigInt, BigDecimal, DataSourceContext, store } from "@graphprotocol/graph-ts";
import { sirAddress } from "../contracts";
import { generateApePositionId, getCollateralUsdPrice } from "../helpers";
import { 
  loadOrCreateVault, 
  calculateVaultUsdValue, 
  updateVaultSortKey 
} from "../vault-utils";
import {
  Burn,
  Mint,
  ReservesChanged,
  VaultNewTax,
} from "../../generated/Claims/Vault";

export function handleVaultTax(event: VaultNewTax): void {
  const multiplier = 100000;
  const tax = BigInt.fromU32(event.params.tax);
  const cumulativeTax = BigInt.fromU32(event.params.cumulativeTax);
  
  // Use utility function to load or create vault
  let vault = loadOrCreateVault(event.params.vault.toHexString());
  
  if (!cumulativeTax.gt(BigInt.fromI32(0))) {
    vault.taxAmount = BigInt.fromI32(0);
    vault.save();
    return;
  }
  
  // Calculate tax rate
  const contract = Sir.bind(Address.fromString(sirAddress));
  const issuanceRate = contract.LP_ISSUANCE_FIRST_3_YEARS();
  const rate = tax
    .times(issuanceRate)
    .div(cumulativeTax)

  vault.taxAmount = rate;
  vault.rate = rate;
  vault.save();
}
export function handleVaultInitialized(event: VaultInitialized): void {
  const vaultIdString = event.params.vaultId.toHexString();
  
  // Check if vault already exists to avoid duplicates
  let vault = Vault.load(vaultIdString);
  if (vault) {
    return;
  }

  // Get token information
  const collateralTokenContract = ERC20.bind(event.params.collateralToken);
  const debtTokenContract = ERC20.bind(event.params.debtToken);
  const debtSymbol = debtTokenContract.symbol();
  const collateralSymbol = collateralTokenContract.symbol();
  const collateralDecimals = collateralTokenContract.decimals();

  // Create data source context for APE template
  const context = new DataSourceContext();
  context.setString("apeAddress", event.params.ape.toHexString());
  context.setString("collateralSymbol", collateralSymbol);
  context.setString("collateralToken", event.params.collateralToken.toHexString());
  context.setString("debtSymbol", debtSymbol);
  context.setString("debtToken", event.params.debtToken.toHexString());
  context.setString("leverageTier", event.params.leverageTier.toString());
  context.setString("vaultId", event.params.vaultId.toString());

  APE.createWithContext(event.params.ape, context);

  // Create new vault with all required fields
  vault = loadOrCreateVault(vaultIdString);
  vault.collateralToken = event.params.collateralToken.toHexString();
  vault.debtToken = event.params.debtToken.toHex();
  vault.leverageTier = event.params.leverageTier;
  vault.apeDecimals = collateralDecimals;
  vault.collateralSymbol = collateralSymbol;
  vault.debtSymbol = debtSymbol;
  vault.vaultId = event.params.vaultId.toString();
  vault.apeAddress = event.params.ape;
  vault.save();
}

export function handleReservesChanged(event: ReservesChanged): void {
  const vault = Vault.load(event.params.vaultId.toHexString());
  if (!vault) {
    return;
  }

  const params = event.params;
  const total = params.reserveApes.plus(params.reserveLPers);

  // Update vault reserves and total value
  vault.apeCollateral = params.reserveApes;
  vault.teaCollateral = params.reserveLPers;
  vault.totalValue = total;

  // Calculate USD values with caching
  const currentUsdValue = calculateVaultUsdValue(vault, event.block.number);
  vault.totalValueUsd = currentUsdValue;
  vault.totalVolumeUsd = vault.totalVolumeUsd.plus(currentUsdValue);
  
  // Update sort key using utility function
  updateVaultSortKey(vault);
  vault.save();
}

export function handleMint(event: Mint): void {
  if (event.params.isAPE === false) {
    return; // Only handle APE mints
  }

  const vault = Vault.load(event.params.vaultId.toHexString());
  if (!vault) {
    return;
  }

  const userAddress = event.params.minter;
  const vaultIdBigInt = event.params.vaultId;
  const apePositionId = generateApePositionId(userAddress, vaultIdBigInt);

  let apePosition = ApePosition.load(apePositionId);
  if (!apePosition) {
    apePosition = new ApePosition(apePositionId);
    apePosition.vaultId = vaultIdBigInt.toHexString();
    apePosition.user = userAddress;
    apePosition.collateralTotal = BigInt.fromI32(0);
    apePosition.dollarTotal = BigInt.fromI32(0);
    apePosition.balance = BigInt.fromI32(0);
    
    // Set additional fields for the merged entity
    const collateralTokenAddress = Address.fromString(vault.collateralToken);
    const collateralTokenContract = ERC20.bind(collateralTokenAddress);
    const debtTokenAddress = Address.fromString(vault.debtToken);
    const debtTokenContract = ERC20.bind(debtTokenAddress);
    
    apePosition.decimals = collateralTokenContract.decimals();
    apePosition.ape = vault.apeAddress.toHexString();
    apePosition.collateralToken = vault.collateralToken;
    apePosition.debtToken = vault.debtToken;
    apePosition.collateralSymbol = collateralTokenContract.symbol();
    apePosition.debtSymbol = debtTokenContract.symbol();
    apePosition.leverageTier = vault.leverageTier.toString();
  }

  const collateralDeposited = event.params.collateralIn.plus(
    event.params.collateralFeeToLPers.plus(event.params.collateralFeeToStakers)
  );

  const collateralPriceUsd = getCollateralUsdPrice(vault.collateralToken, event.block.number);
  const dollarCollateralDeposited = collateralDeposited
    .toBigDecimal()
    .times(collateralPriceUsd)
    .times(BigDecimal.fromString("1000000")) // Scale to 6 decimals for USD
    .div(BigInt.fromI32(10).pow(u8(vault.apeDecimals)).toBigDecimal()); // Divide by collateral decimals
  const dollarCollateralDepositedBigInt = BigInt.fromString(dollarCollateralDeposited.truncate(0).toString());

  const tokensMinted = event.params.tokenOut;

  // Update APE position
  apePosition.collateralTotal = apePosition.collateralTotal.plus(collateralDeposited);
  apePosition.dollarTotal = apePosition.dollarTotal.plus(dollarCollateralDepositedBigInt);
  apePosition.balance = apePosition.balance.plus(tokensMinted);
  apePosition.save();
}

export function handleBurn(event: Burn): void {
  if (event.params.isAPE === false) {
    return; // Only handle APE burns
  }

  const vault = Vault.load(event.params.vaultId.toHexString());
  if (!vault) {
    return;
  }

  const userAddress = event.params.burner;
  const vaultIdBigInt = event.params.vaultId;
  const apePositionId = generateApePositionId(userAddress, vaultIdBigInt);
  const apePosition = ApePosition.load(apePositionId);
  if (!apePosition) {
    return;
  }

  const closedApePosition = new ClosedApePosition(event.transaction.hash.toHexString());
  closedApePosition.vaultId = vaultIdBigInt.toHexString();
  closedApePosition.user = userAddress;

  const collateralPriceUsd = getCollateralUsdPrice(vault.collateralToken, event.block.number);
  const tokensBurned = event.params.tokenIn;

  // Calculate closed APE position values based on proportion burned
  closedApePosition.collateralDeposited = apePosition.collateralTotal
    .times(tokensBurned)
    .div(apePosition.balance);
  closedApePosition.dollarDeposited = apePosition.dollarTotal
    .times(tokensBurned)
    .div(apePosition.balance);
  closedApePosition.collateralWithdrawn = event.params.collateralWithdrawn;
  
  const dollarWithdrawn = closedApePosition.collateralWithdrawn
    .toBigDecimal()
    .times(collateralPriceUsd)
    .times(BigDecimal.fromString("1000000")) // Scale to 6 decimals for USD
    .div(BigInt.fromI32(10).pow(u8(vault.apeDecimals)).toBigDecimal()); // Divide by collateral decimals
  closedApePosition.dollarWithdrawn = BigInt.fromString(dollarWithdrawn.truncate(0).toString());
  closedApePosition.timestamp = event.block.timestamp;
  closedApePosition.decimal = ERC20.bind(Address.fromString(vault.collateralToken)).decimals();

  // Update current APE position
  apePosition.collateralTotal = apePosition.collateralTotal.minus(closedApePosition.collateralDeposited);
  apePosition.dollarTotal = apePosition.dollarTotal.minus(closedApePosition.dollarDeposited);
  apePosition.balance = apePosition.balance.minus(tokensBurned);

  // Remove position if balance becomes zero, otherwise save it
  if (apePosition.balance.equals(BigInt.fromI32(0))) {
    store.remove("ApePosition", apePosition.id);
  } else {
    apePosition.save();
  }
  
  closedApePosition.save();
}

// TEA transfer handlers (consolidated from tea.ts)
export { handleSingleTransfer, handleBatchTransfer } from "./tea";
