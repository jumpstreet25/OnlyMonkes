/**
 * Push tokens go privately to the bot, never to the group (audit 2026-11-04, H1).
 *
 * - registerPushTokensWithBot: `PUSH_REGISTER:{pt,ept}` in this phone's own DM
 *   with the bot. XMTP proves the sender; nobody else sees the tokens.
 * - requestDmPush: after sending a DM, `PUSH_DM:{to}` asks the bot to notify the
 *   recipient. No message text leaves the conversation; the push says only who wrote.
 * Both prefixes are filtered in decodeMessage(). Bot side: lib/push/pushControl.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BOT_INBOX_IDS } from '@/lib/constants';
import { openOrCreateDm } from '@/lib/xmtp';

const REGISTERED_KEY = 'push_registered_v1';
const REREGISTER_MS = 7 * 24 * 3600_000;
const PEER_GAP_MS = 30_000;
const _lastPushToPeer = new Map<string, number>();

async function sendToBot(text: string): Promise<void> {
  // Lazy: useXmtp imports this module.
  const { getXmtpClient } = require('@/hooks/useXmtp') as typeof import('@/hooks/useXmtp');
  const client = getXmtpClient();
  if (!client) return;
  const dm = await openOrCreateDm(client, BOT_INBOX_IDS[0]);
  await dm.send(text);
}

export async function registerPushTokensWithBot(pt: string | null, ept: string | null): Promise<void> {
  if (!pt && !ept) return;
  try {
    const sig = `${pt ?? ''}|${ept ?? ''}`;
    const prev = JSON.parse((await AsyncStorage.getItem(REGISTERED_KEY)) ?? 'null') as { sig: string; at: number } | null;
    if (prev?.sig === sig && Date.now() - prev.at < REREGISTER_MS) return;
    await sendToBot(`PUSH_REGISTER:${JSON.stringify({ pt: pt ?? '', ept: ept ?? '' })}`);
    await AsyncStorage.setItem(REGISTERED_KEY, JSON.stringify({ sig, at: Date.now() }));
  } catch (err) {
    if (__DEV__) console.warn('[push] register with bot failed:', (err as Error).message);
  }
}

export function requestDmPush(peerInboxId: string): void {
  if (BOT_INBOX_IDS.includes(peerInboxId)) return;
  const now = Date.now();
  if (now - (_lastPushToPeer.get(peerInboxId) ?? -Infinity) < PEER_GAP_MS) return;
  _lastPushToPeer.set(peerInboxId, now);
  sendToBot(`PUSH_DM:${JSON.stringify({ to: peerInboxId })}`).catch((err) => {
    if (__DEV__) console.warn('[push] DM push request failed:', (err as Error).message);
  });
}
