import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ClosedTrade, OpenTrade } from '@/lib/positions';

const AK_CLOSED_TRADES = 'om_closed_trades_v1';
const AK_OPEN_TRADES = 'om_open_trades_v1';
const MAX_TRADES = 200;
const MAX_OPEN = 50;

interface TradesState {
  closedTrades: ClosedTrade[];
  openTrades: OpenTrade[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addClosedTrade: (trade: ClosedTrade) => void;
  /** Add a new active position. If one with the same id already exists, replaced (idempotent). */
  addOpenTrade: (trade: OpenTrade) => void;
  /** Remove an active position by positionId or mint when its TRADE_CLOSED counterpart arrives. */
  removeOpenTrade: (idOrMint: string) => void;
  getRecentTrades: (limit?: number) => ClosedTrade[];
  getOpenTrades: () => OpenTrade[];
}

export const useTradesStore = create<TradesState>((set, get) => ({
  closedTrades: [],
  openTrades: [],
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

  getRecentTrades: (limit = 50) => get().closedTrades.slice(0, limit),
  getOpenTrades: () => get().openTrades,
}));
