import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ClosedTrade } from '@/lib/positions';

const AK_CLOSED_TRADES = 'om_closed_trades_v1';
const MAX_TRADES = 200;

interface TradesState {
  closedTrades: ClosedTrade[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addClosedTrade: (trade: ClosedTrade) => void;
  getRecentTrades: (limit?: number) => ClosedTrade[];
}

export const useTradesStore = create<TradesState>((set, get) => ({
  closedTrades: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(AK_CLOSED_TRADES);
      const trades = raw ? (JSON.parse(raw) as ClosedTrade[]) : [];
      set({ closedTrades: trades, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  addClosedTrade: (trade) => {
    const next = [trade, ...get().closedTrades].slice(0, MAX_TRADES);
    set({ closedTrades: next });
    AsyncStorage.setItem(AK_CLOSED_TRADES, JSON.stringify(next)).catch(() => {});
  },

  getRecentTrades: (limit = 50) => get().closedTrades.slice(0, limit),
}));
