import { useChatStore } from '../store/chatStore';
import type { ChatMessage } from '../types';

const makeMsg = (id: string, content = 'hello', sender = 'user1'): ChatMessage => ({
  id,
  content,
  senderAddress: sender,
  senderUsername: sender,
  sentAt: new Date(),
  reactions: {},
  status: 'sent' as const,
});

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it('initializes empty', () => {
    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(0);
    expect(state._msgIdSet.size).toBe(0);
    expect(state.replyingTo).toBeNull();
  });

  it('setMessages rebuilds the ID set', () => {
    const msgs = [makeMsg('a'), makeMsg('b'), makeMsg('c')];
    useChatStore.getState().setMessages(msgs);
    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(3);
    expect(state._msgIdSet.size).toBe(3);
    expect(state._msgIdSet.has('b')).toBe(true);
  });

  it('addMessage appends and updates ID set', () => {
    useChatStore.getState().addMessage(makeMsg('m1'));
    useChatStore.getState().addMessage(makeMsg('m2'));
    expect(useChatStore.getState().messages).toHaveLength(2);
    expect(useChatStore.getState()._msgIdSet.has('m1')).toBe(true);
    expect(useChatStore.getState()._msgIdSet.has('m2')).toBe(true);
  });

  it('mergeMessage deduplicates by ID', () => {
    const msg = makeMsg('x1');
    useChatStore.getState().addMessage(msg);
    useChatStore.getState().mergeMessage(msg); // same ID → skip
    expect(useChatStore.getState().messages).toHaveLength(1);
  });

  it('mergeMessage upgrades optimistic messages in-place', () => {
    const optMsg = makeMsg('opt-123', 'test content', 'me');
    useChatStore.getState().addMessage(optMsg);

    const realMsg = makeMsg('real-456', 'test content', 'me');
    useChatStore.getState().mergeMessage(realMsg);

    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].id).toBe('real-456');
    expect(state._msgIdSet.has('opt-123')).toBe(false);
    expect(state._msgIdSet.has('real-456')).toBe(true);
  });

  it('upgradeOwnMessage only upgrades opt-* messages, never appends', () => {
    // No opt-* match → should NOT append
    const realMsg = makeMsg('real-1', 'hi', 'me');
    useChatStore.getState().upgradeOwnMessage(realMsg);
    expect(useChatStore.getState().messages).toHaveLength(0);

    // Add opt-* then upgrade
    useChatStore.getState().addMessage(makeMsg('opt-abc', 'hi', 'me'));
    useChatStore.getState().upgradeOwnMessage(makeMsg('real-abc', 'hi', 'me'));
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].id).toBe('real-abc');
  });

  it('updateMessageStatus changes status', () => {
    useChatStore.getState().addMessage(makeMsg('s1'));
    useChatStore.getState().updateMessageStatus('s1', 'failed');
    expect(useChatStore.getState().messages[0].status).toBe('failed');
  });

  it('manages typing users', () => {
    useChatStore.getState().setTypingUser('u1', 'Alice');
    useChatStore.getState().setTypingUser('u2', 'Bob');
    expect(useChatStore.getState().typingUsers).toHaveLength(2);

    useChatStore.getState().clearTypingUser('u1');
    expect(useChatStore.getState().typingUsers).toHaveLength(1);
    expect(useChatStore.getState().typingUsers[0].username).toBe('Bob');
  });
});
