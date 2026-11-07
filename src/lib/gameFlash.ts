/**
 * Short-lived DM highlights for the mini-chat over MonkeCaves: a fresh DM
 * (e.g. the bot's AutonoMonke trade note) shows for a few seconds, then goes.
 * Memory only — nothing is saved; the DM itself stays in the inbox as usual.
 */
import { create } from "zustand";

export interface GameFlash { id: string; title: string; body: string; image?: string | null }

const SHOW_MS = 6000;
const MAX = 3;

interface FlashState {
  flashes: GameFlash[];
  push: (f: Omit<GameFlash, "id">) => void;
  dismiss: (id: string) => void;
}

export const useGameFlash = create<FlashState>((set, get) => ({
  flashes: [],
  push: (f) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set({ flashes: [...get().flashes, { ...f, id }].slice(-MAX) });
    setTimeout(() => get().dismiss(id), SHOW_MS);
  },
  dismiss: (id) => set({ flashes: get().flashes.filter((x) => x.id !== id) }),
}));
