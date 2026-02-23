/**
 * useXmtp
 *
 * Initializes an XMTP v5 client (random identity, persisted in SecureStore),
 * loads global group chat history, and subscribes to incoming messages.
 *
 * Uses module-level singletons for group/client so that send/react/reply
 * work correctly regardless of which component calls the hook — the group
 * reference is always the one set during initialize().
 */

import { useCallback } from "react";
import {
  initXmtpClient,
  getOrCreateGlobalChat,
  decodeMessage,
  applyReaction,
  sendMessage,
  sendReply,
  sendReaction,
} from "@/lib/xmtp";
import { useAppStore } from "@/store/appStore";
import { useChatStore } from "@/store/chatStore";
import { showLocalNotification, detectMention } from "@/lib/notifications";
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { XmtpClient, XmtpGroup } from "@/lib/xmtp";

// ─── Module-level singleton ────────────────────────────────────────────────────
// Shared across ALL calls to useXmtp() — fixes "Not connected" when hooks are
// called from different components (e.g. initialize in VerifyScreen, react in ChatScreen).

let _group: XmtpGroup | null = null;
let _client: XmtpClient | null = null;
let _unsubscribeStream: (() => void) | null = null;
let _myInboxId = "";

export function useXmtp() {
  const { setXmtpClient, setMyInboxId, setLoading, setError } = useAppStore();
  const { setMessages, addMessage, applyReactionUpdate, setLoadingHistory } =
    useChatStore();

  const initialize = useCallback(async () => {
    console.log("[XMTP] initialize() called");
    setLoading(true);
    setError(null);

    try {
      const client = await initXmtpClient();
      console.log("[XMTP] client created:", client.inboxId);
      _client = client;
      setXmtpClient(client as unknown as null);
      setMyInboxId(client.inboxId);
      _myInboxId = client.inboxId;

      const group = await getOrCreateGlobalChat(client);
      _group = group;

      setLoadingHistory(true);
      await (group as any).sync();
      const rawHistory: any[] = await (group as any).messages({ limit: 100 });

      const decoded = rawHistory
        .map((m) => decodeMessage(m, _myInboxId))
        .filter(Boolean) as ChatMessage[];

      let enriched = decoded;
      for (const raw of rawHistory) {
        try {
          const content = raw.content();
          if (typeof content === "string" && content.startsWith("REACT:")) {
            enriched = applyReaction(enriched, raw, _myInboxId);
          }
        } catch {
          // skip
        }
      }

      setMessages(enriched.reverse()); // oldest-first
      setLoadingHistory(false);

      // Tear down any previous subscription before creating a new one
      _unsubscribeStream?.();

      const unsub = await (group as any).streamMessages(async (raw: any) => {
        let content: string;
        try {
          content = raw.content();
        } catch {
          return;
        }

        if (typeof content === "string" && content.startsWith("REACT:")) {
          const { messages } = useChatStore.getState();
          const updated = applyReaction(messages, raw, _myInboxId);
          applyReactionUpdate(updated);
          return;
        }

        const msg = decodeMessage(raw, _myInboxId);
        if (!msg) return;

        addMessage(msg);

        // ── Foreground notifications ─────────────────────────────────────
        if (msg.senderAddress === _myInboxId) return; // skip own messages

        const { notificationsEnabled, mentionsOnly, username } =
          useAppStore.getState();

        if (!notificationsEnabled) return;

        const isMention = detectMention(msg.content, username ?? "");

        if (mentionsOnly && !isMention) return;

        const senderLabel = msg.senderUsername ?? msg.senderAddress.slice(0, 6);
        const title = isMention
          ? `${senderLabel} mentioned you 🍌`
          : `${senderLabel} in OnlyMonkes`;

        await showLocalNotification(title, msg.content);
      });

      _unsubscribeStream = unsub;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "XMTP initialization failed";
      console.error("[XMTP] initialize() failed:", message, err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [
    setXmtpClient,
    setMyInboxId,
    setLoading,
    setError,
    setMessages,
    addMessage,
    applyReactionUpdate,
    setLoadingHistory,
  ]);

  const disconnect = useCallback(() => {
    _unsubscribeStream?.();
    _unsubscribeStream = null;
  }, []);

  const send = useCallback(async (content: string) => {
    if (!_group) await initialize();
    if (!_group) throw new Error("Not connected to chat");
    const { username } = useAppStore.getState();
    await sendMessage(_group, content, username);
  }, [initialize]);

  const reply = useCallback(async (target: ChatMessage, content: string) => {
    if (!_group) await initialize();
    if (!_group) throw new Error("Not connected to chat");
    const { username } = useAppStore.getState();
    await sendReply(_group, target, content, username);
  }, [initialize]);

  const react = useCallback(
    async (emoji: ReactionEmoji, targetMessageId: string) => {
      if (!_group) {
        console.log("[XMTP] react() _group null — calling initialize() first");
        await initialize();
      }
      if (!_group) throw new Error("Not connected to chat");
      await sendReaction(_group, emoji, targetMessageId);
    },
    [initialize]
  );

  return { initialize, disconnect, send, reply, react };
}
