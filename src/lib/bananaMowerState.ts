/**
 * bananaMowerState.ts — shared state channel between BananaGroveWorld
 * (which decides WHEN to trigger the mower) and the BananaMowerOverlay
 * component (which renders the mower above the chat content).
 *
 * The mower lives at the chat-screen overlay level so it renders ON TOP
 * of FlashList instead of behind it. WorldLayer is a background — anything
 * mounted inside it gets covered by chat messages. This split keeps the
 * banana pile in the background (correct) while letting the mower drive
 * across in the foreground (visible).
 *
 * `mowerIntakeXSV` is a module-level Reanimated SharedValue so the falling
 * pile bananas (rendered in the background world layer) can react to the
 * mower's intake X without prop-drilling through the React tree.
 */

import { create } from "zustand";
import { makeMutable, type SharedValue } from "react-native-reanimated";

const IDLE_X = -100_000;

export const mowerIntakeXSV: SharedValue<number> = makeMutable(IDLE_X);
export const MOWER_INTAKE_IDLE_X = IDLE_X;

interface MowerState {
  active: boolean;
  /** Increments each time a banana is sucked — drives the visible crate fill. */
  crateCount: number;
  /** Bottom offset for the mower's bottom edge (matches pile bottom). */
  pileBottomPx: number;
  /** User's NFT image URL/data URI to overlay on the seat. */
  pfpUri: string | null;
  /** Set by BananaPile when it triggers; called by Mower as bananas land. */
  onSucked: ((id: number) => void) | null;
  /** Set by BananaPile; called when the mower has driven off-screen right. */
  onComplete: (() => void) | null;
}

interface MowerActions {
  trigger: (params: {
    pileBottomPx: number;
    pfpUri: string | null;
    onSucked: (id: number) => void;
    onComplete: () => void;
  }) => void;
  bumpCrate: () => void;
  reset: () => void;
}

export const useMowerStore = create<MowerState & MowerActions>((set) => ({
  active: false,
  crateCount: 0,
  pileBottomPx: 0,
  pfpUri: null,
  onSucked: null,
  onComplete: null,
  trigger: ({ pileBottomPx, pfpUri, onSucked, onComplete }) =>
    set({
      active: true,
      crateCount: 0,
      pileBottomPx,
      pfpUri,
      onSucked,
      onComplete,
    }),
  bumpCrate: () => set((s) => ({ crateCount: s.crateCount + 1 })),
  reset: () =>
    set({
      active: false,
      crateCount: 0,
      onSucked: null,
      onComplete: null,
    }),
}));
