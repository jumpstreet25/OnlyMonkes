/**
 * Signed HTTP fallback for AutonoMonke / portfolio when bot DMs are dead.
 *
 * Auth message shape MUST match worker-actions/src/botCommand.ts:
 *   `OnlyMonkes BotCommand\n${wallet}\n${ts}\n${command}`
 * Allowlist lockstep: Monke_Eliza/.../botHttpCommand.ts
 *
 * Never call from a background/automatic path — each call is a real MWA
 * sign prompt. Only after a DM send fails, or the user taps an explicit action
 * while bot DMs are known-broken.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { signBytesWithMwa } from "@/hooks/useMobileWallet";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { useAppStore } from "@/store/appStore";
import { useTradesStore } from "@/store/tradesStore";
import { parseAutomonkeStatus, parsePortfolioResponse } from "./xmtp";
import { isAllowedBotCommand } from "./botCommandAllowlist";

export { isAllowedBotCommand };

const ACTIONS_BASE = "https://onlymonkes-actions.jumpstreet25.workers.dev";
const BROKEN_KEY = "bot_dm_broken_v1";

export async function markBotDmBroken(): Promise<void> {
  await AsyncStorage.setItem(BROKEN_KEY, "1").catch(() => {});
}

export async function clearBotDmBroken(): Promise<void> {
  await AsyncStorage.removeItem(BROKEN_KEY).catch(() => {});
}

export async function isBotDmBroken(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(BROKEN_KEY)) === "1";
  } catch {
    return false;
  }
}

// 2026-09-13: dm.send() into an MLS-inactive 1:1 resolves normally (no
// throw) — confirmed live, the client shows "delivered" while the bot's
// stream never yields the message. A thrown exception can't be relied on
// to detect this failure class, so callers race a reply timeout instead.
// In-memory only (no need to persist across app restarts) and shared
// across both the per-DM stream (useDm.ts, owns the conversation while
// mounted) and the global stream (useXmtp.ts, catches replies while the
// user is on any other screen) — same dual-wiring pattern this codebase
// already uses for every other bot-reply prefix handler.
let _lastBotActivityTs = 0;

export function noteBotActivity(): void {
  _lastBotActivityTs = Date.now();
}

export function getLastBotActivityTs(): number {
  return _lastBotActivityTs;
}

export interface BotCommandHttpResult {
  reply: string;
  automonkeStatus: { enrolled: boolean; active: boolean; limitOrdersEnabled: boolean } | null;
}

export async function postBotCommand(command: string): Promise<BotCommandHttpResult> {
  const wallet = useAppStore.getState().wallet?.address;
  if (!wallet) throw new Error("No wallet connected.");
  if (!isAllowedBotCommand(command)) throw new Error("That command needs a working bot DM.");

  const ts = Date.now();
  const message = new TextEncoder().encode(`OnlyMonkes BotCommand\n${wallet}\n${ts}\n${command}`);
  const sigBytes = await signBytesWithMwa(wallet, message);
  const signature = Buffer.from(sigBytes).toString("base64");

  const res = await fetchWithTimeout(`${ACTIONS_BASE}/api/bot-command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, ts, signature, command }),
    timeoutMs: 25000,
  });
  const json = await res.json().catch(() => ({})) as {
    error?: string;
    reply?: string;
    automonkeStatus?: BotCommandHttpResult["automonkeStatus"];
  };
  if (!res.ok) {
    throw new Error(json.error ?? `Bot command failed (${res.status})`);
  }
  return {
    reply: typeof json.reply === "string" ? json.reply : "",
    automonkeStatus: json.automonkeStatus ?? null,
  };
}

export function applyBotCommandResult(result: BotCommandHttpResult): void {
  if (result.automonkeStatus) {
    useAppStore.getState().setAutomonkeStatus(result.automonkeStatus);
    AsyncStorage.setItem("automonke_enrolled", result.automonkeStatus.enrolled ? "1" : "0").catch(() => {});
    AsyncStorage.setItem(
      "autonomonke_limit_orders_v1",
      result.automonkeStatus.limitOrdersEnabled ? "1" : "0",
    ).catch(() => {});
  }
  if (result.reply.startsWith("PORTFOLIO_RESPONSE:")) {
    const parsed = parsePortfolioResponse(result.reply);
    if (parsed) useTradesStore.getState().setPortfolioResponse(parsed);
  }
  if (result.reply.startsWith("AUTOMONKE_STATUS:")) {
    const parsed = parseAutomonkeStatus(result.reply);
    if (parsed) useAppStore.getState().setAutomonkeStatus(parsed);
  }
}

export function isInactiveMlsError(err: unknown): boolean {
  return /group is inactive|conversation is inactive/i.test((err as Error)?.message ?? "");
}

export async function postInboxReset(inboxId: string, generation: number): Promise<void> {
  const wallet = useAppStore.getState().wallet?.address;
  if (!wallet) throw new Error("No wallet connected.");
  const ts = Date.now();
  const extra = `${inboxId}\n${generation}`;
  const message = new TextEncoder().encode(`OnlyMonkes InboxReset\n${wallet}\n${ts}\n${extra}`);
  const sigBytes = await signBytesWithMwa(wallet, message);
  const signature = Buffer.from(sigBytes).toString("base64");
  const res = await fetchWithTimeout(`${ACTIONS_BASE}/api/inbox-reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, ts, signature, inboxId, generation }),
    timeoutMs: 25000,
  });
  const json = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Inbox reset failed (${res.status})`);
}
