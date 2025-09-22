import { Address, BigInt, Bytes, BigDecimal } from "@graphprotocol/graph-ts";
import {
  Vault,
  TransferBatch,
  TransferSingle,
} from "../../generated/Vault/Vault";
import { RewardsClaimed, DividendsPaid } from "../../generated/Claims/Sir";
import { store } from "@graphprotocol/graph-ts";
import {
  Vault as VaultSchema,
  TeaPosition,
  Dividend,
} from "../../generated/schema";
import { Vault as VaultContract } from "../../generated/Claims/Vault";
import { sirAddress, vaultAddress, wethAddress } from "../contracts";
import { getBestPoolPrice, generateUserPositionId, loadOrCreateToken, bigIntToHex, getCollateralUsdPrice } from "../helpers";

/**
 * Handles ERC1155 single token transfers for TEA positions
 * Updates user balances and vault liquidity tracking
 */
export function handleSingleTransfer(event: TransferSingle): void {
  const transferAmount = event.params.amount;
  const recipientAddress = event.params.to;
  const senderAddress = event.params.from;
  const vaultId = event.params.id;

  handleTeaTransfer(vaultId, recipientAddress, senderAddress, transferAmount);
}

/**
 * Handles dividend payments to SIR token stakers
 * Creates a new Dividend entity with ETH amount, staked SIR amount, and USD price
 */
export function handleDividendsPaid(event: DividendsPaid): void {
  // Create unique entity ID using transaction hash
  const dividendsEntity = new Dividend(event.transaction.hash);
  
  // Get current SIR token price in ETH directly from Uniswap pool
  const sirAddress_addr = Address.fromString(sirAddress);
  const wethAddress_addr = Address.fromString(wethAddress);
  const sirTokenEthPrice = getBestPoolPrice(sirAddress_addr, wethAddress_addr);

  // Set entity properties from event parameters
  dividendsEntity.timestamp = event.block.timestamp;
  dividendsEntity.ethAmount = event.params.amountETH;
  dividendsEntity.stakedAmount = event.params.amountStakedSIR;
  // Only set price if it's not zero (pool exists and has liquidity)
  if (!sirTokenEthPrice.equals(BigDecimal.fromString("0"))) {
    dividendsEntity.sirEthPrice = sirTokenEthPrice;
  }
  dividendsEntity.save();
}

/**
 * Handles reward claims for TEA token holders
 * Removes user position if both TEA balance and unclaimed rewards are zero
 */
export function handleClaim(event: RewardsClaimed): void {
  const vaultId = event.params.vaultId;
  const userAddress = event.params.contributor;
  
  // Get vault contract instance to check balances
  const vaultContract = VaultContract.bind(Address.fromString(vaultAddress));
  const userTeaBalance = vaultContract.balanceOf(userAddress, vaultId);
  const userUnclaimedRewards = vaultContract.unclaimedRewards(vaultId, userAddress);

  // Remove user position if both TEA balance and unclaimed rewards are zero
  const hasNoTeaTokens = userTeaBalance.equals(BigInt.fromI32(0));
  const hasNoUnclaimedRewards = userUnclaimedRewards.equals(BigInt.fromI32(0));
  
  if (hasNoTeaTokens && hasNoUnclaimedRewards) {
    const userPositionId = generateUserPositionId(userAddress, vaultId);
    store.remove("TeaPosition", userPositionId.toHexString());
  }
}

/**
 * Updates vault locked liquidity when TEA tokens move to/from the vault contract
 */
function updateVaultLiquidity(
  vaultId: BigInt,
  recipientAddress: Address,
  senderAddress: Address,
  transferAmount: BigInt,
  vaultAddress: Address,
): void {
  const vaultIdBytes = Bytes.fromHexString(bigIntToHex(vaultId));
  const vault = VaultSchema.load(vaultIdBytes);
  if (!vault) return;

  // Tokens moving TO the vault (locking liquidity)
  if (recipientAddress.equals(vaultAddress)) {
    vault.lockedLiquidity = vault.lockedLiquidity.plus(transferAmount);
    vault.save();
  }

  // Tokens moving FROM the vault (unlocking liquidity)
  if (senderAddress.equals(vaultAddress)) {
    vault.lockedLiquidity = vault.lockedLiquidity.minus(transferAmount);
    vault.save();
  }
}

/**
 * Updates total TEA supply when tokens are minted (from zero) or burned (to zero)
 */
function updateTotalTeaSupply(
  vaultId: BigInt,
  recipientAddress: Address,
  senderAddress: Address,
  transferAmount: BigInt,
): void {
  const vaultIdBytes = Bytes.fromHexString(bigIntToHex(vaultId));
  const vault = VaultSchema.load(vaultIdBytes);
  if (!vault) return;

  const zeroAddr = Address.zero();

  // Tokens minted (from zero address) - increase total supply
  if (senderAddress.equals(zeroAddr)) {
    vault.teaSupply = vault.teaSupply.plus(transferAmount);
    vault.save();
  }

  // Tokens burned (to zero address) - decrease total supply
  if (recipientAddress.equals(zeroAddr)) {
    vault.teaSupply = vault.teaSupply.minus(transferAmount);
    vault.save();
  }
}

/**
 * Updates the sender's TEA position, removing it if balance and rewards are zero
 */
function updateSenderPosition(
  vaultId: BigInt,
  senderAddress: Address,
  transferAmount: BigInt,
  vaultContract: Vault,
): TeaPosition | null {
  const senderPositionId = generateUserPositionId(senderAddress, vaultId);
  const senderPosition = TeaPosition.load(senderPositionId);
  const unclaimedRewardsResult = vaultContract.try_unclaimedRewards(vaultId, senderAddress);

  if (senderPosition && !unclaimedRewardsResult.reverted) {
    // Decrease sender's balance
    senderPosition.balance = senderPosition.balance.minus(transferAmount);

    // Remove position if both balance and unclaimed rewards are zero
    const hasNoBalance = senderPosition.balance.equals(BigInt.fromU64(0));
    const hasNoRewards = unclaimedRewardsResult.value.equals(BigInt.fromI32(0));

    if (hasNoBalance && hasNoRewards) {
      store.remove("TeaPosition", senderPosition.id.toHexString());
    } else {
      senderPosition.save();
    }
    return senderPosition;
  }
  return null;
}

/**
 * Updates or creates the recipient's TEA position
 */
function updateRecipientPosition(
  vaultId: BigInt,
  recipientAddress: Address,
  transferAmount: BigInt,
  vaultContract: Vault,
  collateralToTransfer: BigInt,
  dollarToTransfer: BigDecimal,
  debtTokenToTransfer: BigInt,
): void {
  const recipientPositionId = generateUserPositionId(recipientAddress, vaultId);
  const existingPosition = TeaPosition.load(recipientPositionId);

  if (existingPosition !== null) {
    // Update existing position with transferred amounts
    existingPosition.balance = existingPosition.balance.plus(transferAmount);
    existingPosition.collateralTotal = existingPosition.collateralTotal.plus(collateralToTransfer);
    existingPosition.dollarTotal = existingPosition.dollarTotal.plus(dollarToTransfer);
    existingPosition.debtTokenTotal = existingPosition.debtTokenTotal.plus(debtTokenToTransfer);
    existingPosition.save();
  } else {
    // Check if vault exists in the subgraph before creating a new position
    const vaultIdBytes = Bytes.fromHexString(bigIntToHex(vaultId));
    const vault = VaultSchema.load(vaultIdBytes);
    if (!vault || !vault.exists) {
      // Vault doesn't exist yet, skip creating the position
      return;
    }
    // Create new position with transferred amounts
    createNewTeaPosition(recipientAddress, vaultId, transferAmount, vaultContract);
    const newPosition = TeaPosition.load(recipientPositionId);
    if (newPosition) {
      newPosition.collateralTotal = collateralToTransfer;
      newPosition.dollarTotal = dollarToTransfer;
      newPosition.debtTokenTotal = debtTokenToTransfer;
      newPosition.save();
    }
  }
}

/**
 * Creates a new TEA position for a user with vault parameters
 */
function createNewTeaPosition(
  userAddress: Address,
  vaultId: BigInt,
  initialBalance: BigInt,
  vaultContract: Vault,
): void {
  // Double-check vault exists in subgraph before making contract call
  const vaultIdBytes = Bytes.fromHexString(bigIntToHex(vaultId));
  const vault = VaultSchema.load(vaultIdBytes);
  if (!vault || !vault.exists) {
    return;
  }

  const vaultParamsResult = vaultContract.try_paramsById(vaultId);
  if (vaultParamsResult.reverted) {
    // Contract call failed, skip creating the position
    return;
  }
  const vaultParams = vaultParamsResult.value;
  const debtTokenAddress = vaultParams.debtToken;
  const collateralTokenAddress = vaultParams.collateralToken;
  const leverageTier = vaultParams.leverageTier;

  // Get or create Token entities
  const collateralToken = loadOrCreateToken(collateralTokenAddress);
  const debtToken = loadOrCreateToken(debtTokenAddress);

  // Create new position entity with optimized ID generation
  const positionId = generateUserPositionId(userAddress, vaultId);
  const newPosition = new TeaPosition(positionId);

  // Set position properties
  newPosition.user = userAddress;
  newPosition.balance = initialBalance;
  newPosition.vault = vaultIdBytes;

  // Initialize cost basis fields to zero - will be updated in handleTeaTransfer
  newPosition.collateralTotal = BigInt.fromI32(0);
  newPosition.dollarTotal = BigDecimal.fromString("0");
  newPosition.debtTokenTotal = BigInt.fromI32(0);

  newPosition.save();
}

/**
 * Core logic for handling TEA token transfers between addresses
 * Updates vault liquidity, total TEA supply, and user positions
 */
function handleTeaTransfer(
  vaultId: BigInt,
  recipientAddress: Address,
  senderAddress: Address,
  transferAmount: BigInt,
): void {
  // Check if vault exists in the subgraph before processing
  const vaultIdBytes = Bytes.fromHexString(bigIntToHex(vaultId));
  const vault = VaultSchema.load(vaultIdBytes);
  if (!vault || !vault.exists) {
    // Vault not yet initialized, skip processing this transfer
    return;
  }

  const vaultContract = Vault.bind(Address.fromString(vaultAddress));
  const vaultAddressBytes = Address.fromString(vaultAddress);

  // Update vault locked liquidity when tokens move to/from vault
  updateVaultLiquidity(vaultId, recipientAddress, senderAddress, transferAmount, vaultAddressBytes);

  // Update total TEA supply when tokens are minted/burned (zero address transfers)
  updateTotalTeaSupply(vaultId, recipientAddress, senderAddress, transferAmount);

  // Calculate cost basis to transfer if this is a user-to-user transfer
  let collateralToTransfer = BigInt.fromI32(0);
  let dollarToTransfer = BigDecimal.fromString("0");
  let debtTokenToTransfer = BigInt.fromI32(0);

  const zeroAddr = Address.zero();
  const isNormalTransfer = !senderAddress.equals(zeroAddr) && !recipientAddress.equals(zeroAddr);

  if (isNormalTransfer) {
    // Update sender's position and get proportional amounts to transfer
    const senderPositionId = generateUserPositionId(senderAddress, vaultId);
    const senderPosition = TeaPosition.load(senderPositionId);

    if (senderPosition && senderPosition.balance.gt(BigInt.fromI32(0))) {
      // Calculate proportion being transferred
      const transferProportion = transferAmount.toBigDecimal().div(senderPosition.balance.toBigDecimal());

      // Calculate amounts to transfer
      collateralToTransfer = BigInt.fromString(senderPosition.collateralTotal.toBigDecimal().times(transferProportion).truncate(0).toString());
      dollarToTransfer = senderPosition.dollarTotal.times(transferProportion);
      debtTokenToTransfer = BigInt.fromString(senderPosition.debtTokenTotal.toBigDecimal().times(transferProportion).truncate(0).toString());

      // Update sender's cost basis
      senderPosition.collateralTotal = senderPosition.collateralTotal.minus(collateralToTransfer);
      senderPosition.dollarTotal = senderPosition.dollarTotal.minus(dollarToTransfer);
      senderPosition.debtTokenTotal = senderPosition.debtTokenTotal.minus(debtTokenToTransfer);
    }
  } else if (senderAddress.equals(zeroAddr)) {
    // Minting new TEA tokens - calculate cost basis from current collateral value
    const collateralToken = loadOrCreateToken(Address.fromBytes(vault.collateralToken));
    const debtToken = loadOrCreateToken(Address.fromBytes(vault.debtToken));
    const collateralDecimals = collateralToken.decimals;
    const debtDecimals = debtToken.decimals;

    // TEA amount represents collateral deposited
    collateralToTransfer = transferAmount;

    // Calculate USD value
    const collateralPriceUsd = getCollateralUsdPrice(vault.collateralToken, BigInt.fromI32(0));
    dollarToTransfer = transferAmount
      .toBigDecimal()
      .times(collateralPriceUsd)
      .div(BigInt.fromI32(10).pow(u8(collateralDecimals)).toBigDecimal());

    // Calculate debt token equivalent
    const debtPriceUsd = getCollateralUsdPrice(vault.debtToken, BigInt.fromI32(0));
    debtTokenToTransfer = BigInt.fromString(
      dollarToTransfer
        .times(BigInt.fromI32(10).pow(u8(debtDecimals)).toBigDecimal())
        .div(debtPriceUsd)
        .truncate(0)
        .toString()
    );
  }

  // Update sender's position
  const senderPos = updateSenderPosition(vaultId, senderAddress, transferAmount, vaultContract);

  // Update or create recipient's position with cost basis
  updateRecipientPosition(vaultId, recipientAddress, transferAmount, vaultContract, collateralToTransfer, dollarToTransfer, debtTokenToTransfer);
}

export function handleBatchTransfer(event: TransferBatch): void {
  const vaults = event.params.vaultIds;
  const to = event.params.to;
  const from = event.params.to;
  const amounts = event.params.amounts;
  for (let i = 0; i++; i < vaults.length) {
    const amount = amounts[i];
    handleTeaTransfer(vaults[i], to, from, amount);
  }
}
