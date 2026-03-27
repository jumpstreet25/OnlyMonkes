/**
 * lootCrate.ts — Banana Loot Crate system.
 *
 * Spend 50 🍌 to spin. Random outcomes:
 *  - Common (60%): small banana bonus (5-15 🍌 back)
 *  - Uncommon (25%): temporary 2x banana earnings (24h)
 *  - Rare (10%): free shop item unlock (random Tier 1)
 *  - Epic (4%): free shop item unlock (random Tier 2)
 *  - Legendary (1%): limited-edition exclusive item
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { SHOP_ITEMS, addOwnedItem } from "@/lib/bananaShop";

const AK_LOOT = "loot_crate_v1";
const CRATE_COST = 50; // bananas

export type LootRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface LootResult {
  rarity: LootRarity;
  title: string;
  description: string;
  emoji: string;
  // What you get
  bananaBonus?: number;       // Extra bananas awarded
  multiplierHours?: number;   // 2x earnings for N hours
  unlockedItemId?: string;    // Shop item unlocked
  isLimitedEdition?: boolean; // Legendary exclusive
}

export interface LootState {
  totalSpins: number;
  lastSpinTs: number;
  multiplierUntil: number;    // epoch ms — 2x earnings active until this time
  legendaryWins: number;
}

const LOOT_TABLE: Array<{ weight: number; rarity: LootRarity; generate: () => LootResult }> = [
  // Common — 60%
  { weight: 60, rarity: "common", generate: () => {
    const bonus = 5 + Math.floor(Math.random() * 11); // 5-15
    return {
      rarity: "common", emoji: "🍌",
      title: `+${bonus} Bananas`,
      description: "A small banana stash! Better than nothing.",
      bananaBonus: bonus,
    };
  }},
  // Uncommon — 25%
  { weight: 25, rarity: "uncommon", generate: () => ({
    rarity: "uncommon", emoji: "⚡",
    title: "2x Banana Boost",
    description: "Double banana earnings for the next 24 hours!",
    multiplierHours: 24,
  })},
  // Rare — 10%
  { weight: 10, rarity: "rare", generate: () => {
    const tier1Items = SHOP_ITEMS.filter(i => i.tier === 1);
    const item = tier1Items[Math.floor(Math.random() * tier1Items.length)];
    return {
      rarity: "rare", emoji: "💎",
      title: `Free: ${item.name}`,
      description: `You unlocked a Tier 1 shop item for free!`,
      unlockedItemId: item.id,
    };
  }},
  // Epic — 4%
  { weight: 4, rarity: "epic", generate: () => {
    const tier2Items = SHOP_ITEMS.filter(i => i.tier === 2);
    const item = tier2Items[Math.floor(Math.random() * tier2Items.length)];
    return {
      rarity: "epic", emoji: "👑",
      title: `Free: ${item.name}`,
      description: `You unlocked a Tier 2 shop item for free!`,
      unlockedItemId: item.id,
    };
  }},
  // Legendary — 1%
  { weight: 1, rarity: "legendary", generate: () => ({
    rarity: "legendary", emoji: "🔥",
    title: "LEGENDARY: Holographic Bubble",
    description: "Ultra-rare shimmer effect. Only from Loot Crates.",
    unlockedItemId: "bubble_holographic_loot",
    isLimitedEdition: true,
  })},
];

function rollLoot(): LootResult {
  const totalWeight = LOOT_TABLE.reduce((s, e) => s + e.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of LOOT_TABLE) {
    roll -= entry.weight;
    if (roll <= 0) return entry.generate();
  }
  return LOOT_TABLE[0].generate(); // fallback
}

export async function loadLootState(): Promise<LootState> {
  try {
    const raw = await AsyncStorage.getItem(AK_LOOT);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { totalSpins: 0, lastSpinTs: 0, multiplierUntil: 0, legendaryWins: 0 };
}

async function saveLootState(state: LootState): Promise<void> {
  await AsyncStorage.setItem(AK_LOOT, JSON.stringify(state));
}

/** Check if 2x multiplier is currently active. */
export async function isMultiplierActive(): Promise<boolean> {
  const state = await loadLootState();
  return Date.now() < state.multiplierUntil;
}

/** Get crate cost. */
export function getCrateCost(): number {
  return CRATE_COST;
}

/**
 * Open a loot crate. Returns the result.
 * Caller must deduct bananas BEFORE calling this.
 */
export async function openCrate(): Promise<LootResult> {
  const state = await loadLootState();
  const result = rollLoot();

  state.totalSpins++;
  state.lastSpinTs = Date.now();

  // Apply result
  if (result.multiplierHours) {
    state.multiplierUntil = Date.now() + result.multiplierHours * 3600000;
  }
  if (result.unlockedItemId) {
    await addOwnedItem(result.unlockedItemId);
  }
  if (result.isLimitedEdition) {
    state.legendaryWins++;
  }

  await saveLootState(state);
  return result;
}

/** Rarity colors for UI. */
export function getRarityColor(rarity: LootRarity): string {
  switch (rarity) {
    case "common": return "#8B8B9E";
    case "uncommon": return "#6CB4EE";
    case "rare": return "#9945FF";
    case "epic": return "#FFD54F";
    case "legendary": return "#FF6B6B";
  }
}

/** Rarity glow intensity for animations. */
export function getRarityGlow(rarity: LootRarity): number {
  switch (rarity) {
    case "common": return 0.1;
    case "uncommon": return 0.3;
    case "rare": return 0.5;
    case "epic": return 0.7;
    case "legendary": return 1.0;
  }
}
