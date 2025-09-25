import { VaultInitialized } from "../../generated/VaultExternal/VaultExternal";
import { ApePosition, Vault, ApePositionClosed, Fee, Token, TeaPosition } from "../../generated/schema";
import { Sir } from "../../generated/Tvl/Sir";
import { APE } from "../../generated/templates";
import { Address, BigInt, BigDecimal, DataSourceContext, store, Bytes } from "@graphprotocol/graph-ts";
import { sirAddress } from "../contracts";
import { generateApePositionId, getCollateralUsdPrice, loadOrCreateToken, bigIntToHex, generateUserPositionId } from "../helpers";
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
function generateFeesId(vaultId: Bytes, timestamp: BigInt): Bytes {
  return Bytes.fromHexString(vaultId.toHexString() + bigIntToHex(timestamp).slice(2));
}

/**
 * Creates or updates a Fee entity and adds it to the vault's fees tracking
 * Calculates LP APY based on fees deposited divided by tea collateral for LPers
 * Aggregates APYs when multiple fees have the same timestamp
 */
function createFeesEntity(
  vaultId: Bytes,
  vault: Vault,
  collateralFeeToLPers: BigInt,
  timestamp: BigInt
): void {
  // Generate ID for this fees entry
  const feesId = generateFeesId(vaultId, timestamp);
  
  // Calculate LP APY: fees deposited divided by tea collateral
  let newLpApy = BigDecimal.fromString("0");
  
  // Since ReservesChanged comes before Mint/Burn, reserveLPers already includes the fees
  // We need to subtract the fees to get the base collateral amount for accurate APY calculation
  const baseTeaCollateral = vault.reserveLPers.minus(collateralFeeToLPers);
  
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
      store.remove("Fee", oldestFeesId.toHexString());
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
  const vaultId = Bytes.fromHexString(bigIntToHex(event.params.vault));

  // Use utility function to load or create vault
  let vault = loadOrCreateVault(vaultId);

  if (!cumulativeTax.gt(BigInt.fromI32(0))) {
    vault.tax = BigInt.fromI32(0);
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

  vault.tax = tax;
  vault.rate = rate;
  vault.save();
}

export function handleVaultInitialized(event: VaultInitialized): void {
  const vaultId = Bytes.fromHexString(bigIntToHex(event.params.vaultId));

  // Load or create vault (vault may have been created by tax event)
  let vault = loadOrCreateVault(vaultId);

  // Get or create Token entities
  const collateralToken = loadOrCreateToken(event.params.collateralToken);
  const debtToken = loadOrCreateToken(event.params.debtToken);
  const apeToken = loadOrCreateToken(event.params.ape);

  // Only create APE template if vault hasn't been initialized yet
  if (!vault.exists) {
    // Create data source context for APE template
    const context = new DataSourceContext();
    context.setString("apeAddress", event.params.ape.toHexString());

    // Handle nullable symbols
    const collSymbol = collateralToken.symbol;
    if (collSymbol) {
      context.setString("collateralSymbol", collSymbol);
    } else {
      context.setString("collateralSymbol", "");
    }

    context.setString("collateralToken", event.params.collateralToken.toHexString());

    const debtSymbol = debtToken.symbol;
    if (debtSymbol) {
      context.setString("debtSymbol", debtSymbol);
    } else {
      context.setString("debtSymbol", "");
    }

    context.setString("debtToken", event.params.debtToken.toHexString());
    context.setString("leverageTier", event.params.leverageTier.toString());
    context.setString("vaultId", event.params.vaultId.toString());

    APE.createWithContext(event.params.ape, context);
  }

  // Always update vault with all required fields (whether new or existing from tax event)
  vault.collateralToken = collateralToken.id;
  vault.debtToken = debtToken.id;
  vault.ape = apeToken.id;
  vault.leverageTier = event.params.leverageTier;
  vault.exists = true;
  vault.save();
}

export function handleReservesChanged(event: ReservesChanged): void {
  const vaultId = Bytes.fromHexString(bigIntToHex(event.params.vaultId));

  let vault = Vault.load(vaultId);
  if (!vault) {
    return; // Exit if vault does not exist
  }

  const params = event.params;
  const total = params.reserveApes.plus(params.reserveLPers);

  // Update vault reserves and total value
  vault.reserveApes = params.reserveApes;
  vault.reserveLPers = params.reserveLPers;
  vault.totalValue = total;

  // Calculate USD values with caching
  const currentUsdValue = calculateVaultUsdcValue(vault, event.block.number);
  vault.totalValueUsd = currentUsdValue;
  
  vault.save();
}

export function handleMint(event: Mint): void {
  const vaultId = Bytes.fromHexString(bigIntToHex(event.params.vaultId));
  const vault = Vault.load(vaultId);
  if (!vault) {
    return;
  }

  const isAPE = event.params.isAPE;

  if (isAPE) {
    // Check if TEA supply is 0 - if so, skip fees creation as per requirement
    if (vault.teaSupply.gt(BigInt.fromI32(0))) {
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
    }



    // Process the APE position
    processApeMint(event, vault);
  } else {
    // Process the TEA position
    processTeaMint(event, vault);
  }
}

/**
 * Processes APE position creation/update for mint events
 */
function processApeMint(event: Mint, vault: Vault): void {
  const userAddress = event.params.minter;
  const vaultIdBigInt = event.params.vaultId;
  const positionId = generateApePositionId(userAddress, vaultIdBigInt);

  // Calculate position updates
  const updates = calculatePositionUpdates(event, vault);

  // Load or create position
  let position = ApePosition.load(positionId);
  if (!position) {
    position = new ApePosition(positionId);
    position.vault = vault.id;
    position.user = userAddress;
    position.collateralTotal = BigInt.fromI32(0);
    position.dollarTotal = BigDecimal.fromString("0");
    position.debtTokenTotal = BigInt.fromI32(0);
    position.balance = BigInt.fromI32(0);
  }

  // Update position with calculated values
  position.collateralTotal = position.collateralTotal.plus(updates.collateralDeposited);
  position.dollarTotal = position.dollarTotal.plus(updates.dollarCollateralDeposited);
  position.debtTokenTotal = position.debtTokenTotal.plus(updates.debtTokenAmount);
  position.balance = position.balance.plus(updates.tokensMinted);
  position.save();
}

/**
 * Processes TEA position creation/update for mint events
 */
function processTeaMint(event: Mint, vault: Vault): void {
  const userAddress = event.params.minter;
  const vaultIdBigInt = event.params.vaultId;
  const positionId = generateUserPositionId(userAddress, vaultIdBigInt);

  // Calculate position updates
  const updates = calculatePositionUpdates(event, vault);

  // Load or create position
  let position = TeaPosition.load(positionId);
  if (!position) {
    position = new TeaPosition(positionId);
    position.vault = vault.id;
    position.user = userAddress;
    position.collateralTotal = BigInt.fromI32(0);
    position.dollarTotal = BigDecimal.fromString("0");
    position.debtTokenTotal = BigInt.fromI32(0);
    position.balance = BigInt.fromI32(0);
  }

  // Update position with calculated values
  position.collateralTotal = position.collateralTotal.plus(updates.collateralDeposited);
  position.dollarTotal = position.dollarTotal.plus(updates.dollarCollateralDeposited);
  position.debtTokenTotal = position.debtTokenTotal.plus(updates.debtTokenAmount);
  position.balance = position.balance.plus(updates.tokensMinted);
  position.save();
}

/**
 * Class to hold position update values
 */
class PositionUpdates {
  collateralDeposited: BigInt;
  dollarCollateralDeposited: BigDecimal;
  debtTokenAmount: BigInt;
  tokensMinted: BigInt;

  constructor() {
    this.collateralDeposited = BigInt.fromI32(0);
    this.dollarCollateralDeposited = BigDecimal.fromString("0");
    this.debtTokenAmount = BigInt.fromI32(0);
    this.tokensMinted = BigInt.fromI32(0);
  }
}

/**
 * Helper function to calculate position updates from mint event
 */
function calculatePositionUpdates(event: Mint, vault: Vault): PositionUpdates {
  // Include all collateral (base + fees)
  const collateralDeposited = event.params.collateralIn.plus(
    event.params.collateralFeeToLPers.plus(event.params.collateralFeeToStakers)
  );

  // Get collateral token decimals from the Token entity
  const collateralToken = Token.load(vault.collateralToken);
  const collateralDecimals = collateralToken ? collateralToken.decimals : 18;

  const collateralPriceUsd = getCollateralUsdPrice(vault.collateralToken, event.block.number);
  const dollarCollateralDeposited = collateralDeposited
    .toBigDecimal()
    .times(collateralPriceUsd)
    .div(BigInt.fromI32(10).pow(u8(collateralDecimals)).toBigDecimal());

  // Calculate debt token equivalent
  const debtToken = Token.load(vault.debtToken);
  const debtDecimals = debtToken ? debtToken.decimals : 18;
  const debtPriceUsd = getCollateralUsdPrice(vault.debtToken, event.block.number);

  const debtTokenAmountDecimal = dollarCollateralDeposited
    .times(BigInt.fromI32(10).pow(u8(debtDecimals)).toBigDecimal())
    .div(debtPriceUsd);
  const debtTokenAmount = BigInt.fromString(debtTokenAmountDecimal.truncate(0).toString());

  const tokensMinted = event.params.tokenOut;

  const result = new PositionUpdates();
  result.collateralDeposited = collateralDeposited;
  result.dollarCollateralDeposited = dollarCollateralDeposited;
  result.debtTokenAmount = debtTokenAmount;
  result.tokensMinted = tokensMinted;
  return result;
}

export function handleBurn(event: Burn): void {
  const vaultId = Bytes.fromHexString(bigIntToHex(event.params.vaultId));
  const vault = Vault.load(vaultId);
  if (!vault) {
    return;
  }

  const isAPE = event.params.isAPE;

  if (isAPE) {
    // Handle APE burn
    // Create fees entity when APE is burned (teaSupply is always > 0 for burns)
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
    processApeBurn(event, vault);
  } else {
    // Handle TEA burn
    processTeaBurn(event, vault);
  }
}

/**
 * Processes APE position updates for burn events
 */
function processApeBurn(event: Burn, vault: Vault): void {
  const userAddress = event.params.burner;
  const vaultIdBigInt = event.params.vaultId;
  const apePositionId = generateApePositionId(userAddress, vaultIdBigInt);
  const apePosition = ApePosition.load(apePositionId);
  if (!apePosition) {
    return;
  }

  const closedApePosition = new ApePositionClosed(event.transaction.hash);
  closedApePosition.vault = vault.id;
  closedApePosition.user = userAddress;

  // Get collateral token decimals from the Token entity
  const collateralToken = Token.load(vault.collateralToken);
  const collateralDecimals = collateralToken ? collateralToken.decimals : 18;

  const collateralPriceUsd = getCollateralUsdPrice(vault.collateralToken, event.block.number);
  const tokensBurned = event.params.tokenIn;

  // Calculate closed APE position values based on proportion burned
  closedApePosition.collateralDeposited = apePosition.collateralTotal
    .times(tokensBurned)
    .div(apePosition.balance);

  // Calculate dollar deposited as BigDecimal
  const dollarDeposited = apePosition.dollarTotal
    .times(tokensBurned.toBigDecimal())
    .div(apePosition.balance.toBigDecimal());

  // Store in ApePositionClosed
  closedApePosition.dollarDeposited = dollarDeposited;

  closedApePosition.collateralWithdrawn = event.params.collateralWithdrawn;

  const dollarWithdrawn = closedApePosition.collateralWithdrawn
    .toBigDecimal()
    .times(collateralPriceUsd)
    .div(BigInt.fromI32(10).pow(u8(collateralDecimals)).toBigDecimal()); // Convert to true USD value
  closedApePosition.dollarWithdrawn = dollarWithdrawn;
  closedApePosition.timestamp = event.block.timestamp;

  // Calculate proportional debt token amount to reduce
  const debtTokenBurned = apePosition.debtTokenTotal
    .times(tokensBurned)
    .div(apePosition.balance);

  // Update current APE position
  apePosition.collateralTotal = apePosition.collateralTotal.minus(closedApePosition.collateralDeposited);
  apePosition.dollarTotal = apePosition.dollarTotal.minus(dollarDeposited);
  apePosition.debtTokenTotal = apePosition.debtTokenTotal.minus(debtTokenBurned);
  apePosition.balance = apePosition.balance.minus(tokensBurned);

  // Remove position if balance becomes zero, otherwise save it
  if (apePosition.balance.equals(BigInt.fromI32(0))) {
    store.remove("ApePosition", apePosition.id.toHexString());
  } else {
    apePosition.save();
  }
  
  closedApePosition.save();
}

/**
 * Processes TEA position updates for burn events
 */
function processTeaBurn(event: Burn, vault: Vault): void {
  const userAddress = event.params.burner;
  const vaultIdBigInt = event.params.vaultId;
  const teaPositionId = generateUserPositionId(userAddress, vaultIdBigInt);
  const teaPosition = TeaPosition.load(teaPositionId);
  if (!teaPosition) {
    return;
  }

  const tokensBurned = event.params.tokenIn;

  // Calculate proportion being burned
  const burnProportion = tokensBurned.toBigDecimal().div(teaPosition.balance.toBigDecimal());

  // Calculate amounts to reduce based on proportion
  const collateralToReduce = BigInt.fromString(
    teaPosition.collateralTotal.toBigDecimal().times(burnProportion).truncate(0).toString()
  );
  const dollarToReduce = teaPosition.dollarTotal.times(burnProportion);
  const debtTokenToReduce = BigInt.fromString(
    teaPosition.debtTokenTotal.toBigDecimal().times(burnProportion).truncate(0).toString()
  );

  // Update TEA position
  teaPosition.collateralTotal = teaPosition.collateralTotal.minus(collateralToReduce);
  teaPosition.dollarTotal = teaPosition.dollarTotal.minus(dollarToReduce);
  teaPosition.debtTokenTotal = teaPosition.debtTokenTotal.minus(debtTokenToReduce);
  teaPosition.balance = teaPosition.balance.minus(tokensBurned);

  // Remove position if balance becomes zero, otherwise save it
  if (teaPosition.balance.equals(BigInt.fromI32(0))) {
    store.remove("TeaPosition", teaPosition.id.toHexString());
  } else {
    teaPosition.save();
  }
}

// TEA transfer handlers (consolidated from tea.ts)
export { handleSingleTransfer, handleBatchTransfer } from "./tea";
