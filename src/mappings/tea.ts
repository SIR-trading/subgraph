import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  Vault,
  TransferBatch,
  TransferSingle,
} from "../../generated/Vault/Vault";
import { RewardsClaimed, DividendsPaid } from "../../generated/Claims/Sir";
import { store } from "@graphprotocol/graph-ts";
import {
  Vault as VaultSchema,
  UserPositionTea,
  Dividend,
} from "../../generated/schema";
import { ERC20 } from "../../generated/VaultExternal/ERC20";
import { Vault as VaultContract } from "../../generated/Claims/Vault";
import { sirAddress, vaultAddress, wethAddress } from "../contracts";
import { getBestPoolPrice, generateUserPositionId } from "../helpers";

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
  const dividendsEntity = new Dividend(event.transaction.hash.toHex());
  
  // Get current SIR token price in ETH directly from Uniswap pool
  const sirAddress_addr = Address.fromString(sirAddress);
  const wethAddress_addr = Address.fromString(wethAddress);
  const sirTokenEthPrice = getBestPoolPrice(sirAddress_addr, wethAddress_addr);
  
  // Set entity properties from event parameters
  dividendsEntity.timestamp = event.block.timestamp;
  dividendsEntity.ethAmount = event.params.amountETH;
  dividendsEntity.stakedAmount = event.params.amountStakedSIR;
  dividendsEntity.sirEthPrice = sirTokenEthPrice;
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
    store.remove("UserPositionTea", userPositionId);
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
  const vault = VaultSchema.load(vaultId.toHexString());
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
  const vault = VaultSchema.load(vaultId.toHexString());
  if (!vault) return;

  const zeroAddr = Address.zero();

  // Tokens minted (from zero address) - increase total supply
  if (senderAddress.equals(zeroAddr)) {
    vault.totalTea = vault.totalTea.plus(transferAmount);
    vault.save();
  }

  // Tokens burned (to zero address) - decrease total supply
  if (recipientAddress.equals(zeroAddr)) {
    vault.totalTea = vault.totalTea.minus(transferAmount);
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
): void {
  const senderPositionId = generateUserPositionId(senderAddress, vaultId);
  const senderPosition = UserPositionTea.load(senderPositionId);
  const unclaimedRewardsResult = vaultContract.try_unclaimedRewards(vaultId, senderAddress);

  if (senderPosition && !unclaimedRewardsResult.reverted) {
    // Decrease sender's balance
    senderPosition.balance = senderPosition.balance.minus(transferAmount);
    
    // Remove position if both balance and unclaimed rewards are zero
    const hasNoBalance = senderPosition.balance.equals(BigInt.fromU64(0));
    const hasNoRewards = unclaimedRewardsResult.value.equals(BigInt.fromI32(0));
    
    if (hasNoBalance && hasNoRewards) {
      store.remove("UserPositionTea", senderPosition.id);
    } else {
      senderPosition.save();
    }
  }
}

/**
 * Updates or creates the recipient's TEA position
 */
function updateRecipientPosition(
  vaultId: BigInt,
  recipientAddress: Address,
  transferAmount: BigInt,
  vaultContract: Vault,
): void {
  const recipientPositionId = generateUserPositionId(recipientAddress, vaultId);
  const existingPosition = UserPositionTea.load(recipientPositionId);

  if (existingPosition !== null) {
    // Update existing position
    existingPosition.balance = existingPosition.balance.plus(transferAmount);
    existingPosition.save();
  } else {
    // Create new position
    createNewTeaPosition(recipientAddress, vaultId, transferAmount, vaultContract);
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
  const vaultParams = vaultContract.paramsById(vaultId);
  const debtTokenAddress = vaultParams.debtToken;
  const collateralTokenAddress = vaultParams.collateralToken;
  const leverageTier = vaultParams.leverageTier;

  // Get token contract instances for metadata
  const collateralTokenContract = ERC20.bind(collateralTokenAddress);
  const debtTokenContract = ERC20.bind(debtTokenAddress);

  // Create new position entity with optimized ID generation
  const positionId = generateUserPositionId(userAddress, vaultId);
  const newPosition = new UserPositionTea(positionId);
  
  // Set position properties
  newPosition.user = userAddress;
  newPosition.balance = initialBalance;
  newPosition.vaultId = vaultId.toString();
  newPosition.leverageTier = leverageTier.toString();
  
  // Set token addresses
  newPosition.debtToken = debtTokenAddress;
  newPosition.collateralToken = collateralTokenAddress;
  
  // Set token metadata
  newPosition.positionDecimals = collateralTokenContract.decimals();
  newPosition.debtSymbol = debtTokenContract.symbol();
  newPosition.collateralSymbol = collateralTokenContract.symbol();
  
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
  const vaultContract = Vault.bind(Address.fromString(vaultAddress));
  const vaultAddressBytes = Address.fromString(vaultAddress);

  // Update vault locked liquidity when tokens move to/from vault
  updateVaultLiquidity(vaultId, recipientAddress, senderAddress, transferAmount, vaultAddressBytes);
  
  // Update total TEA supply when tokens are minted/burned (zero address transfers)
  updateTotalTeaSupply(vaultId, recipientAddress, senderAddress, transferAmount);
  
  // Update sender's position
  updateSenderPosition(vaultId, senderAddress, transferAmount, vaultContract);
  
  // Update or create recipient's position
  updateRecipientPosition(vaultId, recipientAddress, transferAmount, vaultContract);
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
