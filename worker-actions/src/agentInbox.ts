/**
 * Inbound relay from the owner's Grok agents to MonkeBrain (2026-10-28).
 *
 * Grok reads the owner's mail and does its own Gmail triage (trash junk, label the rest —
 * recoverable; never send, reply or delete for good). It passes MonkeBrain only short,
 * filtered summaries: POST /api/agent-relay/inbound with `Authorization: Bearer
 * GROK_INBOUND_KEY`. The bot reads them back with BOT_HTTP_SECRET (GET, same path).
 *
 * Mail is untrusted input. Summaries are stored as data, never instructions: text only,
 * capped, links / addresses / inbox IDs / emails stripped, fixed categories. Nothing here
 * triggers an action — anything that would post, send, trade or spend waits for the
 * owner's wallet-signed approval.
 */
import { scrubPrivate } from "./agentBridge";

export const INBOX_KV_KEY = "agent:inbox:v1";
export const MAX_ITEMS_PER_POST = 10;
export const MAX_STORED = 100;
export const SUMMARY_MAX = 280;
export const KEEP_MS = 7 * 86_400_000;

export const CATEGORIES = ["security", "billing", "infra", "partnership", "community", "market", "other"] as const;
export type InboxCategory = (typeof CATEGORIES)[number];

export interface InboxItem {
  id: string;
  category: InboxCategory;
  summary: string;
  urgent: boolean;
  receivedAt: string | null;
  storedAt: string;
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
// Control chars and zero-width / bidi marks that can hide text from a reader.
const HIDDEN_RE = /[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g;

/** Pure: one cleaned summary, or null when there's nothing usable. */
export function cleanSummary(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.replace(HIDDEN_RE, " ").replace(URL_RE, "[link]").replace(EMAIL_RE, "[email]");
  s = String(scrubPrivate(s)).replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s;
}

/** Pure: validates a POST body into stored items. Unknown fields are ignored. */
export function parseInbound(body: unknown, now = Date.now()): { items: InboxItem[]; rejected: number } {
  const list = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) return { items: [], rejected: 0 };
  const items: InboxItem[] = [];
  let rejected = Math.max(0, list.length - MAX_ITEMS_PER_POST);
  for (const raw of list.slice(0, MAX_ITEMS_PER_POST)) {
    const r = raw as { category?: unknown; summary?: unknown; urgent?: unknown; receivedAt?: unknown } | null;
    const summary = cleanSummary(r?.summary);
    if (!summary) { rejected++; continue; }
    const category = (CATEGORIES as readonly string[]).includes(String(r?.category)) ? (r!.category as InboxCategory) : "other";
    const t = typeof r?.receivedAt === "string" ? Date.parse(r.receivedAt) : NaN;
    items.push({
      id: `${now.toString(36)}-${items.length}`,
      category,
      summary,
      urgent: r?.urgent === true,
      receivedAt: Number.isFinite(t) ? new Date(t).toISOString() : null,
      storedAt: new Date(now).toISOString(),
    });
  }
  return { items, rejected };
}

/** Pure: newest first, older than KEEP_MS dropped, capped at MAX_STORED. */
export function mergeInbox(existing: InboxItem[], incoming: InboxItem[], now = Date.now()): InboxItem[] {
  return [...incoming, ...existing]
    .filter((i) => now - Date.parse(i.storedAt) < KEEP_MS)
    .slice(0, MAX_STORED);
}

interface KV { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> }

export async function readInbox(kv: KV): Promise<InboxItem[]> {
  try {
    const v = JSON.parse((await kv.get(INBOX_KV_KEY)) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function storeInbound(kv: KV, items: InboxItem[], now = Date.now()): Promise<number> {
  if (!items.length) return 0;
  await kv.put(INBOX_KV_KEY, JSON.stringify(mergeInbox(await readInbox(kv), items, now)));
  return items.length;
}

/** Pure: items stored after `since` (ISO), optionally one category. */
export function filterInbox(items: InboxItem[], since: string | null, category: string | null): InboxItem[] {
  const t = since ? Date.parse(since) : NaN;
  return items.filter((i) => (!Number.isFinite(t) || Date.parse(i.storedAt) > t) && (!category || i.category === category));
}
