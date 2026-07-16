/**
 * useGroupChat
 *
 * Generic hook for connecting to any XMTP group chat.
 * Used by dApp side chats (bot channels, etc.).
 * Manages its own local message state independently of the global chatStore.
 *
 * Messages are persisted to AsyncStorage via messageCache so they survive
 * app restarts. 24-hour auto-expiry for bot channels (except media/link messages).
 *
 * Module-level warm cache: if a channel was loaded recently (within WARM_TTL),
 * re-opening it skips the full XMTP sync and shows cached messages instantly,
 * then does a lightweight delta sync in the background.
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import {
  initXmtpClient,
  getOrCreateDAppGroup,
  decodeMessage,
  resolveReplyTargets,
  applyReaction,
  applyWithRetry,
  sendMessage,
  sendReply,
  sendReaction,
} from "@/lib/xmtp";
import { getXmtpClient } from "@/hooks/useXmtp";
import { useAppStore } from "@/store/appStore";
import {
  loadCachedMessages,
  saveCachedMessages,
  appendCachedMessage,
  markChannelRead,
} from "@/lib/messageCache";
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { XmtpClient, XmtpGroup } from "@/lib/xmtp";

// ── Module-level warm cache ─────────────────────────────────────────────────
// Keeps messages in memory so navigating back to a channel is instant.

const WARM_TTL = 60_000; // 60s — skip full reload if loaded within this window

interface WarmEntry {
  messages: ChatMessage[];
  loadedAt: number;
  group: XmtpGroup;
  client: XmtpClient;
  unsub: (() => void) | null;
}

const _warmCache = new Map<string, WarmEntry>();
const MAX_WARM_CACHE = 6; // Cap warm cache to prevent unbounded memory growth

/** Detect native ReactionCodec/V2 objects or legacy REACT: strings */
const isReactionContent = (content: unknown): boolean => {
  if (typeof content === "string") return content.startsWith("REACT:");
  if (content && typeof content === "object") return !!((content as any).reaction || (content as any).reactionV2);
  return false;
};

export function useGroupChat(groupId: string, groupName: string) {
  const { setMyInboxId } = useAppStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groupRef = useRef<XmtpGroup | null>(null);
  const clientRef = useRef<XmtpClient | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const myInboxIdRef = useRef<string>("");

  // Use groupName as the cache key (e.g. "bets", "trades", etc.)
  const cacheKey = groupName.toLowerCase().replace(/\s+/g, "_");

  // On mount: if warm cache exists, hydrate messages immediately (no loading state)
  useEffect(() => {
    const warm = _warmCache.get(groupId);
    if (warm && warm.messages.length > 0) {
      setMessages(warm.messages);
    }
  }, [groupId]);

  const initialize = useCallback(async () => {
    const warm = _warmCache.get(groupId);
    const isWarm = warm && (Date.now() - warm.loadedAt < WARM_TTL);

    if (isWarm) {
      // ── Warm path: show cached messages instantly, delta-sync in background ──
      setMessages(warm.messages);
      groupRef.current = warm.group;
      clientRef.current = warm.client;
      myInboxIdRef.current = warm.client.inboxId;
      setMyInboxId(warm.client.inboxId);

      // Mark as read
      markChannelRead(cacheKey).catch(() => {});

      // Background delta sync — pull only new messages since last load
      (async () => {
        try {
          await (warm.group as any).sync();
          const rawHistory: any[] = await (warm.group as any).messages({ limit: 50 });
          let decoded = rawHistory
            .map((m: any) => decodeMessage(m, warm.client.inboxId))
            .filter(Boolean) as ChatMessage[];
          decoded = resolveReplyTargets(decoded);

          let enriched = decoded;
          for (const raw of rawHistory) {
            try {
              const content = raw.content();
              if (isReactionContent(content)) {
                enriched = applyReaction(enriched, raw, warm.client.inboxId);
              }
            } catch { /* skip */ }
          }

          const freshMessages = enriched.reverse();
          const existingIds = new Set(warm.messages.map(m => m.id));
          const newMsgs = freshMessages.filter(m => !existingIds.has(m.id));

          if (newMsgs.length > 0) {
            setMessages(prev => {
              const merged = [...prev, ...newMsgs].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
              // Update warm cache
              const entry = _warmCache.get(groupId);
              if (entry) { entry.messages = merged; entry.loadedAt = Date.now(); }
              saveCachedMessages(cacheKey, merged).catch(() => {});
              return merged;
            });
          }
        } catch { /* non-critical */ }
      })();

      // Re-attach stream if not already streaming
      if (!warm.unsub) {
        try {
          const unsub = await (warm.group as any).streamMessages(async (raw: any) => {
            try {
              let content: unknown;
              try { content = raw.content(); } catch { return; }

              // Native or legacy reaction
              if (isReactionContent(content)) {
                applyWithRetry(m => applyReaction(m, raw, myInboxIdRef.current), setMessages);
                return;
              }

              const msg = decodeMessage(raw, myInboxIdRef.current);
              if (msg) {
                setMessages(prev => {
                  const updated = [...prev, msg];
                  const entry = _warmCache.get(groupId);
                  if (entry) entry.messages = updated;
                  return updated;
                });
                await appendCachedMessage(cacheKey, msg);
              }
            } catch (err) {
              if (__DEV__) console.warn("[useGroupChat] Stream handler error:", (err as Error).message);
            }
          });
          warm.unsub = unsub;
          unsubscribeRef.current = unsub;
        } catch { /* non-critical */ }
      } else {
        unsubscribeRef.current = warm.unsub;
      }

      return;
    }

    // ── Cold path: full load ──────────────────────────────────────────────────
    setIsLoading(true);
    setError(null);

    try {
      // 1. Load cached messages immediately so UI isn't empty
      const cached = await loadCachedMessages(cacheKey);
      if (cached.length > 0) {
        setMessages(cached);
      }

      // Reuse the singleton XMTP client if available; only create a new one as fallback
      const client = getXmtpClient() ?? await initXmtpClient();
      clientRef.current = client;
      setMyInboxId(client.inboxId);
      myInboxIdRef.current = client.inboxId;

      const group = await getOrCreateDAppGroup(client, groupId, groupName);
      groupRef.current = group;
      if (__DEV__) console.log(`[useGroupChat] ${groupName}: found group ${(group as any)?.id}, requested ${groupId}`);

      setIsLoadingHistory(true);
      await (group as any).sync();
      const rawHistory: any[] = await (group as any).messages({ limit: 500 });
      if (__DEV__) console.log(`[useGroupChat] ${groupName}: ${rawHistory.length} raw, decoding…`);
      // Debug: log raw content of first 5 messages
      for (const raw of rawHistory.slice(0, 5)) {
        try {
          const c = raw.content();
          const t = typeof c === "string" ? c.substring(0, 120) : JSON.stringify(c).substring(0, 120);
          if (__DEV__) console.log(`[useGroupChat] RAW: sender=${raw.senderInboxId?.slice(0,8)} content="${t}"`);
        } catch (e: any) { console.log(`[useGroupChat] RAW: content() threw: ${e.message}`); }
      }

      let decoded = rawHistory
        .map((m) => decodeMessage(m, client.inboxId))
        .filter(Boolean) as ChatMessage[];
      decoded = resolveReplyTargets(decoded);
      if (__DEV__) console.log(`[useGroupChat] ${groupName}: ${decoded.length} decoded messages`);

      let enriched = decoded;
      for (const raw of rawHistory) {
        try {
          const content = raw.content();
          if (isReactionContent(content)) {
            enriched = applyReaction(enriched, raw, client.inboxId);
          }
        } catch {
          // skip
        }
      }

      const freshMessages = enriched.reverse();

      // 2. Merge fresh XMTP messages with cache (dedup by ID)
      const freshIds = new Set(freshMessages.map((m) => m.id));
      const merged = [
        ...cached.filter((m) => !freshIds.has(m.id)),
        ...freshMessages,
      ].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

      if (__DEV__) console.log(`[useGroupChat] ${groupName}: setting ${merged.length} messages, sample id=${merged[0]?.id}`);
      setMessages(merged);
      setIsLoadingHistory(false);

      // 3. Persist merged messages
      await saveCachedMessages(cacheKey, merged);

      // 4. Mark channel as read now
      await markChannelRead(cacheKey);

      // 5. Stream new messages
      const unsub = await (group as any).streamMessages(async (raw: any) => {
        let content: unknown;
        try {
          content = raw.content();
        } catch {
          return;
        }

        // Native or legacy reaction
        if (isReactionContent(content)) {
          applyWithRetry(m => applyReaction(m, raw, myInboxIdRef.current), setMessages);
          return;
        }

        const msg = decodeMessage(raw, myInboxIdRef.current);
        if (msg) {
          setMessages((prev) => {
            const updated = [...prev, msg];
            const entry = _warmCache.get(groupId);
            if (entry) entry.messages = updated;
            return updated;
          });
          await appendCachedMessage(cacheKey, msg);
        }
      });

      unsubscribeRef.current = unsub;

      // 6. Store in warm cache (evict oldest if over cap)
      if (_warmCache.size >= MAX_WARM_CACHE) {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        for (const [key, entry] of _warmCache) {
          if (entry.loadedAt < oldestTime) { oldestTime = entry.loadedAt; oldestKey = key; }
        }
        if (oldestKey) {
          const evicted = _warmCache.get(oldestKey);
          if (evicted?.unsub) evicted.unsub(); // clean up the stream
          _warmCache.delete(oldestKey);
        }
      }
      _warmCache.set(groupId, {
        messages: merged,
        loadedAt: Date.now(),
        group,
        client,
        unsub,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat initialization failed");
    } finally {
      setIsLoading(false);
    }
  }, [groupId, groupName, cacheKey, setMyInboxId]);

  const disconnect = useCallback(() => {
    // Don't kill the stream — leave it alive in the warm cache
    // so re-opening the channel is instant.
    unsubscribeRef.current = null;
  }, []);

  // ── Foreground resync — Android suspends the WebSocket in background, so the
  // stream callback handle is alive but no events arrive until we re-attach.
  useEffect(() => {
    const handleAppState = async (nextState: AppStateStatus) => {
      if (nextState !== 'active') return;
      const group = groupRef.current;
      if (!group) return;
      try {
        await (group as any).sync();
        const TEN_HOURS_NS = 10 * 60 * 60 * 1_000_000_000;
        const afterNs = (Date.now() * 1_000_000) - TEN_HOURS_NS;
        const raw: any[] = await (group as any).messages({ afterNs });
        const decoded = raw
          .map((m) => decodeMessage(m, myInboxIdRef.current))
          .filter(Boolean) as ChatMessage[];

        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const additions = decoded.filter((m) => !ids.has(m.id)).reverse();
          if (additions.length === 0) return prev;
          const updated = [...prev, ...additions];
          const e = _warmCache.get(groupId);
          if (e) e.messages = updated;
          return updated;
        });

        const entry = _warmCache.get(groupId);
        try { entry?.unsub?.(); } catch { /* dead handle */ }
        try { unsubscribeRef.current?.(); } catch { /* dead handle */ }
        unsubscribeRef.current = null;
        if (entry) entry.unsub = null;

        const newUnsub = await (group as any).streamMessages(async (raw: any) => {
          try {
            let content: unknown;
            try { content = raw.content(); } catch { return; }
            if (isReactionContent(content)) {
              applyWithRetry(m => applyReaction(m, raw, myInboxIdRef.current), setMessages);
              return;
            }
            const msg = decodeMessage(raw, myInboxIdRef.current);
            if (msg) {
              setMessages((prev) => {
                const updated = [...prev, msg];
                const e = _warmCache.get(groupId);
                if (e) e.messages = updated;
                return updated;
              });
              await appendCachedMessage(cacheKey, msg);
            }
          } catch { /* ignore */ }
        });
        unsubscribeRef.current = newUnsub;
        if (entry) entry.unsub = newUnsub;
      } catch (err) {
        if (__DEV__) console.warn(`[useGroupChat] foreground resync failed:`, err);
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [groupId, cacheKey]);

  const send = useCallback(async (content: string) => {
    if (!groupRef.current) throw new Error("Not connected");
    const { username } = useAppStore.getState();
    await sendMessage(groupRef.current, content, username);
  }, []);

  const reply = useCallback(async (target: ChatMessage, content: string) => {
    if (!groupRef.current) throw new Error("Not connected");
    const { username } = useAppStore.getState();
    await sendReply(groupRef.current, target, content, username);
  }, []);

  const react = useCallback(async (emoji: ReactionEmoji, targetId: string) => {
    if (!groupRef.current) throw new Error("Not connected");
    await sendReaction(groupRef.current, emoji, targetId);
  }, []);

  const addMessageLocal = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateMessageStatus = useCallback(
    (id: string, status: "sending" | "sent" | "failed") => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status } : m))
      );
    },
    []
  );

  return {
    messages,
    isLoading,
    isLoadingHistory,
    error,
    initialize,
    disconnect,
    send,
    reply,
    react,
    addMessageLocal,
    updateMessageStatus,
  };
}
