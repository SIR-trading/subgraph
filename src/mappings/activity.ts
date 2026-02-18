import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Activity, ActivityCounter } from "../../generated/schema";

const BUFFER_SIZE = 30;
const COUNTER_ID = Bytes.fromHexString("0x00");

/**
 * Creates or overwrites an Activity entity in a circular buffer of 30 slots.
 * Slot = counter % 30, so old entries get overwritten automatically.
 *
 * For isAPE: pass true/false for mint/burn events. For other events,
 * the field stays unset (null in GraphQL) since the entity is overwritten each time.
 */
export function createActivity(
  type: string,
  user: Bytes | null,
  timestamp: BigInt,
  txHash: Bytes,
  blockNumber: BigInt,
  logIndex: BigInt,
  vaultId: Bytes | null,
  amount: BigInt | null,
  isAPE: boolean,
  hasIsAPE: boolean,
  token: Bytes | null
): void {
  // Load or create the singleton counter
  let counter = ActivityCounter.load(COUNTER_ID);
  if (!counter) {
    counter = new ActivityCounter(COUNTER_ID);
    counter.count = BigInt.fromI32(0);
  }

  const count = counter.count;
  const slot = count.mod(BigInt.fromI32(BUFFER_SIZE));
  const entityId = Bytes.fromUTF8("activity-" + slot.toString());

  // Create or overwrite the activity at this slot
  let activity = Activity.load(entityId);
  if (!activity) {
    activity = new Activity(entityId);
  }

  activity.counter = count;
  activity.type = type;
  activity.user = user;
  activity.vaultId = vaultId;
  activity.amount = amount;
  if (hasIsAPE) {
    activity.isAPE = isAPE;
  }
  activity.token = token;
  activity.timestamp = timestamp;
  activity.txHash = txHash;
  activity.blockNumber = blockNumber;
  activity.logIndex = logIndex;

  activity.save();

  // Increment counter
  counter.count = count.plus(BigInt.fromI32(1));
  counter.save();
}
