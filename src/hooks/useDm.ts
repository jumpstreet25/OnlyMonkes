import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { getXmtpClient } from '@/hooks/useXmtp';
import { openOrCreateDm, loadDmMessages, sendDmMessage, decodeMessage } from '@/lib/xmtp';
import type { ChatMessage } from '@/types';

let _activeDm: any = null;

export function useDm(peerInboxId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const { myInboxId }           = useAppStore();

  useEffect(() => {
    let cancel: (() => void) | null = null;
    (async () => {
      const client = getXmtpClient();
      if (!client || !myInboxId) { setLoading(false); return; }
      _activeDm = await openOrCreateDm(client, peerInboxId);
      const history = await loadDmMessages(_activeDm, myInboxId);
      setMessages(history);
      setLoading(false);
      // Stream new incoming messages
      const stream = await _activeDm.streamMessages();
      (async () => {
        for await (const raw of stream) {
          const msg = decodeMessage(raw, myInboxId);
          if (msg) setMessages(prev => [...prev, msg]);
        }
      })();
      cancel = () => stream.return?.();
    })();
    return () => { cancel?.(); _activeDm = null; };
  }, [peerInboxId, myInboxId]);

  const send = useCallback(async (text: string) => {
    if (!_activeDm || !text.trim()) return;
    setSending(true);
    const { username } = useAppStore.getState();
    try { await sendDmMessage(_activeDm, text, username); }
    finally { setSending(false); }
  }, []);

  return { messages, loading, sending, send };
}
