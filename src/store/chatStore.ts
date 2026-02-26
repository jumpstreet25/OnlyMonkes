import { create } from 'zustand';
import type { ChatMessage } from '../types';

interface ChatState {
  messages: ChatMessage[];
  replyingTo: ChatMessage | null;
  isLoadingHistory: boolean;
}

interface ChatActions {
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  /** Dedup-safe insert: replaces a matching optimistic bubble instead of duplicating. */
  mergeMessage: (message: ChatMessage) => void;
  /** Own-message variant: upgrades opt-* in-place but NEVER appends. Prevents own-message duplicates from heartbeat sync. */
  upgradeOwnMessage: (message: ChatMessage) => void;
  updateMessageStatus: (id: string, status: 'sending' | 'sent' | 'failed') => void;
  applyReactionUpdate: (messages: ChatMessage[]) => void;
  setReplyingTo: (message: ChatMessage | null) => void;
  setLoadingHistory: (loading: boolean) => void;
  reset: () => void;
}

const initialState: ChatState = {
  messages: [],
  replyingTo: null,
  isLoadingHistory: false,
};

export const useChatStore = create<ChatState & ChatActions>((set) => ({
  ...initialState,

  setMessages: (messages) => set({ messages }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  mergeMessage: (message) =>
    set((state) => {
      // 1. Exact ID already in store → skip
      if (state.messages.some((m) => m.id === message.id)) return state;

      // 2. Matching optimistic (opt-*) by sender + content → upgrade in-place,
      //    preserving the optimistic's senderNft so the PFP stays visible.
      const optIdx = state.messages.findIndex(
        (m) =>
          m.id.startsWith('opt-') &&
          m.senderAddress === message.senderAddress &&
          m.content === message.content
      );
      if (optIdx !== -1) {
        const opt = state.messages[optIdx];
        const upgraded: ChatMessage = {
          ...message,
          senderNft: opt.senderNft ?? message.senderNft,
          status: 'sent',
        };
        const next = [...state.messages];
        next[optIdx] = upgraded;
        return { messages: next };
      }

      // 3. Genuinely new message → append
      return { messages: [...state.messages, message] };
    }),

  upgradeOwnMessage: (message) =>
    set((state) => {
      // Already in store with this real ID → skip
      if (state.messages.some((m) => m.id === message.id)) return state;
      // Find the matching opt-* bubble
      const optIdx = state.messages.findIndex(
        (m) =>
          m.id.startsWith('opt-') &&
          m.senderAddress === message.senderAddress &&
          m.content === message.content
      );
      // No opt-* match → do NOT append own messages (they are only added via handleSend)
      if (optIdx === -1) return state;
      const opt = state.messages[optIdx];
      const upgraded: ChatMessage = {
        ...message,
        senderNft: opt.senderNft ?? message.senderNft,
        status: 'sent',
      };
      const next = [...state.messages];
      next[optIdx] = upgraded;
      return { messages: next };
    }),

  updateMessageStatus: (id, status) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, status } : m)),
    })),

  applyReactionUpdate: (messages) => set({ messages }),

  setReplyingTo: (replyingTo) => set({ replyingTo }),

  setLoadingHistory: (isLoadingHistory) => set({ isLoadingHistory }),

  reset: () => set(initialState),
}));
