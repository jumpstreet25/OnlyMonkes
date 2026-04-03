/**
 * bananaShop.ts — Banana Shop catalog, ownership, and purchase logic.
 *
 * Users need bananas (engagement) + crypto ($SKR or $SOL) to buy items.
 * Bananas are deducted on purchase. Crypto goes to Dev wallet via MWA.
 * Purchases are one-time, permanent. Users can own multiple, equip one per category.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const AK_SHOP = "banana_shop_v1";

// ─── Item Categories ─────────────────────────────────────────────────────────

export type ShopCategory = "bubble" | "text" | "pfp" | "theme";

export interface ShopItem {
  id: string;
  name: string;
  description: string;
  category: ShopCategory;
  tier: 1 | 2 | 3 | 4;
  bananaCost: number;      // Bananas deducted from balance
  usdCost: number;         // $1-4 paid in SKR or SOL
  preview: string;         // Emoji or short visual hint shown in shop
  // Style overrides applied when equipped
  style: Record<string, string | number | boolean>;
  // Limited/seasonal availability
  seasonal?: {
    name: string;          // e.g. "Breakpoint 2026"
    availableFrom: number; // epoch ms
    availableUntil: number;
  };
}

// ─── Shop Catalog ────────────────────────────────────────────────────────────

export const SHOP_ITEMS: ShopItem[] = [
  // ── Tier 1: Chat Bubble Styles (25-50 🍌, $1) ──────────────────────────
  {
    id: "bubble_neon_blue",
    name: "Neon Blue Glow",
    description: "Your bubbles glow with a bright neon blue edge",
    category: "bubble", tier: 1, bananaCost: 25, usdCost: 1,
    preview: "💎",
    style: { glowColor: "#00d4ff", glowOpacity: 0.8, glowRadius: 20 },
  },
  {
    id: "bubble_neon_pink",
    name: "Neon Pink Glow",
    description: "Hot pink neon glow around your messages",
    category: "bubble", tier: 1, bananaCost: 25, usdCost: 1,
    preview: "🩷",
    style: { glowColor: "#ff69b4", glowOpacity: 0.8, glowRadius: 20 },
  },
  {
    id: "bubble_neon_green",
    name: "Neon Green Glow",
    description: "Electric green glow — matrix vibes",
    category: "bubble", tier: 1, bananaCost: 30, usdCost: 1,
    preview: "🟢",
    style: { glowColor: "#39ff14", glowOpacity: 0.8, glowRadius: 20 },
  },
  {
    id: "bubble_gold_glow",
    name: "Gold Glow",
    description: "Premium gold glow for the distinguished monke",
    category: "bubble", tier: 1, bananaCost: 35, usdCost: 1,
    preview: "✨",
    style: { glowColor: "#FFDC6B", glowOpacity: 0.95, glowRadius: 22 },
  },
  {
    id: "bubble_frosted",
    name: "Frosted Ice",
    description: "Ice-blue frosted glass — ultra-transparent premium look",
    category: "bubble", tier: 1, bananaCost: 40, usdCost: 1,
    preview: "🧊",
    style: { glowColor: "#a8d8ff", glowOpacity: 0.7, glowRadius: 18, glassOpacity: 0.55 },
  },
  {
    id: "bubble_dark_ember",
    name: "Dark Ember",
    description: "Ultra-dark with a subtle red ember glow",
    category: "bubble", tier: 1, bananaCost: 50, usdCost: 1,
    preview: "🔥",
    style: { glowColor: "#ff4500", glowOpacity: 0.6, bgColor: "rgba(40,10,10,0.7)" },
  },

  // ── Tier 2: Text & Name Styles (50-100 🍌, $2) ─────────────────────────
  {
    id: "text_gold_name",
    name: "Gold Name",
    description: "Your username shines gold in the chat",
    category: "text", tier: 2, bananaCost: 50, usdCost: 2,
    preview: "👑",
    style: { nameColor: "#FFD700" },
  },
  {
    id: "text_neon_cyan",
    name: "Neon Cyan Name",
    description: "Cyberpunk cyan username",
    category: "text", tier: 2, bananaCost: 50, usdCost: 2,
    preview: "🌊",
    style: { nameColor: "#00ffff" },
  },
  {
    id: "text_neon_pink_name",
    name: "Neon Pink Name",
    description: "Hot pink username that pops",
    category: "text", tier: 2, bananaCost: 50, usdCost: 2,
    preview: "💖",
    style: { nameColor: "#ff69b4" },
  },
  {
    id: "text_custom_color",
    name: "Custom Text Color",
    description: "Pick any color for your message text",
    category: "text", tier: 2, bananaCost: 75, usdCost: 2,
    preview: "🎨",
    style: { customTextColor: true },
  },
  {
    id: "text_bold",
    name: "Bold Messages",
    description: "Your messages render in bold",
    category: "text", tier: 2, bananaCost: 50, usdCost: 2,
    preview: "🅱️",
    style: { fontWeight: "bold" },
  },
  {
    id: "text_mono",
    name: "Monospace Mode",
    description: "Messages in monospace — coder aesthetic",
    category: "text", tier: 2, bananaCost: 50, usdCost: 2,
    preview: "⌨️",
    style: { fontFamily: "mono" },
  },

  // ── Tier 3: PFP Styles (100-200 🍌, $3) ────────────────────────────────
  {
    id: "pfp_theme",
    name: "PFP Color Theme",
    description: "Your NFT's dominant color becomes your bubble + glow color",
    category: "pfp", tier: 3, bananaCost: 150, usdCost: 3,
    preview: "🎭",
    style: { pfpThemeEnabled: true },
  },
  {
    id: "pfp_aura",
    name: "PFP Aura",
    description: "Your PFP glow uses your NFT's color instead of purple",
    category: "pfp", tier: 3, bananaCost: 100, usdCost: 3,
    preview: "🔮",
    style: { pfpAuraEnabled: true },
  },
  {
    id: "pfp_frame_pulse",
    name: "Pulse Frame",
    description: "Animated pulsing ring around your PFP",
    category: "pfp", tier: 3, bananaCost: 100, usdCost: 3,
    preview: "💫",
    style: { pfpFrame: "pulse" },
  },

  // ── Tier 4: App Themes (200-500 🍌, $4) ────────────────────────────────
  {
    id: "theme_midnight",
    name: "Midnight Blue",
    description: "Deep navy tint across the entire app",
    category: "theme", tier: 4, bananaCost: 200, usdCost: 4,
    preview: "🌙",
    style: { themeBg: "#050a18", themeSurface: "#0a1225", themeAccent: "#4a90d9" },
  },
  {
    id: "theme_solana_purple",
    name: "Solana Purple",
    description: "Purple-dominant Solana brand theme",
    category: "theme", tier: 4, bananaCost: 200, usdCost: 4,
    preview: "💜",
    style: { themeBg: "#0a0515", themeSurface: "#120a22", themeAccent: "#9945FF" },
  },
  {
    id: "theme_banana",
    name: "Banana Yellow",
    description: "Gold/yellow accent — for true banana enthusiasts",
    category: "theme", tier: 4, bananaCost: 250, usdCost: 4,
    preview: "🍌",
    style: { themeBg: "#0f0d05", themeSurface: "#1a1608", themeAccent: "#FFD54F" },
  },
  {
    id: "theme_matrix",
    name: "Matrix Green",
    description: "Green-on-black hacker aesthetic",
    category: "theme", tier: 4, bananaCost: 250, usdCost: 4,
    preview: "🟩",
    style: { themeBg: "#000a00", themeSurface: "#001a00", themeAccent: "#00ff41" },
  },
  {
    id: "theme_pfp_full",
    name: "PFP Full Theme",
    description: "Your NFT's palette becomes the entire app. The ultimate flex.",
    category: "theme", tier: 4, bananaCost: 500, usdCost: 4,
    preview: "👑",
    style: { pfpFullTheme: true },
  },
];

// ─── Seasonal / Limited Items ────────────────────────────────────────────────

export const SEASONAL_ITEMS: ShopItem[] = [
  {
    id: "bubble_breakpoint_2026",
    name: "Breakpoint 2026",
    description: "Exclusive bubble style — only during Solana Breakpoint",
    category: "bubble", tier: 2, bananaCost: 50, usdCost: 2,
    preview: "🏟️",
    style: { glowColor: "#14F195", glowOpacity: 0.9, glowRadius: 22, borderColor: "rgba(20,241,149,0.3)" },
    seasonal: {
      name: "Breakpoint 2026",
      availableFrom: new Date("2026-09-18").getTime(),
      availableUntil: new Date("2026-09-22").getTime(),
    },
  },
];

/** Get items available right now (including in-season limited items). */
export function getAvailableItems(): ShopItem[] {
  const now = Date.now();
  const seasonal = SEASONAL_ITEMS.filter(i =>
    i.seasonal && now >= i.seasonal.availableFrom && now <= i.seasonal.availableUntil
  );
  return [...SHOP_ITEMS, ...seasonal];
}

// ─── Ownership & Equipped State ──────────────────────────────────────────────

export interface ShopState {
  owned: string[];              // item IDs the user owns — permanent, never removed
  equipped: Record<ShopCategory, string | null>; // one equipped per category
  customTextColor?: string;     // hex color if text_custom_color is equipped
  pfpBindings?: Record<string, string[]>; // nftMint → array of PFP-category item IDs bound to that NFT
}

/** Purchase disclaimer shown before first purchase. */
export const PURCHASE_DISCLAIMER = [
  "• All purchases are permanent and yours forever",
  "• You can switch between owned items anytime at no extra cost",
  "• PFP-linked cosmetics (aura, pulse frame, color theme) are tied to the NFT equipped when purchased",
  "• Changing your PFP deactivates PFP-linked items; switching back reactivates them",
  "• Non-PFP cosmetics (bubble glow, text style, themes) carry over regardless of PFP changes",
  "• SOL payment is non-refundable",
].join("\n");

const DEFAULT_SHOP_STATE: ShopState = {
  owned: [],
  equipped: { bubble: null, text: null, pfp: null, theme: null },
};

export async function loadShopState(): Promise<ShopState> {
  try {
    const raw = await AsyncStorage.getItem(AK_SHOP);
    if (!raw) return { ...DEFAULT_SHOP_STATE };
    return { ...DEFAULT_SHOP_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SHOP_STATE };
  }
}

export async function saveShopState(state: ShopState): Promise<void> {
  await AsyncStorage.setItem(AK_SHOP, JSON.stringify(state));
}

/** Mark an item as owned after successful purchase. */
export async function addOwnedItem(itemId: string): Promise<ShopState> {
  const state = await loadShopState();
  if (!state.owned.includes(itemId)) {
    state.owned.push(itemId);
  }
  await saveShopState(state);
  return state;
}

/** Equip an owned item (one per category). */
export async function equipItem(itemId: string): Promise<ShopState> {
  const state = await loadShopState();
  if (!state.owned.includes(itemId)) return state; // must own it
  const item = [...SHOP_ITEMS, ...SEASONAL_ITEMS].find(i => i.id === itemId);
  if (!item) return state;
  state.equipped[item.category] = itemId;
  await saveShopState(state);
  return state;
}

/** Unequip item in a category. */
export async function unequipCategory(category: ShopCategory): Promise<ShopState> {
  const state = await loadShopState();
  state.equipped[category] = null;
  await saveShopState(state);
  return state;
}

/** Get the style overrides for currently equipped items. */
export async function getEquippedStyles(): Promise<Record<string, any>> {
  const state = await loadShopState();
  const allItems = [...SHOP_ITEMS, ...SEASONAL_ITEMS];
  const styles: Record<string, any> = {};

  // Anyone who has purchased any item gets the banana badge next to their name
  if (state.owned.length > 0) styles.isShopCustomer = true;

  for (const category of ["bubble", "text", "pfp", "theme"] as ShopCategory[]) {
    const equippedId = state.equipped[category];
    if (!equippedId) continue;
    const item = allItems.find(i => i.id === equippedId);
    if (!item) continue;
    Object.assign(styles, item.style);
    // Flag: user has a bubble cosmetic equipped → premium bubble shape
    if (category === "bubble") styles.hasBubbleCosmetic = true;
  }

  if (state.customTextColor) {
    styles.customTextColorValue = state.customTextColor;
  }

  return styles;
}

/** Get tier label and color. */
export function getTierInfo(tier: number): { label: string; color: string } {
  switch (tier) {
    case 1: return { label: "TIER 1", color: "#6CB4EE" };
    case 2: return { label: "TIER 2", color: "#9945FF" };
    case 3: return { label: "TIER 3", color: "#FFD54F" };
    case 4: return { label: "TIER 4", color: "#FF6B6B" };
    default: return { label: "TIER ?", color: "#888" };
  }
}

/** Get category display name. */
export function getCategoryName(cat: ShopCategory): string {
  switch (cat) {
    case "bubble": return "Chat Bubbles";
    case "text": return "Text & Names";
    case "pfp": return "PFP Styles";
    case "theme": return "App Themes";
  }
}
