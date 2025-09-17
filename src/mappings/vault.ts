import { VaultInitialized } from "../../generated/VaultExternal/VaultExternal";
import { ApePosition, Vault, ClosedApePosition, Fee } from "../../generated/schema";
import { ERC20 } from "../../generated/VaultExternal/ERC20";
import { Sir } from "../../generated/Tvl/Sir";
import { APE } from "../../generated/templates";
import { Address, BigInt, BigDecimal, DataSourceContext, store } from "@graphprotocol/graph-ts";
import { sirAddress } from "../contracts";
import { generateApePositionId, getCollateralUsdPrice } from "../helpers";
import { 
  loadOrCreateVault, 
  calculateVaultUsdcValue 
} from "../vault-utils";
import {
  Burn,
  Mint,
  ReservesChanged,
  VaultNewTax,
} from "../../generated/Vault/Vault";

/**
 * Generates a unique Fee entity ID based on vault ID and timestamp
 * Format: vaultId-timestamp to enable time-based filtering
 */
function generateFeesId(vaultId: string, timestamp: BigInt): string {
  return vaultId + "-" + timestamp.toString();
}

/**
 * Creates or updates a Fee entity and adds it to the vault's fees tracking
 * Calculates LP APY based on fees deposited divided by tea collateral for LPers
 * Aggregates APYs when multiple fees have the same timestamp
 */
function createFeesEntity(
  vaultId: string, 
  vault: Vault, 
  collateralFeeToLPers: BigInt, 
  timestamp: BigInt
): void {
  // Generate ID for this fees entry
  const feesId = generateFeesId(vaultId, timestamp);
  
  // Calculate LP APY: fees deposited divided by tea collateral
  let newLpApy = BigDecimal.fromString("0");
  
  // Since ReservesChanged comes before Mint/Burn, teaCollateral already includes the fees
  // We need to subtract the fees to get the base collateral amount for accurate APY calculation
  const baseTeaCollateral = vault.teaCollateral.minus(collateralFeeToLPers);
  
  if (baseTeaCollateral.gt(BigInt.fromI32(0))) {
    // Convert fees to BigDecimal for precision
    const feesDecimal = collateralFeeToLPers.toBigDecimal();
    const baseTeaCollateralDecimal = baseTeaCollateral.toBigDecimal();
    
    // Calculate APY as fees / base tea collateral (before fees were added)
    newLpApy = feesDecimal.div(baseTeaCollateralDecimal);
  }
  
  // Check if fees entity already exists for this timestamp
  let fees = Fee.load(feesId);
  if (fees) {
    // Aggregate APYs when multiple fees have the same timestamp
    fees.lpApy = fees.lpApy.plus(newLpApy);
    fees.save();
  } else {
    // Create new Fee entity
    fees = new Fee(feesId);
    fees.vaultId = vaultId;
    fees.timestamp = timestamp;
    fees.lpApy = newLpApy;
    fees.save();
    
    // Add the fees ID to the vault's tracking array (keep time-ordered)
    const currentFeesIds = vault.feesIds;
    currentFeesIds.push(feesId);
    vault.feesIds = currentFeesIds;
  }
  
  // Clean up fees older than 1 month (2592000 seconds = 30 days)
  cleanupOldFees(vault, timestamp);
  
  vault.save();
}

/**
 * Removes fees entities older than 1 month and updates vault's fees tracking
 * Optimized using shift() to remove old entries from the front of the array
 */
function cleanupOldFees(vault: Vault, currentTimestamp: BigInt): void {
  const oneMonthInSeconds = BigInt.fromI32(2592000); // 30 days * 24 hours * 60 minutes * 60 seconds
  const cutoffTimestamp = currentTimestamp.minus(oneMonthInSeconds);
  
  const currentFeesIds = vault.feesIds;
  
  // Since fees are ordered by time, remove old ones from the front using shift()
  while (currentFeesIds.length > 0) {
    const oldestFeesId = currentFeesIds[0];
    const fees = Fee.load(oldestFeesId);
    
    if (fees && fees.timestamp.lt(cutoffTimestamp)) {
      // Remove old fees entry from storage and array
      store.remove("Fee", oldestFeesId);
      currentFeesIds.shift(); // Remove from front of array
    } else {
      // Found a recent fee (within 1 month), all subsequent ones are also recent
      break;
    }
  }
  
  vault.feesIds = currentFeesIds;
}

export function handleVaultTax(event: VaultNewTax): void {
  const tax = BigInt.fromU32(event.params.tax);
  const cumulativeTax = BigInt.fromU32(event.params.cumulativeTax);
  const vaultIdHex = event.params.vault.toHexString();
  const vaultIdDecimal = event.params.vault.toString();

  // Use utility function to load or create vault (using hex as entity ID)
  let vault = loadOrCreateVault(vaultIdHex);

  // Set vaultId as decimal string to match the format used in handleVaultInitialized
  vault.vaultId = vaultIdDecimal;

  if (!cumulativeTax.gt(BigInt.fromI32(0))) {
    vault.taxAmount = BigInt.fromI32(0);
    vault.rate = BigInt.fromI32(0);
    vault.save();
    return;
  }

  // Calculate tax rate
  const contract = Sir.bind(Address.fromString(sirAddress));
  const issuanceRate = contract.LP_ISSUANCE_FIRST_3_YEARS();
  const rate = tax
    .times(issuanceRate)
    .div(cumulativeTax)

  vault.taxAmount = tax;
  vault.rate = rate;
  vault.save();
}

export function handleVaultInitialized(event: VaultInitialized): void {
  const vaultIdString = event.params.vaultId.toHexString();

  // Load or create vault (vault may have been created by tax event)
  let vault = loadOrCreateVault(vaultIdString);

  // Get token information
  const collateralTokenContract = ERC20.bind(event.params.collateralToken);
  const debtTokenContract = ERC20.bind(event.params.debtToken);
  const debtSymbol = debtTokenContract.symbol();
  const collateralSymbol = collateralTokenContract.symbol();
  const collateralDecimals = collateralTokenContract.decimals();

  // Only create APE template if vault hasn't been initialized yet
  if (!vault.exists) {
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
  }

  // Always update vault with all required fields (whether new or existing from tax event)
  vault.collateralToken = event.params.collateralToken.toHexString();
  vault.debtToken = event.params.debtToken.toHex();
  vault.leverageTier = event.params.leverageTier;
  vault.apeDecimals = collateralDecimals;
  vault.collateralSymbol = collateralSymbol;
  vault.debtSymbol = debtSymbol;
  vault.vaultId = event.params.vaultId.toString();
  vault.apeAddress = event.params.ape;
  vault.exists = true;
  vault.save();
}

export function handleReservesChanged(event: ReservesChanged): void {
  const vaultIdString = event.params.vaultId.toHexString();
    
  let vault = Vault.load(vaultIdString);
  if (!vault) {
    return; // Exit if vault does not exist
  }

  const params = event.params;
  const total = params.reserveApes.plus(params.reserveLPers);

  // Update vault reserves and total value
  vault.apeCollateral = params.reserveApes;
  vault.teaCollateral = params.reserveLPers;
  vault.totalValue = total;

  // Calculate USD values with caching
  const currentUsdValue = calculateVaultUsdcValue(vault, event.block.number);
  vault.totalValueUsd = currentUsdValue;
  
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

  // Check if TEA supply is 0 - if so, skip fees creation as per requirement
  if (vault.totalTea.equals(BigInt.fromI32(0))) {
    // Still process the APE position but don't create fees
    processApePosition(event, vault);
    return;
  }

  // Create fees entity when APE is minted and TEA supply > 0
  const collateralFeeToLPers = event.params.collateralFeeToLPers;
  if (collateralFeeToLPers.gt(BigInt.fromI32(0))) {
    createFeesEntity(
      vault.id,
      vault,
      collateralFeeToLPers,
      event.block.timestamp
    );
  }

  // Process the APE position
  processApePosition(event, vault);
}

/**
 * Processes APE position creation/update for mint events
 */
function processApePosition(event: Mint, vault: Vault): void {
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

  // Create fees entity when APE is burned (totalTea is always > 0 for burns)
  const collateralFeeToLPers = event.params.collateralFeeToLPers;
  if (collateralFeeToLPers.gt(BigInt.fromI32(0))) {
    createFeesEntity(
      vault.id,
      vault,
      collateralFeeToLPers,
      event.block.timestamp
    );
  }

  // Process the APE position burn
  processBurnPosition(event, vault);
}

/**
 * Processes APE position updates for burn events
 */
function processBurnPosition(event: Burn, vault: Vault): void {
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
