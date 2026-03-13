import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { getXmtpClient } from '@/hooks/useXmtp';
import { openOrCreateDm, loadDmMessages, sendDmMessage, decodeMessage } from '@/lib/xmtp';
import { getCachedProfile } from '@/lib/userProfile';
import type { ChatMessage } from '@/types';

async function relayDmPush(
  recipientToken: string,
  senderUsername: string,
  preview: string,
  senderAvatarUrl?: string | null,
): Promise<void> {
  try {
    const body: Record<string, unknown> = {
      to: recipientToken,
      title: `💬 ${senderUsername}`,
      body: preview.slice(0, 80),
      sound: 'default',
      channelId: 'om_all_v8',
      data: { type: 'dm', sender: senderUsername, avatarUrl: senderAvatarUrl ?? null },
    };
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { /* non-critical — DM still sent even if push fails */ }
}

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
    let syncInterval: ReturnType<typeof setInterval> | null = null;

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

        // Periodic sync every 10s to pick up bot replies that arrive between syncs
        syncInterval = setInterval(async () => {
          if (cancelled || !_activeDm) return;
          try {
            const refreshed = await loadDmMessages(_activeDm, myInboxId);
            if (!cancelled) setMessages(refreshed);
          } catch { /* non-fatal */ }
        }, 10_000);

        const stopStream = await _activeDm.streamMessages(
          async (raw: any) => {
            if (cancelled) return;
            const msg = decodeMessage(raw, myInboxId);
            if (msg) setMessages(prev => {
              // Replace matching optimistic message with the real one to avoid duplicates
              const optimisticIdx = prev.findIndex(
                m => m.id.startsWith('optimistic-') &&
                     m.content === msg.content &&
                     m.senderAddress === msg.senderAddress
              );
              if (optimisticIdx !== -1) {
                const next = [...prev];
                next[optimisticIdx] = msg;
                return next;
              }
              return [...prev, msg];
            });
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
      if (syncInterval) clearInterval(syncInterval);
      unsubscribeStream.current?.();
      unsubscribeStream.current = null;
      _activeDm = null;
    };
  }, [peerInboxId, myInboxId]);

  const send = useCallback(async (text: string) => {
    if (!_activeDm || !text.trim()) return;
    setSending(true);
    const { username, verifiedNft, dmNotificationsEnabled } = useAppStore.getState();
    try {
      await sendDmMessage(_activeDm, text, username);
      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        content: text,
        senderAddress: myInboxId ?? '',
        senderUsername: username ?? '',
        senderNft: null,
        sentAt: new Date(),
        reactions: {},
        replyTo: null,
      };
      setMessages(prev => [...prev, optimistic]);

      // Relay push to recipient via Expo Push API (requires ExponentPushToken)
      if (dmNotificationsEnabled) {
        const peer = getCachedProfile(peerInboxId);
        const peerExpoToken = peer?.expoPushToken;
        if (peerExpoToken && peerExpoToken.startsWith('ExponentPushToken')) {
          void relayDmPush(
            peerExpoToken,
            username ?? 'Monke',
            text,
            verifiedNft?.image ?? null,
          );
        }
      }
    } finally {
      setSending(false);
    }
  }, [myInboxId, peerInboxId]);

  return { messages, loading, error, sending, send };
}
