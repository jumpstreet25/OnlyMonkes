/**
 * grants.ts — One-time wallet-keyed account grants.
 *
 * Mirrors the existing dev-account-restore pattern in app/_layout.tsx but
 * generalized so we can issue OG / community grants without touching the
 * layout each time. A grant fires once per wallet per device (gated by an
 * AsyncStorage flag), then the user is on the standard purchase path for any
 * NEW shop items added after the grant.
 *
 * `freeShopSnapshot: true` adds every item currently in SHOP_ITEMS to the
 * wallet's `owned` list — the user sees Equip instead of Buy on the catalog.
 * Items added to SHOP_ITEMS later are NOT retroactively granted; they cost
 * bananas + crypto like everyone else.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { addBananas, loadBananaState } from "./bananaRewards";
import { SHOP_ITEMS, loadShopState, saveShopState, getEquippedStyles } from "./bananaShop";
import { applyThemeFromShop } from "./shopTheme";
import { useAppStore } from "@/store/appStore";

interface Grant {
  bananas?: number;          // bananas to add to existing balance
  freeShopSnapshot?: boolean; // mark every current SHOP_ITEMS entry as owned
  label: string;             // for logging / Alert message
}

const GRANTS: Record<string, Grant> = {
  // Rugdoctor — OG community member
  "2C6QToL8coMWLQYbAtLLLKZpyrrPVbmxacnxc5vN7mZK": {
    bananas: 5000,
    freeShopSnapshot: true,
    label: "Rugdoctor — 5000 🍌 + current Banana Shop",
  },
};

/**
 * Apply the matching grant for the connected wallet, if any. No-op when:
 *   - wallet isn't in the grants list
 *   - the grant has already been applied on this device
 *
 * Returns true if a grant was newly applied (caller can show a confirmation),
 * false otherwise.
 */
export async function applyGrantIfEligible(walletAddress: string): Promise<{
  applied: boolean;
  label?: string;
}> {
  const grant = GRANTS[walletAddress];
  if (!grant) return { applied: false };

  const flagKey = `grant_applied_${walletAddress}_v1`;
  try {
    const already = await AsyncStorage.getItem(flagKey);
    if (already) return { applied: false };
  } catch {
    /* if we can't read the flag, fail closed and skip — better than double-granting */
    return { applied: false };
  }

  // Bananas — addBananas mutates the persisted state and returns the new
  // total. Mirror to the in-memory store so the UI updates immediately.
  if (grant.bananas && grant.bananas > 0) {
    try {
      const newTotal = await addBananas(grant.bananas);
      useAppStore.getState().setBananaBalance(newTotal);
    } catch {
      /* if banana write fails (SQLITE_FULL etc.), skip — safeStorageSet
         already retries internally; reaching here means even the rescue
         didn't help, in which case marking the grant flag would lose money */
      return { applied: false };
    }
  }

  // Free shop snapshot — merge every CURRENT SHOP_ITEMS id into owned so
  // the user can equip without paying. Items added after this point need
  // bananas + crypto like normal.
  if (grant.freeShopSnapshot) {
    try {
      const ss = await loadShopState();
      const currentIds = SHOP_ITEMS.map((i) => i.id);
      const merged = new Set([...(ss.owned ?? []), ...currentIds]);
      ss.owned = Array.from(merged);
      await saveShopState(ss);
      const styles = await getEquippedStyles();
      useAppStore.getState().setShopStyles(styles);
      applyThemeFromShop(styles);
    } catch {
      // Same reasoning as above — don't burn the grant flag if the write failed.
      return { applied: false };
    }
  }

  // Mark applied — only after every step succeeded.
  try {
    await AsyncStorage.setItem(flagKey, String(Date.now()));
  } catch {
    /* If even the flag write fails the user might get a second grant on next
       launch — acceptable trade-off; SQLITE_FULL self-heal should prevent it. */
  }
  return { applied: true, label: grant.label };
}

/** Read-only export for tests / debugging. */
export function listGrants(): Array<{ wallet: string } & Grant> {
  return Object.entries(GRANTS).map(([wallet, g]) => ({ wallet, ...g }));
}
