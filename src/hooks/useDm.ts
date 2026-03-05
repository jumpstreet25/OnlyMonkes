import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { getXmtpClient } from '@/hooks/useXmtp';
import { openOrCreateDm, loadDmMessages, sendDmMessage, decodeMessage } from '@/lib/xmtp';
import type { ChatMessage } from '@/types';

let _activeDm: any = null;

export function useDm(peerInboxId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [sending, setSending]   = useState(false);
  const { myInboxId }           = useAppStore();
  const retryTimer              = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubscribeStream       = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const client = getXmtpClient();
      if (!client || !myInboxId) {
        // Client not ready yet — retry in 500ms
        retryTimer.current = setTimeout(() => { if (!cancelled) init(); }, 500);
        return;
      }

      try {
        setError(null);
        // Sync conversations first so the DM is discoverable
        await client.conversations.sync();
        if (cancelled) return;

        _activeDm = await openOrCreateDm(client, peerInboxId);
        if (cancelled) return;

        const history = await loadDmMessages(_activeDm, myInboxId);
        if (cancelled) return;

        setMessages(history);
        setLoading(false);

        // streamMessages takes a callback — returns a cleanup function
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
          console.warn('[useDm] init error:', e);
          setError(e?.message ?? 'Failed to load DM');
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
      // Optimistic local append
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
