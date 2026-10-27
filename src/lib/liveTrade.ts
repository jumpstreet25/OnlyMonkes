/**
 * Live trade updates (3.1): the bot's data-only `om_live_trade` push (Monke_Eliza
 * lib/push/liveTrade.ts) → the pinned Android 16 progress notification (OmLiveUpdate,
 * LiveUpdateModule.kt). FCM data arrives as strings, so it's parsed and checked here.
 */
import { NativeModules, Platform } from "react-native";

export interface LiveTrade {
  id: string; sym: string; state: "open" | "closed";
  pnl: number; price: number; entry: number; stop: number; t1: number; t2: number;
  t1Hit: boolean; t2Hit: boolean;
}

const Live: { show(id: string, d: LiveTrade): void; close(id: string): void } | undefined =
  Platform.OS === "android" ? NativeModules.OmLiveUpdate : undefined;

/** Finds an om_live_trade payload however expo-notifications nested it. */
export function parseLiveTrade(payload: unknown, depth = 0): LiveTrade | null {
  if (!payload || typeof payload !== "object" || depth > 5) return null;
  const o = payload as Record<string, unknown>;
  if (o.type === "om_live_trade" && typeof o.id === "string") {
    const n = (k: string) => Number(o[k]);
    const b = (k: string) => o[k] === true || o[k] === "true";
    const t: LiveTrade = {
      id: o.id, sym: String(o.sym ?? "?"), state: o.state === "closed" ? "closed" : "open",
      pnl: n("pnl"), price: n("price"), entry: n("entry"), stop: n("stop"), t1: n("t1"), t2: n("t2"),
      t1Hit: b("t1Hit"), t2Hit: b("t2Hit"),
    };
    if (t.state === "open" && ![t.pnl, t.price, t.entry, t.t1, t.t2].every(Number.isFinite)) return null;
    return t;
  }
  for (const v of Object.values(o)) {
    const hit = parseLiveTrade(typeof v === "string" && v.startsWith("{") ? safeJson(v) : v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/** Shows / updates / clears the pinned notification. Returns false if it wasn't a live-trade push. */
export function handleLiveTradePush(payload: unknown): boolean {
  const t = parseLiveTrade(payload);
  if (!t) return false;
  if (!Live) return true;
  if (t.state === "closed") Live.close(t.id);
  else Live.show(t.id, t);
  return true;
}
