import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  SHOP_ITEMS, isBananasOnly,
  KIT_DISCOUNT, LOOT_ITEMS, addOwnedItem, equipItem, findShopItem, getAvailableItems, getEquippedStyles, getWorldKits, kitPrice,
} from "@/lib/bananaShop";
import { parseSeasonalItems } from "@/lib/shopSeasonal";

const seasonal = (over: Record<string, unknown> = {}) => ({
  id: "seasonal_test_drop", name: "Test", description: "x", category: "bubble", tier: 2, bananaCost: 50, usdCost: 2, preview: "❄️",
  style: { glowColor: "#E8F7FF", glowRadius: 22 },
  seasonal: { name: "Test", from: "2026-12-01", until: "2027-01-05" },
  ...over,
});

describe("Banana Shop kits and fixes", () => {
  beforeEach(() => AsyncStorage.clear());

  it("has a kit for every World: the World, a bubble and a name color", () => {
    const kits = getWorldKits();
    expect(kits).toHaveLength(6);
    for (const k of kits) {
      expect(k.pieces.map((p) => p.category).sort()).toEqual(["bubble", "text", "world"]);
      expect(k.pieces.filter((p) => p.kit).every((p) => p.kit === k.world.id)).toBe(true);
    }
  });

  it("prices a kit at a discount on what's still unowned, and full price for a single missing piece", () => {
    const { world, pieces } = getWorldKits()[0];
    const full = kitPrice(pieces, []);
    expect(full.toBuy).toHaveLength(3);
    expect(full.usd).toBeCloseTo(4.99 * (1 - KIT_DISCOUNT), 2);
    expect(full.bananas).toBe(Math.round((750 + 40 + 50) * (1 - KIT_DISCOUNT)));
    const last = kitPrice(pieces, [world.id, pieces[1].id]);
    expect(last.toBuy).toHaveLength(1);
    expect(last.usd).toBe(0);
    expect(last.bananas).toBe(pieces[2].bananaCost);
    expect(kitPrice(pieces, pieces.map((p) => p.id)).toBuy).toHaveLength(0);
  });

  it("the Banana Chest's legendary prize exists, isn't for sale, and can be worn", async () => {
    const holo = findShopItem("bubble_holographic_loot");
    expect(holo).toBe(LOOT_ITEMS[0]);
    expect(getAvailableItems().some((i) => i.id === holo!.id)).toBe(false);
    await addOwnedItem(holo!.id);
    const state = await equipItem(holo!.id);
    expect(state.equipped.bubble).toBe(holo!.id);
    expect((await getEquippedStyles()).glowColor).toBe(holo!.style.glowColor);
  });

  it("accepts a valid seasonal drop and rejects unsafe ones", () => {
    expect(parseSeasonalItems({ items: [seasonal()] })).toHaveLength(1);
    expect(parseSeasonalItems({ items: [seasonal({ id: "bubble_neon_blue" })] })).toHaveLength(0);
    expect(parseSeasonalItems({ items: [seasonal({ category: "world" })] })).toHaveLength(0);
    expect(parseSeasonalItems({ items: [seasonal({ style: { glowColor: "url(javascript:x)" } })] })).toHaveLength(0);
    expect(parseSeasonalItems({ items: [seasonal({ style: { worldId: "world_deep_space" } })] })).toHaveLength(0);
    expect(parseSeasonalItems({ items: [seasonal({ usdCost: 50 })] })).toHaveLength(0);
    expect(parseSeasonalItems({ items: [seasonal({ seasonal: { name: "x", from: "2027-01-05", until: "2026-12-01" } })] })).toHaveLength(0);
  });

  it("ships Monke Winter in the bundled seasonal list, for sale only Dec 1 – Jan 5", () => {
    const winter = findShopItem("seasonal_monke_winter_2026");
    expect(winter?.seasonal?.availableFrom).toBe(Date.parse("2026-12-01"));
    const spy = jest.spyOn(Date, "now");
    spy.mockReturnValue(Date.parse("2026-11-15"));
    expect(getAvailableItems().some((i) => i.id === winter!.id)).toBe(false);
    spy.mockReturnValue(Date.parse("2026-12-20"));
    expect(getAvailableItems().some((i) => i.id === winter!.id)).toBe(true);
    spy.mockRestore();
  });

  it("sells 6 glow bubbles; the 5 hidden ones stay wearable for owners", async () => {
    const forSale = getAvailableItems().filter((i) => i.category === "bubble" && !i.kit && !i.seasonal);
    expect(forSale.map((i) => i.id)).toEqual(["bubble_neon_blue", "bubble_neon_pink", "bubble_gold_glow", "bubble_frosted", "bubble_dark_ember", "bubble_phantom"]);
    const hidden = SHOP_ITEMS.filter((i) => i.retired).map((i) => i.id);
    expect(hidden).toHaveLength(5);
    await addOwnedItem("bubble_sunset");
    expect((await equipItem("bubble_sunset")).equipped.bubble).toBe("bubble_sunset");
    expect((await getEquippedStyles()).glowColor).toBe(findShopItem("bubble_sunset")!.style.glowColor);
  });

  it("tiers 1-2 are bananas only; PFP, themes and Worlds still take a wallet payment", () => {
    for (const i of SHOP_ITEMS) expect(isBananasOnly(i)).toBe(i.tier <= 2);
    expect(isBananasOnly(findShopItem("seasonal_monke_winter_2026")!)).toBe(true);
  });
});
