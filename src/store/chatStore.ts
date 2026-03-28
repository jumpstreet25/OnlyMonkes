import { create } from 'zustand';
import type { ChatMessage } from '../types';

export interface TypingUser {
  inboxId: string;
  username?: string;
}

interface ChatState {
  messages: ChatMessage[];
  /** O(1) ID lookup — kept in sync with messages array */
  _msgIdSet: Set<string>;
  replyingTo: ChatMessage | null;
  isLoadingHistory: boolean;
  typingUsers: TypingUser[];
}

interface ChatActions {
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  /** Dedup-safe insert: replaces a matching optimistic bubble instead of duplicating. */
  mergeMessage: (message: ChatMessage) => void;
  /** Own-message variant: upgrades opt-* in-place but NEVER appends. Prevents own-message duplicates from heartbeat sync. */
  upgradeOwnMessage: (message: ChatMessage) => void;
  updateMessageStatus: (id: string, status: 'sending' | 'sent' | 'failed' | 'pending') => void;
  updateMessageContent: (id: string, newContent: string) => void;
  applyReactionUpdate: (messages: ChatMessage[]) => void;
  setReplyingTo: (message: ChatMessage | null) => void;
  setLoadingHistory: (loading: boolean) => void;
  setTypingUser: (inboxId: string, username?: string) => void;
  clearTypingUser: (inboxId: string) => void;
  reset: () => void;
}

const initialState: ChatState = {
  messages: [],
  _msgIdSet: new Set(),
  replyingTo: null,
  isLoadingHistory: false,
  typingUsers: [],
};

export const useChatStore = create<ChatState & ChatActions>((set) => ({
  ...initialState,

  setMessages: (messages) => {
    const idSet = new Set(messages.map(m => m.id));
    set({ messages, _msgIdSet: idSet });
  },

  addMessage: (message) =>
    set((state) => {
      const _msgIdSet = new Set(state._msgIdSet);
      _msgIdSet.add(message.id);
      return { messages: [...state.messages, message], _msgIdSet };
    }),

  mergeMessage: (message) =>
    set((state) => {
      // 1. Exact ID already in store → skip (O(1) lookup)
      if (state._msgIdSet.has(message.id)) return state;

      // 2. Matching optimistic (opt-*) by sender + content + time proximity → upgrade in-place,
      //    preserving the optimistic's senderNft so the PFP stays visible.
      //    Time window (10s) ensures identical messages sent >10s apart are not deduped.
      const optIdx = state.messages.findIndex(
        (m) =>
          m.id.startsWith('opt-') &&
          m.senderAddress === message.senderAddress &&
          m.content === message.content &&
          Math.abs(m.sentAt.getTime() - message.sentAt.getTime()) < 10_000
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
        const _msgIdSet = new Set(state._msgIdSet);
        _msgIdSet.delete(opt.id);
        _msgIdSet.add(upgraded.id);
        return { messages: next, _msgIdSet };
      }

      // 3. Genuinely new message → append (cap at 300 for memory on 8GB devices)
      const _msgIdSet = new Set(state._msgIdSet);
      _msgIdSet.add(message.id);
      let next = [...state.messages, message];
      if (next.length > 300) {
        const removed = next.splice(0, next.length - 300);
        for (const r of removed) _msgIdSet.delete(r.id);
      }
      return { messages: next, _msgIdSet };
    }),

  upgradeOwnMessage: (message) =>
    set((state) => {
      // Already in store with this real ID → skip (O(1))
      if (state._msgIdSet.has(message.id)) return state;
      // Find the matching opt-* bubble (within 10s time window)
      const optIdx = state.messages.findIndex(
        (m) =>
          m.id.startsWith('opt-') &&
          m.senderAddress === message.senderAddress &&
          m.content === message.content &&
          Math.abs(m.sentAt.getTime() - message.sentAt.getTime()) < 10_000
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
      const _msgIdSet = new Set(state._msgIdSet);
      _msgIdSet.delete(opt.id);
      _msgIdSet.add(upgraded.id);
      return { messages: next, _msgIdSet };
    }),

  updateMessageStatus: (id, status) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, status } : m)),
    })),

  updateMessageContent: (id, newContent) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, editedContent: newContent, editedAt: new Date() } : m,
      ),
    })),

  applyReactionUpdate: (messages) => set({ messages }),

  setReplyingTo: (replyingTo) => set({ replyingTo }),

  setLoadingHistory: (isLoadingHistory) => set({ isLoadingHistory }),

  setTypingUser: (inboxId, username) =>
    set((state) => ({
      typingUsers: [
        ...state.typingUsers.filter((u) => u.inboxId !== inboxId),
        { inboxId, username },
      ],
    })),

  clearTypingUser: (inboxId) =>
    set((state) => ({
      typingUsers: state.typingUsers.filter((u) => u.inboxId !== inboxId),
    })),

  reset: () => set(initialState),
}));
