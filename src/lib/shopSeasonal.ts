/**
 * Banana Shop seasonal drops — config/shop-seasonal.json on master, read from
 * raw.githubusercontent.com (same pattern as botCommands.ts), with the bundled
 * copy as fallback. A new drop is a JSON edit, no OTA. Every item stays in the
 * list after its season so owners keep wearing it; only in-season items are for sale.
 *
 * The file is public and remote, so items are checked strictly: bubble/text only,
 * known style keys, colors and bounded numbers, capped prices.
 */
import bundled from "../../config/shop-seasonal.json";
import type { ShopItem } from "@/lib/bananaShop";

const RAW = "https://raw.githubusercontent.com/jumpstreet25/OnlyMonkes/master/config/shop-seasonal.json";
const TTL_MS = 30 * 60 * 1000;

const COLOR = /^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/;
const STYLE_KEYS: Record<"bubble" | "text", Record<string, "color" | "number" | "boolean" | "weight">> = {
  bubble: { bgColor: "color", borderColor: "color", glowColor: "color", glowOpacity: "number", glowRadius: "number", glassOpacity: "number" },
  text: { nameColor: "color", customTextColor: "boolean", textGlow: "boolean", fontWeight: "weight" },
};

function validStyle(category: "bubble" | "text", style: unknown): Record<string, string | number | boolean> | null {
  if (!style || typeof style !== "object") return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(style as Record<string, unknown>)) {
    const kind = STYLE_KEYS[category][k];
    if (kind === "color" && typeof v === "string" && COLOR.test(v)) out[k] = v;
    else if (kind === "number" && typeof v === "number" && v >= 0 && v <= 40) out[k] = v;
    else if (kind === "boolean" && typeof v === "boolean") out[k] = v;
    else if (kind === "weight" && (v === "600" || v === "700" || v === "bold")) out[k] = v;
    else return null;
  }
  return Object.keys(out).length ? out : null;
}

export function parseSeasonalItems(json: unknown): ShopItem[] {
  const list = (json as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(list)) return [];
  const items: ShopItem[] = [];
  for (const raw of list) {
    const x = raw as Record<string, any>;
    if (!x || typeof x.id !== "string" || !/^seasonal_[a-z0-9_]{3,40}$/.test(x.id)) continue;
    if (x.category !== "bubble" && x.category !== "text") continue;
    const style = validStyle(x.category, x.style);
    const from = Date.parse(x.seasonal?.from);
    const until = Date.parse(x.seasonal?.until);
    if (!style || !Number.isFinite(from) || !Number.isFinite(until) || until <= from) continue;
    const bananaCost = Number(x.bananaCost);
    const usdCost = Number(x.usdCost);
    if (!(bananaCost >= 0 && bananaCost <= 2000) || !(usdCost >= 0 && usdCost <= 4.99)) continue;
    items.push({
      id: x.id,
      name: String(x.name ?? "").slice(0, 40) || x.id,
      description: String(x.description ?? "").slice(0, 120),
      category: x.category,
      tier: x.tier === 1 ? 1 : 2,
      bananaCost,
      usdCost,
      preview: String(x.preview ?? "✨").slice(0, 4),
      style,
      seasonal: { name: String(x.seasonal?.name ?? "").slice(0, 40), availableFrom: from, availableUntil: until },
    });
  }
  return items;
}

let _items: ShopItem[] = parseSeasonalItems(bundled);
let _fetchedAt = 0;
let _inflight: Promise<ShopItem[]> | null = null;

/** Every seasonal item ever (owned ones keep drawing after their season). */
export function remoteSeasonalItems(): ShopItem[] {
  return _items;
}

export function refreshSeasonalItems(): Promise<ShopItem[]> {
  if (Date.now() - _fetchedAt < TTL_MS) return Promise.resolve(_items);
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(`${RAW}?t=${Date.now()}`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const parsed = parseSeasonalItems(await res.json());
        // Keep bundled items the remote copy dropped, so an owned item never stops drawing.
        const ids = new Set(parsed.map((i) => i.id));
        _items = [...parsed, ..._items.filter((i) => !ids.has(i.id))];
      }
    } catch {
      // keep the bundled / last-good list
    } finally {
      _fetchedAt = Date.now();
      _inflight = null;
    }
    return _items;
  })();
  return _inflight;
}
