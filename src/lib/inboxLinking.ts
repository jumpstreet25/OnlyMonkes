/**
 * inboxLinking.ts
 *
 * Wallet-ownership-verified inbox linking: app side.
 *
 * Different app installs (e.g. production vs. the 3.0/canary test build) each
 * create their own local XMTP inbox even on the same wallet — SecureStore is
 * sandboxed per Android applicationId, so there's no local way for one install
 * to know about another's inboxId. The bot already tracks every inboxId ever
 * seen for a wallet (`walletProfileIndex.ts`'s knownInboxIds, the same store
 * `/reclaim` reads from). This asks the bot for that list, gated by the same
 * challenge/verify wallet-signature proof `/reclaim` uses, so the mapping is
 * only ever returned to the wallet's own owner.
 *
 * Flow:
 *   1. Open DM with the bot.
 *   2. DM `/myinboxes` (no args) → bot replies with a one-time, 5-minute challenge.
 *   3. Ask the caller-supplied `signChallenge` fn to sign the challenge bytes
 *      with the main wallet (MWA biometric prompt).
 *   4. DM `/myinboxes <sigBase58> <pubkeyBase58>` → bot verifies and replies
 *      with a `MY_INBOXES:` payload.
 *
 * Read-only — never mutates wallet/profile state (unlike /reclaim).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getXmtpClient } from '@/hooks/useXmtp';
import { openOrCreateDm, sendDmMessage, parseMyInboxes, parseProfileSnapshot } from '@/lib/xmtp';
import { useAppStore } from '@/store/appStore';
import { applyProfileSnapshot, type SignChallengeFn } from '@/lib/reclaim';
import { getRememberedInboxIds, loadLocalInboxIds } from '@/lib/localInboxes';

const BOT_INBOX_ID = '998001a498174b8a194110ee792b10f97de4965665eaf0d088ed2c71bdf62363';
const CACHE_KEY_PREFIX = 'inbox_links_';

/** Match the exact challenge string the bot emits. */
const CHALLENGE_PATTERN = /OnlyMonkes-Reclaim-[a-f0-9]+-\d+-[^\s]+/;

const CHALLENGE_WAIT_MS = 30_000;
const RESPONSE_WAIT_MS = 30_000;
const USER_SIGN_WAIT_MS = 60_000;

/** Drive the /myinboxes handshake. Returns every inboxId known for this wallet. */
export async function requestMyInboxes(signChallenge: SignChallengeFn): Promise<string[]> {
  const client = getXmtpClient();
  if (!client) throw new Error('XMTP client not ready');
  const username = useAppStore.getState().username ?? 'anon';

  const dm = await openOrCreateDm(client, BOT_INBOX_ID);
  const result = await handshake(dm, username, signChallenge);
  return result.inboxIds;
}

// ─── Cache + isMineInbox ─────────────────────────────────────────────────────
// Every senderAddress that shares this wallet (across separate app installs
// like production vs. the 3.0/canary test build) should render as "own" in
// chat, not as a stranger. `_linkedInboxIds` is populated best-effort — if the
// handshake never completes (offline, user declines the extra sign prompt),
// cross-install messages simply keep rendering as incoming, same as today.

let _linkedInboxIds: Set<string> = new Set();

function cacheKey(walletAddress: string): string {
  return CACHE_KEY_PREFIX + walletAddress.slice(0, 16);
}

/** Load any previously-cached inbox links for this wallet into memory. Call at boot. */
export async function loadCachedInboxLinks(walletAddress: string): Promise<void> {
  await loadLocalInboxIds(walletAddress);
  for (const id of getRememberedInboxIds()) _linkedInboxIds.add(id);
  try {
    const raw = await AsyncStorage.getItem(cacheKey(walletAddress));
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.inboxIds)) {
      for (const id of parsed.inboxIds) {
        if (typeof id === "string" && id) _linkedInboxIds.add(id);
      }
    }
  } catch { /* best-effort */ }
}

async function cacheInboxIds(walletAddress: string, inboxIds: string[]): Promise<void> {
  for (const id of inboxIds) {
    if (id) _linkedInboxIds.add(id);
  }
  for (const id of getRememberedInboxIds()) _linkedInboxIds.add(id);
  try {
    await AsyncStorage.setItem(
      cacheKey(walletAddress),
      JSON.stringify({ inboxIds: [..._linkedInboxIds], fetchedAt: Date.now() }),
    );
  } catch { /* best-effort */ }
}

/**
 * Kick off the /myinboxes handshake in the background and cache the result.
 * Fire-and-forget — only call where a live wallet-signing session already
 * exists (right after an interactive connect()), never on the fast/headless
 * boot paths that have no signing capability available.
 */
export function refreshInboxLinks(walletAddress: string, signChallenge: SignChallengeFn): void {
  void (async () => {
    try {
      const inboxIds = await requestMyInboxes(signChallenge);
      await cacheInboxIds(walletAddress, inboxIds);
    } catch {
      // Non-critical — cross-install "own message" detection just won't
      // work yet. Nothing user-facing breaks; try again next fresh connect.
    }
  })();
}

/** Does `senderAddress` belong to the same wallet as the local client's own inbox? */
export function isMineInbox(senderAddress: string, myInboxId: string): boolean {
  if (senderAddress === myInboxId) return true;
  if (_linkedInboxIds.has(senderAddress)) return true;
  return getRememberedInboxIds().has(senderAddress);
}

function handshake(
  dm: any,
  username: string,
  signChallenge: SignChallengeFn,
): Promise<{ wallet: string; inboxIds: string[] }> {
  return new Promise((resolve, reject) => {
    let stopStream: (() => void) | null = null;
    let settled = false;
    let challengeSeen = false;

    const overallTimer = setTimeout(() => {
      if (!settled) finish(new Error('myinboxes timed out — bot did not respond in time'));
    }, CHALLENGE_WAIT_MS + USER_SIGN_WAIT_MS + RESPONSE_WAIT_MS);

    const finish = (err: Error | null, res?: { wallet: string; inboxIds: string[] }) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      try { stopStream?.(); } catch { /* ignore */ }
      err ? reject(err) : resolve(res!);
    };

    (async () => {
      try {
        const handler = async (raw: any) => {
          if (settled) return;
          const content = typeof raw.content === 'function' ? raw.content() : raw.content;
          if (typeof content !== 'string') return;
          const senderInboxId: string = raw.senderInboxId ?? '';
          if (senderInboxId !== BOT_INBOX_ID) return; // only trust bot's messages

          const snap = parseProfileSnapshot(content);
          if (snap) {
            void applyProfileSnapshot(snap).catch(() => {});
            return;
          }

          const parsedInboxes = parseMyInboxes(content);
          if (parsedInboxes) {
            finish(null, parsedInboxes);
            return;
          }
          if (content.startsWith('MY_INBOXES:')) {
            finish(new Error('Received malformed MY_INBOXES'));
            return;
          }

          // Error replies surfaced by the bot start with ❌.
          if (content.includes('❌')) {
            const line = content.split('\n').find((l: string) => l.includes('❌')) ?? content;
            finish(new Error(line.replace(/^MSG:[^:]+:/, '').trim()));
            return;
          }

          if (!challengeSeen) {
            const match = content.match(CHALLENGE_PATTERN);
            if (!match) return;
            challengeSeen = true;
            try {
              const { signatureBase58, pubkeyBase58 } = await signChallenge(match[0]);
              await sendDmMessage(dm, `/myinboxes ${signatureBase58} ${pubkeyBase58}`, username);
            } catch (err) {
              finish(err instanceof Error ? err : new Error('Failed to sign challenge'));
            }
          }
        };

        const stop = await dm.streamMessages(handler);
        stopStream = typeof stop === 'function' ? stop : null;

        await sendDmMessage(dm, '/myinboxes', username);
      } catch (err) {
        finish(err instanceof Error ? err : new Error('myinboxes handshake failed'));
      }
    })();
  });
}
