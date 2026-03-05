import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { getXmtpClient } from '@/hooks/useXmtp';
import { openOrCreateDm, loadDmMessages, sendDmMessage, decodeMessage } from '@/lib/xmtp';
import type { ChatMessage } from '@/types';

let _activeDm: any = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[useDm] ${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export function useDm(peerInboxId: string) {
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [sending, setSending]     = useState(false);
  const { myInboxId }             = useAppStore();
  const retryTimer                = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubscribeStream         = useRef<(() => void) | null>(null);

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

        await withTimeout(client.conversations.sync(), 10_000, 'conversations.sync');
        if (cancelled) return;

        _activeDm = await withTimeout(
          openOrCreateDm(client, peerInboxId),
          15_000,
          'findOrCreateDm'
        );
        if (cancelled) return;

        const history = await withTimeout(
          loadDmMessages(_activeDm, myInboxId),
          10_000,
          'loadDmMessages'
        );
        if (cancelled) return;

        setMessages(history);
        setLoading(false);

        const stopStream = await _activeDm.streamMessages(
          async (raw: any) => {
            if (cancelled) return;
            const msg = decodeMessage(raw, myInboxId);
            if (msg) setMessages(prev => [...prev, msg]);
          }
        );
        unsubscribeStream.current = typeof stopStream === 'function' ? stopStream : null;
      } catch (e: any) {
        if (!cancelled) {
          console.warn('[useDm] init error:', e?.message ?? e);
          setError(e?.message ?? 'Failed to open DM — check connection');
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      unsubscribeStream.current?.();
      unsubscribeStream.current = null;
      _activeDm = null;
    };
  }, [peerInboxId, myInboxId]);

  const send = useCallback(async (text: string) => {
    if (!_activeDm || !text.trim()) return;
    setSending(true);
    const { username } = useAppStore.getState();
    try {
      await sendDmMessage(_activeDm, text, username);
      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        content: text,
        senderAddress: myInboxId ?? '',
        senderUsername: useAppStore.getState().username ?? '',
        senderNft: null,
        sentAt: new Date(),
        reactions: {},
        replyTo: null,
      };
      setMessages(prev => [...prev, optimistic]);
    } finally {
      setSending(false);
    }
  }, [myInboxId]);

  return { messages, loading, error, sending, send };
}
