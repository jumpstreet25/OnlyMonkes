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

  updateMessageStatus: (id, status) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, status } : m)),
    })),

  applyReactionUpdate: (messages) => set({ messages }),

  setReplyingTo: (replyingTo) => set({ replyingTo }),

  setLoadingHistory: (isLoadingHistory) => set({ isLoadingHistory }),

  reset: () => set(initialState),
}));
