/**
 * bananaGrant.ts — Process BANANA_GRANT: messages with deduplication.
 *
 * Grants are tracked by XMTP message ID in AsyncStorage so each grant
 * is only applied once, even if the message appears in both history
 * and live stream, or across app restarts.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";
import { addBananas } from "@/lib/bananaRewards";
import { BOT_INBOX_IDS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";

const AK_CLAIMED_GRANTS = "banana_grants_claimed_v1";
let _claimedIds: Set<string> | null = null;

async function loadClaimed(): Promise<Set<string>> {
  if (_claimedIds) return _claimedIds;
  try {
    const raw = await AsyncStorage.getItem(AK_CLAIMED_GRANTS);
    _claimedIds = raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    _claimedIds = new Set();
  }
  return _claimedIds;
}

async function markClaimed(msgId: string): Promise<void> {
  const claimed = await loadClaimed();
  claimed.add(msgId);
  // Keep max 200 entries to prevent unbounded growth
  if (claimed.size > 200) {
    const arr = [...claimed];
    _claimedIds = new Set(arr.slice(arr.length - 200));
  }
  await AsyncStorage.setItem(AK_CLAIMED_GRANTS, JSON.stringify([..._claimedIds!]));
}

/**
 * Process a BANANA_GRANT: message. Safe to call from both history and stream —
 * deduplicates by XMTP message ID.
 *
 * @param msgId    XMTP message ID (unique per message)
 * @param content  Full message string starting with "BANANA_GRANT:"
 * @param senderId Sender's inbox ID (must be in BOT_INBOX_IDS)
 * @param showAlert Whether to show a UI alert (true for stream, false for history)
 */
export async function processBananaGrant(
  msgId: string,
  content: string,
  senderId: string,
  showAlert = true,
): Promise<void> {
  if (!BOT_INBOX_IDS.includes(senderId)) return;

  const claimed = await loadClaimed();
  if (claimed.has(msgId)) return; // already processed

  const parts = content.slice("BANANA_GRANT:".length).split(":");
  const amount = parseInt(parts[0], 10);
  if (!amount || amount <= 0 || amount > 10000) return;

  const target = parts[1]?.trim() || null;
  const myUsername = useAppStore.getState().username;
  const myLower = myUsername?.toLowerCase() ?? "";

  // Targeted grant — only matching user receives it
  if (target) {
    if (!myLower) return; // username not loaded yet — will retry on next history load
    if (target.toLowerCase() !== myLower) {
      await markClaimed(msgId);
      return;
    }
  }
  // No target = everyone gets it (no username needed)

  const newBalance = await addBananas(amount);
  useAppStore.getState().setBananaBalance(newBalance);
  await markClaimed(msgId);

  if (showAlert) {
    Alert.alert("🍌 Banana Airdrop!", `You received ${amount} bananas!`, [{ text: "Nice!" }]);
  }
}
