import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ClosedTrade, OpenTrade } from '@/lib/positions';
import type { ParsedPortfolioCard, ParsedPortfolioResponse } from '@/lib/xmtp';

const AK_CLOSED_TRADES = 'om_closed_trades_v1';
const AK_OPEN_TRADES = 'om_open_trades_v1';
const MAX_TRADES = 200;
const MAX_OPEN = 50;

/** Live portfolio card — refreshed on every /portfolio response from the bot.
 *  Distinct from openTrades: openTrades come from push events (TRADE_OPENED:),
 *  portfolioCards come from on-demand snapshots when user DMs /portfolio.
 *  Auto-pruned after PORTFOLIO_CARD_TTL_MS to avoid stale displays. */
export type PortfolioCard = ParsedPortfolioCard;
const PORTFOLIO_CARD_TTL_MS = 60 * 60 * 1000; // 1h
const MAX_PORTFOLIO_CARDS = 30;

/** Latest /portfolio response — single composite snapshot. Replaces the
 *  previous portfolioCards[] array (which fragmented the UI into separate
 *  bubbles). The new flow renders one composite bubble from this object. */
export type PortfolioResponse = ParsedPortfolioResponse;

interface TradesState {
  closedTrades: ClosedTrade[];
  openTrades: OpenTrade[];
  /** @deprecated 2026-05-08 — replaced by portfolioResponse. Kept briefly
   *  for any in-flight bot messages still using PORTFOLIO_CARD: format. */
  portfolioCards: PortfolioCard[];
  /** Latest /portfolio response, null if user hasn't requested one. */
  portfolioResponse: PortfolioResponse | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addClosedTrade: (trade: ClosedTrade) => void;
  /** Add a new active position. If one with the same id already exists, replaced (idempotent). */
  addOpenTrade: (trade: OpenTrade) => void;
  /** Remove an active position by positionId or mint when its TRADE_CLOSED counterpart arrives. */
  removeOpenTrade: (idOrMint: string) => void;
  addPortfolioCard: (card: PortfolioCard) => void;
  /** Replace the latest /portfolio response. Triggered on every PORTFOLIO_RESPONSE: DM. */
  setPortfolioResponse: (response: PortfolioResponse) => void;
  getRecentTrades: (limit?: number) => ClosedTrade[];
  getOpenTrades: () => OpenTrade[];
}

export const useTradesStore = create<TradesState>((set, get) => ({
  closedTrades: [],
  openTrades: [],
  portfolioCards: [],
  portfolioResponse: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const [closedRaw, openRaw] = await Promise.all([
        AsyncStorage.getItem(AK_CLOSED_TRADES),
        AsyncStorage.getItem(AK_OPEN_TRADES),
      ]);
      const closed = closedRaw ? (JSON.parse(closedRaw) as ClosedTrade[]) : [];
      const open = openRaw ? (JSON.parse(openRaw) as OpenTrade[]) : [];
      set({ closedTrades: closed, openTrades: open, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  addClosedTrade: (trade) => {
    const next = [trade, ...get().closedTrades].slice(0, MAX_TRADES);
    // Auto-prune the matching open position (by mint) if present — the bot
    // restarts could orphan opens that never get a close DM, so this keeps
    // the list honest. Match by mint since positionId isn't carried on close.
    const nextOpens = get().openTrades.filter((p) => p.mint !== trade.mint);
    set({ closedTrades: next, openTrades: nextOpens });
    AsyncStorage.setItem(AK_CLOSED_TRADES, JSON.stringify(next)).catch(() => {});
    AsyncStorage.setItem(AK_OPEN_TRADES, JSON.stringify(nextOpens)).catch(() => {});
  },

  addOpenTrade: (trade) => {
    const filtered = get().openTrades.filter((p) => p.id !== trade.id);
    const next = [trade, ...filtered].slice(0, MAX_OPEN);
    set({ openTrades: next });
    AsyncStorage.setItem(AK_OPEN_TRADES, JSON.stringify(next)).catch(() => {});
  },

  removeOpenTrade: (idOrMint) => {
    const next = get().openTrades.filter((p) => p.id !== idOrMint && p.mint !== idOrMint);
    if (next.length === get().openTrades.length) return;
    set({ openTrades: next });
    AsyncStorage.setItem(AK_OPEN_TRADES, JSON.stringify(next)).catch(() => {});
  },

  setPortfolioResponse: (response) => {
    set({ portfolioResponse: response });
  },

  addPortfolioCard: (card) => {
    const cutoff = Date.now() - PORTFOLIO_CARD_TTL_MS;
    // Replace existing card for same positionId, prune old, cap at MAX
    const filtered = get().portfolioCards.filter(
      (c) => c.positionId !== card.positionId && c.ts >= cutoff,
    );
    const next = [card, ...filtered].slice(0, MAX_PORTFOLIO_CARDS);
    set({ portfolioCards: next });
    // Not persisted — these are transient snapshots; users get fresh ones each /portfolio
  },

  getRecentTrades: (limit = 50) => get().closedTrades.slice(0, limit),
  getOpenTrades: () => get().openTrades,
}));
