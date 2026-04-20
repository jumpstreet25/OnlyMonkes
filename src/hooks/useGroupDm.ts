import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { useAppStore } from '@/store/appStore';
import { getXmtpClient } from '@/hooks/useXmtp';
import { openGroupDm, loadDmMessages, sendDmMessage, sendTypingIndicator, decodeMessage } from '@/lib/xmtp';
import type { ChatMessage } from '@/types';

let _lastGroupDmTypingSent = 0;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[useGroupDm] ${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export function useGroupDm(groupId: string) {
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [sending, setSending]     = useState(false);
  const { myInboxId }             = useAppStore();
  const retryTimer                = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubscribeStream         = useRef<(() => void) | null>(null);
  const groupRef                  = useRef<any>(null);
  const seenIds                   = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const client = getXmtpClient();
      if (!client || !myInboxId) {
        retryTimer.current = setTimeout(() => { if (!cancelled) init(); }, 500);
        return;
      }

      try {
        setError(null);

        const group = await withTimeout(
          openGroupDm(client, groupId),
          15_000,
          'openGroupDm',
        );
        if (cancelled) return;
        groupRef.current = group;

        const history = await withTimeout(
          loadDmMessages(group, myInboxId),
          10_000,
          'loadDmMessages',
        );
        if (cancelled) return;

        seenIds.current = new Set(history.map(m => m.id));
        setMessages(history);
        setLoading(false);

        // Stream new messages
        const stopStream = await group.streamMessages(
          async (raw: any) => {
            if (cancelled) return;

            const rawContent = typeof raw.content === 'function' ? raw.content() : raw.content;
            if (typeof rawContent === 'string' && rawContent.startsWith('TYPING:')) return;
            if (typeof rawContent === 'string' && rawContent.startsWith('READ:')) return;
            if (typeof rawContent === 'string' && rawContent.startsWith('PRESENCE:')) return;

            const msg = decodeMessage(raw, myInboxId);
            if (!msg) return;
            if (seenIds.current.has(msg.id)) return;

            setMessages(prev => {
              // Replace matching optimistic message
              const optimisticIdx = prev.findIndex(
                m => m.id.startsWith('optimistic-') &&
                     m.content === msg.content &&
                     m.senderAddress === msg.senderAddress
              );
              if (optimisticIdx !== -1) {
                seenIds.current.add(msg.id);
                const next = [...prev];
                next[optimisticIdx] = msg;
                return next;
              }
              if (prev.some(m => m.id === msg.id)) return prev;
              seenIds.current.add(msg.id);
              return [...prev, msg];
            });
          }
        );
        unsubscribeStream.current = typeof stopStream === 'function' ? stopStream : null;
      } catch (e: any) {
        if (!cancelled) {
          console.warn('[useGroupDm] init error:', e?.message ?? e);
          setError(e?.message ?? 'Failed to open group DM');
          setLoading(false);
        }
      }
    }

    init();

    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active' && groupRef.current && !cancelled) {
        try {
          const refreshed = await loadDmMessages(groupRef.current, myInboxId!);
          if (cancelled) return;
          const newMsgs = refreshed.filter(m => !seenIds.current.has(m.id));
          if (newMsgs.length > 0) {
            for (const m of newMsgs) seenIds.current.add(m.id);
            setMessages(prev => [...prev, ...newMsgs]);
          }
        } catch { /* non-fatal */ }
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
      if (retryTimer.current) clearTimeout(retryTimer.current);
      unsubscribeStream.current?.();
      unsubscribeStream.current = null;
      groupRef.current = null;
      seenIds.current.clear();
    };
  }, [groupId, myInboxId]);

  const [sendError, setSendError] = useState<string | null>(null);

  const send = useCallback(async (text: string) => {
    if (!groupRef.current || !text.trim()) return;
    setSending(true);
    setSendError(null);
    const { username } = useAppStore.getState();

    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: optimisticId,
      content: text,
      senderAddress: myInboxId ?? '',
      senderUsername: username ?? '',
      senderNft: undefined,
      sentAt: new Date(),
      reactions: {},
      replyTo: undefined,
      status: 'sending',
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      await sendDmMessage(groupRef.current, text, username);
      setMessages(prev =>
        prev.map(m => m.id === optimisticId ? { ...m, status: 'sent' } : m)
      );
    } catch (e: any) {
      console.warn('[useGroupDm] send failed:', e?.message ?? e);
      setSendError('Message failed to send');
      setMessages(prev =>
        prev.map(m => m.id === optimisticId ? { ...m, status: 'failed' } : m)
      );
    } finally {
      setSending(false);
    }
  }, [myInboxId]);

  const sendTyping = useCallback(async () => {
    if (!groupRef.current) return;
    const now = Date.now();
    if (now - _lastGroupDmTypingSent < 2500) return;
    _lastGroupDmTypingSent = now;
    const { username, myInboxId: id } = useAppStore.getState();
    try {
      await sendTypingIndicator(groupRef.current, id ?? myInboxId ?? '', username);
    } catch { /* typing is best-effort */ }
  }, [myInboxId]);

  return { messages, loading, error, sending, sendError, send, sendTyping, typingUsers: [] };
}
