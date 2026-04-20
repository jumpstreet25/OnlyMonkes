/**
 * Live Features Slice — live rooms, video calls, avatar rooms, NFT swaps
 *
 * Logical slice of the main appStore. Use in new code for narrow subscriptions.
 */
import { useAppStore, type LiveRoomState } from './appStore';
import type { VideoRoomData } from '../lib/liveVideo';
import type { AvatarRoomData } from '../lib/avatarRoom';
import type { NftSwapMessage } from '../lib/marketplace';

// ── State ────────────────────────────────────────────────────────────────────

export interface LiveFeaturesState {
  activeLiveRoom: LiveRoomState | null;
  isInLiveRoom: boolean;
  liveRoomMuted: boolean;
  liveRoomToken: string | null;
  activeVideoRoom: VideoRoomData | null;
  isInVideoCall: boolean;
  activeAvatarRoom: AvatarRoomData | null;
  isInAvatarRoom: boolean;
  avatarRoomToken: string | null;
  pendingNftSwap: NftSwapMessage | null;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export interface LiveFeaturesActions {
  setActiveLiveRoom: (room: LiveRoomState | null) => void;
  updateLiveRoomCount: (count: number) => void;
  setIsInLiveRoom: (val: boolean) => void;
  setLiveRoomMuted: (val: boolean) => void;
  setLiveRoomToken: (token: string | null) => void;
  setActiveVideoRoom: (room: VideoRoomData | null) => void;
  setIsInVideoCall: (val: boolean) => void;
  setActiveAvatarRoom: (room: AvatarRoomData | null) => void;
  setIsInAvatarRoom: (val: boolean) => void;
  setAvatarRoomToken: (token: string | null) => void;
  setPendingNftSwap: (swap: NftSwapMessage | null) => void;
}

// ── Focused hook ─────────────────────────────────────────────────────────────

/** Narrowly-scoped hook — only subscribes to live-features-related state. */
export function useLiveFeaturesStore<T>(selector: (s: LiveFeaturesState & LiveFeaturesActions) => T): T {
  return useAppStore((state) => selector(state as unknown as LiveFeaturesState & LiveFeaturesActions));
}

/** Non-React access. */
useLiveFeaturesStore.getState = (): LiveFeaturesState & LiveFeaturesActions => {
  return useAppStore.getState() as unknown as LiveFeaturesState & LiveFeaturesActions;
};
