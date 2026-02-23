/**
 * useGroupChat
 *
 * Generic hook for connecting to any XMTP group chat.
 * Used by dApp side chats (Alchemy Merch, etc.).
 * Manages its own local message state independently of the global chatStore.
 */

import { useCallback, useRef, useState } from "react";
import {
  initXmtpClient,
  getOrCreateDAppGroup,
  decodeMessage,
  applyReaction,
  sendMessage,
  sendReply,
  sendReaction,
} from "@/lib/xmtp";
import { useAppStore } from "@/store/appStore";
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { XmtpClient, XmtpGroup } from "@/lib/xmtp";

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

  const initialize = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const client = await initXmtpClient();
      clientRef.current = client;
      setMyInboxId(client.inboxId);
      myInboxIdRef.current = client.inboxId;

      const group = await getOrCreateDAppGroup(client, groupId, groupName);
      groupRef.current = group;

      setIsLoadingHistory(true);
      await (group as any).sync();
      const rawHistory: any[] = await (group as any).messages({ limit: 100 });

      const decoded = rawHistory
        .map((m) => decodeMessage(m, client.inboxId))
        .filter(Boolean) as ChatMessage[];

      let enriched = decoded;
      for (const raw of rawHistory) {
        try {
          const content = raw.content();
          if (typeof content === "string" && content.startsWith("REACT:")) {
            enriched = applyReaction(enriched, raw, client.inboxId);
          }
        } catch {
          // skip
        }
      }

      setMessages(enriched.reverse());
      setIsLoadingHistory(false);

      const unsub = await (group as any).streamMessages(async (raw: any) => {
        let content: string;
        try {
          content = raw.content();
        } catch {
          return;
        }

        if (typeof content === "string" && content.startsWith("REACT:")) {
          setMessages((prev) => applyReaction(prev, raw, myInboxIdRef.current));
          return;
        }

        const msg = decodeMessage(raw, myInboxIdRef.current);
        if (msg) setMessages((prev) => [...prev, msg]);
      });

      unsubscribeRef.current = unsub;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat initialization failed");
    } finally {
      setIsLoading(false);
    }
  }, [groupId, groupName, setMyInboxId]);

  const disconnect = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

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
