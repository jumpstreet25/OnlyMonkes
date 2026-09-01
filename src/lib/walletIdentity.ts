/**
 * walletIdentity.ts
 *
 * Single rehydration entry point invoked on every wallet connect/session restore.
 * Binds all wallet-scoped local storage to the connected wallet address, performs
 * a one-time migration of any legacy device-keyed data onto the wallet, warms the
 * in-memory caches, and pushes the banana balance into Zustand so the UI never
 * flashes 0.
 *
 * Why: state like banana balance, shop ownership, and marketplace history belongs
 * to the wallet, not the device. Keying it by wallet means reinstalling the app
 * (or installing on a new device) and reconnecting the same wallet restores the
 * full state — without it, users would appear to lose everything.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '@/store/appStore';
import { loadBananaState, setBananaWalletContext, addBananas } from '@/lib/bananaRewards';
import { setRaidsWalletContext } from '@/lib/bananaRaids';
import { loadShopState, getEquippedStyles, setShopWalletContext, mergeOwnedItems } from '@/lib/bananaShop';
import { loadHistory, setMarketplaceWalletContext } from '@/lib/marketplace';
import { applyThemeFromShop } from '@/lib/shopTheme';
import { fetchPurchaseReceiptsFromChain, isReceiptMintingAvailable } from '@/lib/cnftReceipts';
import { DEV_ADMIN_WALLET } from '@/lib/constants';

// Known dev/test wallet addresses that get auto-topped-up to a testing
// balance when their banana count drops below the threshold. Was a
// two-entry Set (DEV_WALLET + a hardcoded duplicate of the same address)
// from before DEV_WALLET and DEV_ADMIN_WALLET were split apart 2026-09-02 —
// DEV_WALLET is now the publisher/treasury wallet, a different address, so
// this only ever worked because of the hardcoded duplicate. Consolidated
// onto the one real constant.
const DEV_TEST_WALLETS = new Set<string>([DEV_ADMIN_WALLET]);
const DEV_BANANA_FLOOR = 1000;
const DEV_BANANA_GRANT = 5000;

let _activeWallet: string | null = null;

/** Tracks which wallets have already had their legacy unkeyed data migrated. */
const AK_MIGRATED = 'walletIdentity_migrated_v1';

const WALLET_SCOPED_KEYS: readonly [legacy: string, base: string][] = [
  ['banana_rewards_v1', 'banana_rewards_v1'],
  ['banana_shop_v1', 'banana_shop_v1'],
  ['marketplace_history_v1', 'marketplace_history_v1'],
];

export function getActiveWallet(): string | null {
  return _activeWallet;
}

/**
 * Bind all wallet-scoped stores to `walletAddress`, run a one-time legacy
 * migration if needed, warm the caches, and sync Zustand.
 *
 * Safe to call repeatedly for the same address (cheap no-op after the first).
 * Must be awaited BEFORE any UI that reads banana/shop/history state renders.
 */
export async function rehydrateForWallet(walletAddress: string): Promise<void> {
  const addr = walletAddress.trim();
  if (!addr) return;

  const switched = _activeWallet !== addr;
  _activeWallet = addr;

  setBananaWalletContext(addr);
  setRaidsWalletContext(addr);
  setShopWalletContext(addr);
  setMarketplaceWalletContext(addr);

  if (switched) {
    await migrateLegacyIfNeeded(addr);
  }

  const [bananaState] = await Promise.all([
    loadBananaState(),
    loadShopState(),
    loadHistory(),
  ]);

  // The layout pre-loaded shop styles from the legacy key before the wallet was
  // known. Re-read them now that we're bound to the wallet so equipped
  // cosmetics/theme reflect the wallet's purchases, not device defaults.
  const styles = await getEquippedStyles();
  const app = useAppStore.getState();

  // ── Dev wallet test top-up. ──
  // Auto-grant bananas to known dev/test wallets when their balance drops
  // below DEV_BANANA_FLOOR. Lets the dev test any shop tier (incl. 750 🍌
  // Tier 5 Worlds) without grinding daily claims. No-op for production users.
  let effectiveBalance = bananaState.balance;
  if (DEV_TEST_WALLETS.has(addr) && effectiveBalance < DEV_BANANA_FLOOR) {
    try {
      effectiveBalance = await addBananas(DEV_BANANA_GRANT);
    } catch { /* non-fatal */ }
  }

  app.setBananaBalance(effectiveBalance);
  app.setShopStyles(styles);
  applyThemeFromShop(styles);

  // ── Background: reconcile shop ownership from on-chain cNFT receipts. ──
  // Non-blocking. If a user lands on a fresh device with no chat history
  // and never runs /reclaim, this still recovers their purchases as long as
  // they minted on-chain receipts at buy time. Failures are silent — we
  // still have AsyncStorage + PROFILE_UPDATE merges as fallbacks.
  if (isReceiptMintingAvailable()) {
    fetchPurchaseReceiptsFromChain(addr)
      .then(async (chainItemIds) => {
        if (chainItemIds.length === 0) return;
        const changed = await mergeOwnedItems(chainItemIds);
        if (changed) {
          // Re-read merged styles + push to Zustand so UI reflects restored items.
          const merged = await getEquippedStyles();
          useAppStore.getState().setShopStyles(merged);
          applyThemeFromShop(merged);
        }
      })
      .catch(() => { /* silent — local + xmtp paths still cover the user */ });
  }
}

/**
 * Copy legacy device-keyed rows onto the wallet-keyed rows the first time this
 * wallet connects on this device. The legacy row is left intact (harmless) so
 * users rolling back to an older app version don't lose state either.
 * Skipped once a wallet is in the migrated list, so a second wallet connecting
 * later on the same device does NOT inherit the first wallet's data.
 */
async function migrateLegacyIfNeeded(walletAddress: string): Promise<void> {
  const rawMigrated = await AsyncStorage.getItem(AK_MIGRATED).catch(() => null);
  let migrated: string[] = [];
  try { migrated = rawMigrated ? JSON.parse(rawMigrated) : []; } catch { migrated = []; }
  if (!Array.isArray(migrated)) migrated = [];
  if (migrated.includes(walletAddress)) return;

  for (const [legacyKey, baseKey] of WALLET_SCOPED_KEYS) {
    const walletKey = `${baseKey}:${walletAddress}`;
    const [walletVal, legacyVal] = await Promise.all([
      AsyncStorage.getItem(walletKey).catch(() => null),
      AsyncStorage.getItem(legacyKey).catch(() => null),
    ]);
    if (legacyVal && !walletVal) {
      await AsyncStorage.setItem(walletKey, legacyVal).catch(() => {});
    }
  }

  migrated.push(walletAddress);
  await AsyncStorage.setItem(AK_MIGRATED, JSON.stringify(migrated)).catch(() => {});
}

/** Clear the active wallet context — call on wallet disconnect / reset. */
export function clearActiveWallet(): void {
  _activeWallet = null;
  setBananaWalletContext(null);
  setRaidsWalletContext(null);
  setShopWalletContext(null);
  setMarketplaceWalletContext(null);
}
