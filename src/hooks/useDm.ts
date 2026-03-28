import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { useAppStore } from '@/store/appStore';
import { getXmtpClient } from '@/hooks/useXmtp';
import { openOrCreateDm, loadDmMessages, sendDmMessage, sendTypingIndicator, sendReadReceipt, decodeMessage } from '@/lib/xmtp';
import { getCachedProfile } from '@/lib/userProfile';
import { markChannelRead } from '@/lib/messageCache';
import type { ChatMessage } from '@/types';

// Throttle own typing broadcasts in DMs (one signal per 2.5 s max)
let _lastDmTypingSent = 0;

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
  } catch { /* non-critical */ }
}

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
  const [peerTyping, setPeerTyping] = useState(false);
  const { myInboxId }             = useAppStore();
  const retryTimer                = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubscribeStream         = useRef<(() => void) | null>(null);
  const typingTimeout             = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dmRef                     = useRef<any>(null);
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

        await withTimeout(client.conversations.sync(), 10_000, 'conversations.sync');
        if (cancelled) return;

        const dm = await withTimeout(
          openOrCreateDm(client, peerInboxId),
          15_000,
          'findOrCreateDm'
        );
        if (cancelled) return;
        dmRef.current = dm;

        // Load history once
        const history = await withTimeout(
          loadDmMessages(dm, myInboxId),
          10_000,
          'loadDmMessages'
        );
        if (cancelled) return;

        // Track all seen IDs to prevent duplicates from stream
        seenIds.current = new Set(history.map(m => m.id));
        setMessages(history);
        setLoading(false);

        // Mark this DM as read + clear per-DM unread badge
        markChannelRead(`dm_${peerInboxId}`).catch(() => {});
        useAppStore.getState().clearDmUnread(peerInboxId);

        // Send read receipt for the newest peer message in history
        const newestPeerMsg = [...history].reverse().find(m => m.senderAddress !== myInboxId);
        if (newestPeerMsg) {
          sendReadReceipt(dm, newestPeerMsg.id).catch(() => {});
        }

        // Stream is the only source of new messages — no periodic sync
        const stopStream = await dm.streamMessages(
          async (raw: any) => {
            if (cancelled) return;

            // Detect typing signals from peer
            const rawContent = typeof raw.content === 'function' ? raw.content() : raw.content;
            if (typeof rawContent === 'string' && rawContent.startsWith('TYPING:')) {
              const typerId = rawContent.split(':')[1];
              if (typerId && typerId !== myInboxId) {
                setPeerTyping(true);
                if (typingTimeout.current) clearTimeout(typingTimeout.current);
                typingTimeout.current = setTimeout(() => setPeerTyping(false), 4000);
              }
              return;
            }

            // Detect read receipts from peer → mark own messages as read
            if (typeof rawContent === 'string' && rawContent.startsWith('READ:')) {
              const readUpToId = rawContent.slice(5);
              const sender = raw.senderInboxId ?? '';
              if (sender !== myInboxId && readUpToId) {
                setMessages(prev => {
                  let found = false;
                  // Mark all own messages up to (and including) the read ID
                  return prev.map(m => {
                    if (m.id === readUpToId) found = true;
                    if (m.senderAddress === myInboxId && m.status !== 'read') {
                      // Mark as read if we haven't passed the read-up-to point yet,
                      // or if this IS the read-up-to message, or it was sent before it
                      if (!found || m.id === readUpToId) return { ...m, status: 'read' as const };
                    }
                    return m;
                  });
                });
              }
              return;
            }

            const msg = decodeMessage(raw, myInboxId);
            if (!msg) return;

            // Peer sent a real message — clear typing indicator + send read receipt
            if (msg.senderAddress !== myInboxId) {
              setPeerTyping(false);
              // Auto-acknowledge: user is viewing this conversation
              sendReadReceipt(dm, msg.id).catch(() => {});
              markChannelRead(`dm_${peerInboxId}`).catch(() => {});
            }

            // Skip if we've already seen this message
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

              // Double-check dedup (race condition guard)
              if (prev.some(m => m.id === msg.id)) return prev;

              seenIds.current.add(msg.id);
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

    // On app foreground: do a single catch-up sync for messages missed while backgrounded
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active' && dmRef.current && !cancelled) {
        try {
          const refreshed = await loadDmMessages(dmRef.current, myInboxId!);
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
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      unsubscribeStream.current?.();
      unsubscribeStream.current = null;
      dmRef.current = null;
      seenIds.current.clear();
    };
  }, [peerInboxId, myInboxId]);

  const [sendError, setSendError] = useState<string | null>(null);

  const send = useCallback(async (text: string) => {
    if (!dmRef.current || !text.trim()) return;
    setSending(true);
    setSendError(null);
    const { username, verifiedNft, dmNotificationsEnabled } = useAppStore.getState();

    // Add optimistic message immediately so user sees it
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
      await sendDmMessage(dmRef.current, text, username);

      // Mark optimistic message as sent
      setMessages(prev =>
        prev.map(m => m.id === optimisticId ? { ...m, status: 'sent' } : m)
      );

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
    } catch (e: any) {
      console.warn('[useDm] send failed:', e?.message ?? e);
      setSendError('Message failed to send');
      // Mark optimistic message as failed
      setMessages(prev =>
        prev.map(m => m.id === optimisticId ? { ...m, status: 'failed' } : m)
      );
    } finally {
      setSending(false);
    }
  }, [myInboxId, peerInboxId]);

  const retry = useCallback(async (messageId: string) => {
    const msg = messages.find(m => m.id === messageId && m.status === 'failed');
    if (!msg || !dmRef.current) return;
    // Remove the failed message and re-send
    setMessages(prev => prev.filter(m => m.id !== messageId));
    await send(msg.content);
  }, [messages, send]);

  const sendTyping = useCallback(async () => {
    if (!dmRef.current) return;
    const now = Date.now();
    if (now - _lastDmTypingSent < 2500) return;
    _lastDmTypingSent = now;
    const { username, myInboxId: id } = useAppStore.getState();
    try {
      await sendTypingIndicator(dmRef.current, id ?? myInboxId ?? '', username);
    } catch { /* typing is best-effort */ }
  }, [myInboxId]);

  // Build typingUsers array for ChatInput compatibility
  const peerProfile = getCachedProfile(peerInboxId);
  const typingUsers = peerTyping
    ? [{ inboxId: peerInboxId, username: peerProfile?.username }]
    : [];

  return { messages, loading, error, sending, sendError, send, retry, sendTyping, typingUsers };
}
