/**
 * AI Agent #9385 command catalog (2026-10-06).
 *
 * One list — config/bot-commands.json — drives the "/" suggestions in
 * ChatInput, the scrolling BotCommandTicker and the bot's own /help, so they
 * can't drift apart again (they had: dead /whale /dca /globe entries, and
 * ~25 real commands missing). The JSON is bundled as a fallback and
 * refreshed from master via raw.githubusercontent.com, so adding a command
 * to that file reaches every phone without an OTA.
 */
import { useEffect, useState } from "react";
import bundled from "../../config/bot-commands.json";

export type CommandScope = "chat" | "dm";

export interface BotCommand {
  cmd: string;
  args?: string;
  group: string;
  where: CommandScope[];
  admin?: boolean;
  ticker?: boolean;
  desc: { en: string; es?: string };
}

const RAW = "https://raw.githubusercontent.com/jumpstreet25/OnlyMonkes/master/config/bot-commands.json";
const TTL_MS = 30 * 60 * 1000;

function isCommand(x: unknown): x is BotCommand {
  const c = x as Partial<BotCommand>;
  return !!c && typeof c.cmd === "string" && typeof c.group === "string"
    && Array.isArray(c.where) && c.where.every((w) => w === "chat" || w === "dm")
    && !!c.desc && typeof c.desc.en === "string";
}

export function parseBotCommands(json: unknown): BotCommand[] | null {
  const list = (json as { commands?: unknown[] } | null)?.commands;
  if (!Array.isArray(list)) return null;
  const valid = list.filter(isCommand);
  return valid.length > 0 ? valid : null;
}

const BUNDLED: BotCommand[] = parseBotCommands(bundled) ?? [];
let _commands: BotCommand[] = BUNDLED;
let _fetchedAt = 0;
let _inflight: Promise<BotCommand[]> | null = null;
const _listeners = new Set<(c: BotCommand[]) => void>();

export function refreshBotCommands(): Promise<BotCommand[]> {
  if (Date.now() - _fetchedAt < TTL_MS) return Promise.resolve(_commands);
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(`${RAW}?t=${Date.now()}`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const parsed = parseBotCommands(await res.json());
        if (parsed) {
          _commands = parsed;
          _listeners.forEach((l) => l(parsed));
        }
      }
    } catch {
      // keep the bundled / last-good list
    } finally {
      _fetchedAt = Date.now();
      _inflight = null;
    }
    return _commands;
  })();
  return _inflight;
}

/** Commands for a context. Admin-only entries appear only when `isAdmin`. */
export function commandsFor(all: BotCommand[], scope: CommandScope, isAdmin: boolean): BotCommand[] {
  return all.filter((c) => c.where.includes(scope) && (!c.admin || isAdmin));
}

/** Slash suggestions for what the user has typed so far (only real "/" commands). */
export function slashSuggestions(all: BotCommand[], text: string, scope: CommandScope, isAdmin: boolean): BotCommand[] {
  if (!text.startsWith("/")) return [];
  const query = text.slice(1).toLowerCase();
  return commandsFor(all, scope, isAdmin).filter(
    (c) => c.cmd.startsWith("/") && c.cmd.slice(1).toLowerCase().startsWith(query),
  );
}

export function commandDesc(c: BotCommand, language: string | undefined): string {
  return language?.startsWith("es") && c.desc.es ? c.desc.es : c.desc.en;
}

/** Current catalog; re-renders when a fresher copy arrives from master. */
export function useBotCommands(): BotCommand[] {
  const [commands, setCommands] = useState(_commands);
  useEffect(() => {
    _listeners.add(setCommands);
    void refreshBotCommands();
    return () => { _listeners.delete(setCommands); };
  }, []);
  return commands;
}
