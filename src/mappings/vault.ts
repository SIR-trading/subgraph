import { VaultInitialized } from "../../generated/VaultExternal/VaultExternal";
import { ApePosition, Vault, ClosedApePosition } from "../../generated/schema";
import { ERC20 } from "../../generated/VaultExternal/ERC20";
import { Sir } from "../../generated/Tvl/Sir";
import { APE } from "../../generated/templates";
import { Address, BigInt, DataSourceContext } from "@graphprotocol/graph-ts";
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
  const tax = BigInt.fromU64(event.params.tax).times(BigInt.fromU32(multiplier));
  const cumulativeTax = BigInt.fromU64(event.params.cumulativeTax);
  
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
    .div(cumulativeTax)
    .times(issuanceRate)
    .div(BigInt.fromU32(multiplier));

  vault.taxAmount = rate;
  vault.save();
}
export function handleVaultInitialized(event: VaultInitialized): void {
  const vaultId = event.params.vaultId.toHexString();
  
  // Check if vault already exists to avoid duplicates
  let vault = Vault.load(vaultId);
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
  vault = loadOrCreateVault(vaultId);
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

  const user = event.params.minter.toHexString();
  const apePositionId = generateApePositionId(event.params.minter, event.params.vaultId);

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

  const collateralPriceUsd = getCollateralUsdPrice(vault.collateralToken, event.block.number);
  const dollarCollateralDeposited = collateralDeposited
    .times(collateralPriceUsd)
    .div(BigInt.fromI32(10).pow(u8(6))); // Remove USDC decimals

  // Update APE position
  apePosition.collateralTotal = apePosition.collateralTotal.plus(collateralDeposited);
  apePosition.dollarTotal = apePosition.dollarTotal.plus(dollarCollateralDeposited);
  apePosition.apeBalance = apePosition.apeBalance.plus(event.params.tokenOut);
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

  const user = event.params.burner.toHexString();
  const apePositionId = generateApePositionId(event.params.burner, event.params.vaultId);
  const apePosition = ApePosition.load(apePositionId);
  if (!apePosition) {
    return;
  }

  const closedApePosition = new ClosedApePosition(event.transaction.hash.toHexString());
  closedApePosition.vaultId = event.params.vaultId.toHexString();
  closedApePosition.user = event.params.burner;

  const collateralPriceUsd = getCollateralUsdPrice(vault.collateralToken, event.block.number);

  // Calculate closed APE position values
  closedApePosition.collateralDeposited = apePosition.collateralTotal
    .times(event.params.tokenIn)
    .div(apePosition.apeBalance);
  closedApePosition.dollarDeposited = apePosition.dollarTotal
    .times(event.params.tokenIn)
    .div(apePosition.apeBalance);
  closedApePosition.collateralWithdrawn = event.params.collateralWithdrawn;
  closedApePosition.dollarWithdrawn = closedApePosition.collateralWithdrawn
    .times(collateralPriceUsd)
    .div(BigInt.fromI32(10).pow(u8(6))); // Remove USDC decimals
  closedApePosition.timestamp = event.block.timestamp;
  closedApePosition.decimal = ERC20.bind(Address.fromString(vault.collateralToken)).decimals();

  // Update current APE position
  apePosition.collateralTotal = apePosition.collateralTotal.minus(closedApePosition.collateralDeposited);
  apePosition.dollarTotal = apePosition.dollarTotal.minus(closedApePosition.dollarDeposited);
  apePosition.apeBalance = apePosition.apeBalance.minus(event.params.tokenIn);

  apePosition.save();
  closedApePosition.save();
}

// TEA transfer handlers (consolidated from tea.ts)
export { handleSingleTransfer, handleBatchTransfer } from "./tea";
