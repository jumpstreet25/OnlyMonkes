/**
 * reclaim.ts
 *
 * Cross-device profile recovery: app side.
 *
 * Flow:
 *   1. Open DM with the bot.
 *   2. DM `/reclaim` (no args) → bot replies with a one-time, 5-minute challenge.
 *   3. Ask the caller-supplied `signChallenge` fn to sign the challenge bytes
 *      with the main wallet (MWA biometric prompt).
 *   4. DM `/reclaim <sigBase58> <pubkeyBase58>` → bot verifies and replies with a
 *      `PROFILE_SNAPSHOT:` payload.
 *   5. Bind the active wallet context to the reclaimed wallet, then union-merge
 *      the snapshot into local state (banana balance, shop ownership, PFP
 *      bindings, marketplace history). Merges are non-destructive.
 *
 * The same bot inboxId is used by BotChannelScreen — kept here locally to avoid
 * a cross-module import loop; it is a stable public identifier, not a secret.
 */

import { getXmtpClient } from '@/hooks/useXmtp';
import { openOrCreateDm, sendDmMessage } from '@/lib/xmtp';
import {
  parseProfileSnapshot,
  snapshotWalletAllowed,
  type ParsedProfileSnapshot,
} from '@/lib/profileSnapshot';
import { useAppStore } from '@/store/appStore';
import { mergeBananaBalance, loadBananaState, saveBananaState } from '@/lib/bananaRewards';
import { mergeOwnedItems, getEquippedStyles } from '@/lib/bananaShop';
import { mergeHistoryEntries, loadHistory } from '@/lib/marketplace';
import { rehydrateForWallet } from '@/lib/walletIdentity';
import { applyThemeFromShop } from '@/lib/shopTheme';

const BOT_INBOX_ID = '998001a498174b8a194110ee792b10f97de4965665eaf0d088ed2c71bdf62363';

/** Match the exact challenge string the bot emits. */
const CHALLENGE_PATTERN = /OnlyMonkes-Reclaim-[a-f0-9]+-\d+-[^\s]+/;

const CHALLENGE_WAIT_MS = 30_000;
const SNAPSHOT_WAIT_MS = 30_000;
const USER_SIGN_WAIT_MS = 60_000;

export type SignChallengeFn = (message: string) => Promise<{
  signatureBase58: string;
  pubkeyBase58: string;
}>;

export interface ReclaimSummary {
  wallet: string;
  bananaBalance: number;
  shopItemsRestored: number;
  marketplaceEntriesRestored: number;
  legendary: boolean;
  username?: string;
}

export interface RunReclaimArgs {
  signChallenge: SignChallengeFn;
  onStatus?: (msg: string) => void;
}

/** Drive the full /reclaim handshake and merge the returned snapshot. */
export async function runReclaim({ signChallenge, onStatus }: RunReclaimArgs): Promise<ReclaimSummary> {
  const client = getXmtpClient();
  if (!client) throw new Error('XMTP client not ready');
  const username = useAppStore.getState().username ?? 'anon';

  onStatus?.('Opening secure DM with bot…');
  const dm = await openOrCreateDm(client, BOT_INBOX_ID);

  const snapshot = await handshake(dm, username, signChallenge, onStatus);

  onStatus?.('Merging profile…');
  return applyProfileSnapshot(snapshot);
}

async function handshake(
  dm: any,
  username: string,
  signChallenge: SignChallengeFn,
  onStatus?: (msg: string) => void,
): Promise<ParsedProfileSnapshot> {
  return new Promise<ParsedProfileSnapshot>((resolve, reject) => {
    let stopStream: (() => void) | null = null;
    let settled = false;
    let challengeSeen = false;

    const overallTimer = setTimeout(() => {
      if (!settled) finish(new Error('Reclaim timed out — bot did not respond in time'));
    }, CHALLENGE_WAIT_MS + USER_SIGN_WAIT_MS + SNAPSHOT_WAIT_MS);

    const finish = (err: Error | null, snap?: ParsedProfileSnapshot) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      try { stopStream?.(); } catch { /* ignore */ }
      err ? reject(err) : resolve(snap!);
    };

    (async () => {
      try {
        const handler = async (raw: any) => {
          if (settled) return;
          const content = typeof raw.content === 'function' ? raw.content() : raw.content;
          if (typeof content !== 'string') return;
          const senderInboxId: string = raw.senderInboxId ?? '';
          if (senderInboxId !== BOT_INBOX_ID) return; // only trust bot's messages

          if (content.startsWith('PROFILE_SNAPSHOT:')) {
            const parsed = parseProfileSnapshot(content);
            if (parsed) finish(null, parsed);
            else finish(new Error('Received malformed PROFILE_SNAPSHOT'));
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
            onStatus?.('Sign the challenge with your wallet…');
            try {
              const { signatureBase58, pubkeyBase58 } = await signChallenge(match[0]);
              onStatus?.('Verifying signature…');
              await sendDmMessage(dm, `/reclaim ${signatureBase58} ${pubkeyBase58}`, username);
            } catch (err) {
              finish(err instanceof Error ? err : new Error('Failed to sign challenge'));
            }
          }
        };

        const stop = await dm.streamMessages(handler);
        stopStream = typeof stop === 'function' ? stop : null;

        onStatus?.('Requesting challenge from bot…');
        await sendDmMessage(dm, '/reclaim', username);
      } catch (err) {
        finish(err instanceof Error ? err : new Error('Reclaim handshake failed'));
      }
    })();
  });
}

export { snapshotWalletAllowed };

/**
 * Merge a verified snapshot into local state. Non-destructive:
 *   - Banana balance: MAX(local, remote) — never decreases.
 *   - Shop ownership + PFP bindings: union union union.
 *   - Marketplace history: deduped merge, capped to last 200.
 * All writes land on the wallet-keyed storage row.
 *
 * Used by manual `/reclaim` and by auto-restore when the bot pushes
 * PROFILE_SNAPSHOT after wallet connect / XMTP ready.
 */
export async function applyProfileSnapshot(snap: ParsedProfileSnapshot): Promise<ReclaimSummary> {
  const connected = useAppStore.getState().wallet?.address ?? null;
  if (!snapshotWalletAllowed(snap.wallet, connected)) {
    throw new Error('Snapshot wallet does not match the connected wallet');
  }

  await rehydrateForWallet(snap.wallet);

  let finalBalance = 0;
  if (typeof snap.bananaBalance === 'number' && snap.bananaBalance > 0) {
    finalBalance = await mergeBananaBalance(snap.bananaBalance);
  } else {
    finalBalance = (await loadBananaState()).balance;
  }

  if (snap.shopOwned?.length || snap.pfpBindings) {
    await mergeOwnedItems(snap.shopOwned ?? [], snap.pfpBindings);
  }

  let marketplaceEntriesRestored = 0;
  if (snap.marketplaceHistory?.length) {
    await loadHistory(); // ensure in-memory cache is primed for the current wallet
    marketplaceEntriesRestored = mergeHistoryEntries(snap.marketplaceHistory);
  }

  // Sync Zustand
  const app = useAppStore.getState();
  app.setBananaBalance(finalBalance);
  if (snap.username && !app.username) app.setUsername(snap.username);
  try {
    const styles = await getEquippedStyles();
    app.setShopStyles(styles);
    applyThemeFromShop(styles);
  } catch { /* shop styles are best-effort */ }

  // totalEarned is a lifetime counter — if the reclaimed balance is higher than
  // local totalEarned, bump totalEarned too so the "lifetime earned" UI stays
  // consistent with the restored balance.
  const state = await loadBananaState();
  if (finalBalance > state.totalEarned) {
    state.totalEarned = finalBalance;
    await saveBananaState(state);
  }

  return {
    wallet: snap.wallet,
    bananaBalance: finalBalance,
    shopItemsRestored: snap.shopOwned?.length ?? 0,
    marketplaceEntriesRestored,
    legendary: !!snap.legendary,
    username: snap.username,
  };
}
