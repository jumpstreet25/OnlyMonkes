/**
 * Token-2022 transfer-hook detection (2026-10-06).
 *
 * A transfer hook is a program Solana runs on every transfer of a token; it
 * can refuse the transfer, which can mean a buyer can't sell. Hooked
 * (hookedpad.com) launches every token with one. We read the mint on-chain
 * (authoritative — a graduated Hooked token has its hook removed and shows
 * none) and name the rule from the hook program.
 *
 * Program → rule map verified on-chain against all 859 Hooked launches on
 * 2026-10-06. Programs shared by several rules carry the strictest exit
 * class among them. Exit classes match the bot's lib/hooked/hookedRules.ts.
 */
import { SOLANA_RPC_URL } from "./constants";
import { fetchWithTimeout } from "./fetchWithTimeout";

export type HookExit = "free" | "capped" | "blocked" | "route" | "app" | "changeable" | "unknown";

export interface TransferHookInfo {
  programId: string;
  rule: string;
  exit: HookExit;
  hooked: boolean;
}

const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const HOOKED_PROGRAMS: Record<string, { rule: string; exit: HookExit }> = {
  "4Tabcoy1niosiNAGHMruLBFscgJWXZsVF3pfij3FqMB5": { rule: "FOMO-only buys", exit: "free" },
  "9eQyvzp3hfghBhA4VUECLZzyZswmFGcne1rfs9QN3CnL": { rule: "Custom / AI-written rules", exit: "changeable" },
  "DMohCzuYMQUsmYAiitgtYtSpsBtyEw9UWZha7EGqTv8M": { rule: "Social trading (FOMO / Pump app only)", exit: "app" },
  "C3vEdPepTPRrJdQ4nQ3ZmhdXCmpKdGRKVUqxduHZWbdR": { rule: "Combined rules", exit: "unknown" },
  "4GsxAQV9NeDh4J9HX4dWRfNFacxiqHKRf6RxGJoLuK8n": { rule: "Max per wallet", exit: "free" },
  "BXax2KXrnT7qRf7cva9cLJpqDGXWywsw4ucLwtGiTa28": { rule: "Pump App only buys", exit: "free" },
  "3uxoNzXjn6hKxuFqi5sZjnSoFauSXjnq6i9vWPJf99Zs": { rule: "Tithe / Allowlist / Venue-locked", exit: "route" },
  "Ft8R4BsJp7n3dGKsd1RbAi3WrvkiH5s5z2jyDztEQJ6f": { rule: "Anti-dump caps", exit: "capped" },
  "CndZxZoVjv2RC9RX7DGfQzQru9a1kfAsEfUVVM37diGF": { rule: "Lock & earn", exit: "free" },
  "63VLLdKEZVjwKN4Y6CqeeFkLGzMoSZxFAXsfiLwnKKkD": { rule: "King of the Hill", exit: "free" },
  "BCiJ49rbFS7Lw6QfbxweBQ5a4RVsif12kHBnx4QHBUxM": { rule: "Reactive pair", exit: "free" },
  "EZet2oSoussVujse5U8W4T2NZsTuJ1rZBqQ8J188iJKk": { rule: "Market hours", exit: "blocked" },
  "7zxho6cRXcazb97vA9RSdWQ6dUvUHPe9koTRsn5WfmQr": { rule: "Anti-bundle", exit: "free" },
  "2JwcGx9cUK1UyTsztkRAnCeAPgbJXkwCqSP9ghkPi3Md": { rule: "Pegs", exit: "route" },
  "CapP1YJk8Rh4d17szh45zXHy8vSMbZoNXfzm6zvNTgz7": { rule: "Hot potato", exit: "blocked" },
  "BUwCiwrRfVgNKEhHryBb626oKCRqNfm5hhkebrXKG6iY": { rule: "Trading hours", exit: "blocked" },
  "8uDCgT4KrMNsX6nJzqCFtLansP9AJef4deWWBk4nG9VA": { rule: "Sliding caps", exit: "capped" },
  "9Am6KfHqhi3vYmZKpE2kRJxmbNvwggujNzqqSaqdor2Z": { rule: "Graduated sell caps", exit: "capped" },
  "8h3iUcxwcCb2YJW99HbTmPohhitPsE94dHDuEAhwBJ7U": { rule: "Entangled / Beacon", exit: "blocked" },
  "AFQCJz9Q7TXgJe86MqrCLR1LjPL2W1zmjA4NidmgbJnn": { rule: "Chapters", exit: "free" },
  "VqzxRoumJqbx99dQeWDoRC5XL48r5ZZYANwCgpuWVPW": { rule: "OpenSea only", exit: "app" },
  "3MYbfUJVKsKnyYJ2QSXdgchoeW8hc7fqMBBuc51pDHuo": { rule: "Holder vesting", exit: "blocked" },
  "3MNVGyhzq5iLN2ZAnkSnBdwqEomtdQ9vt7qS6nheauok": { rule: "Buyer rewards", exit: "route" },
  "2WsdXUpABzpXbiPcKrDYypdgzr2EybGorWFHBDXYtSGx": { rule: "Holder-gated", exit: "route" },
  "Bf7ecqFieSoacTNbangY4trvnU7bVig6na1RMr6G84dk": { rule: "Ping Pong", exit: "blocked" },
  "C7Whr2PbMHGAt8J7gpvRVfmUqhW9nBk17qBbZDmdnFmk": { rule: "Breathing / Momentum cap", exit: "free" },
  "BPVEVJfsDvPQ4A8oRntVudUAJyaUvFuSJVk5tidKz7Fp": { rule: "Sniper-fee cap", exit: "free" },
  "4FYZUzNqHxLRLs8bhoQf71yRW8i2jPxJxLZJFcqB9Xom": { rule: "DEX-only", exit: "free" },
  "8zw1psRFN541E1A3uzxB3uBXjUj3dVtkLHS3Ad99dFqP": { rule: "Blocklist", exit: "free" },
  "6AH1GVkqUdYCrbse28TcFSLyYTSiYqQVneaxvSBTSyp3": { rule: "Rising max per wallet", exit: "free" },
  "D92gP881Q8q1LhvKCbUiyz5vn86DyiNZ9S2z2V9v8gAr": { rule: "Trade guard", exit: "capped" },
};

export const HOOK_EXIT_TEXT: Record<HookExit, string> = {
  free: "Sells always allowed — the rule only limits buys or holdings.",
  capped: "Sells are size-capped — a big bag has to exit in pieces.",
  blocked: "Sells can be refused (time lock, hours or turn-taking).",
  route: "Only tradeable through Hooked — Jupiter can't sell it.",
  app: "Only tradeable inside one app — you may not be able to sell here.",
  changeable: "The rules can be rewritten after you buy.",
  unknown: "Custom rules — they may block selling.",
};

export function hookExitSeverity(exit: HookExit): "info" | "warn" | "danger" {
  if (exit === "free") return "info";
  if (exit === "capped") return "warn";
  return "danger";
}

const CACHE_MS = 5 * 60_000;
const _cache = new Map<string, { at: number; info: TransferHookInfo | null }>();

/** The mint's active transfer hook, or null (no hook, plain SPL token, or hook removed). Throws on RPC failure. */
export async function fetchTransferHook(mint: string): Promise<TransferHookInfo | null> {
  const hit = _cache.get(mint);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.info;
  const res = await fetchWithTimeout(SOLANA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [mint, { encoding: "jsonParsed" }] }),
    timeoutMs: 8000,
  });
  if (!res.ok) throw new Error(`getAccountInfo HTTP ${res.status}`);
  const json = await res.json();
  const acc = json?.result?.value;
  let info: TransferHookInfo | null = null;
  if (acc?.owner === TOKEN_2022_PROGRAM) {
    const exts: Array<{ extension?: string; state?: { programId?: string | null } }> =
      acc?.data?.parsed?.info?.extensions ?? [];
    const programId = exts.find((e) => e.extension === "transferHook")?.state?.programId;
    if (typeof programId === "string" && programId) {
      const known = HOOKED_PROGRAMS[programId];
      info = known
        ? { programId, rule: known.rule, exit: known.exit, hooked: true }
        : { programId, rule: "Unknown transfer hook", exit: "unknown", hooked: false };
    }
  }
  _cache.set(mint, { at: Date.now(), info });
  return info;
}
