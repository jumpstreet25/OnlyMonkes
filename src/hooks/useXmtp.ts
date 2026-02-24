/**
 * useXmtp
 *
 * Initializes an XMTP v5 client (random identity, persisted in SecureStore),
 * loads global group chat history, and subscribes to incoming messages.
 *
 * Tester flow (10 testers):
 *   1. Admin runs first → creates XMTP group → publishes group ID + adminInboxId
 *      to GitHub (config/app-config.json) via the Admin Settings panel.
 *   2. Every tester fetches that config on init. If the group ID is set but the
 *      tester is not yet a member, the app auto-sends a JOIN_REQUEST DM to the
 *      admin (once per device) and shows a "waiting for approval" screen.
 *   3. Admin opens Admin Settings → "Join Requests" → taps "Add" for each tester.
 *   4. Tester hits "Retry" → now a member → chat opens.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback } from "react";
import {
  initXmtpClient,
  getOrCreateGlobalChat,
  addMemberToGroup,
  decodeMessage,
  applyReaction,
  sendMessage,
  sendReply,
  sendReaction,
  sendJoinRequestDM,
  fetchJoinRequests,
} from "@/lib/xmtp";
import {
  fetchAppConfig,
  publishAppConfig,
  saveAdminToken,
  getAdminToken,
} from "@/lib/remoteConfig";
import { useAppStore } from "@/store/appStore";
import { useChatStore } from "@/store/chatStore";
import { showLocalNotification, detectMention } from "@/lib/notifications";
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { XmtpClient, XmtpGroup } from "@/lib/xmtp";

// ─── Module-level singletons ──────────────────────────────────────────────────

let _group: XmtpGroup | null = null;
let _client: XmtpClient | null = null;
let _unsubscribeStream: (() => void) | null = null;
let _myInboxId = "";

const AK_JOIN_REQUEST_SENT = "xmtp_join_request_sent";

export function useXmtp() {
  const {
    setXmtpClient,
    setMyInboxId,
    setLoading,
    setError,
    setIsGroupMember,
    setIsGroupAdmin,
    setJoinRequests,
    setRemoteGroupId,
  } = useAppStore();
  const { setMessages, addMessage, applyReactionUpdate, setLoadingHistory } =
    useChatStore();

  const initialize = useCallback(async () => {
    console.log("[XMTP] initialize() called");
    setLoading(true);
    setError(null);

    try {
      // ── 1. Boot XMTP client ────────────────────────────────────────────────
      const client = await initXmtpClient();
      console.log("[XMTP] client inboxId:", client.inboxId);
      _client = client;
      setXmtpClient(client as unknown as null);
      setMyInboxId(client.inboxId);
      _myInboxId = client.inboxId;

      // ── 2. Fetch remote config (group ID + admin inboxId) ──────────────────
      const config = await fetchAppConfig();
      setRemoteGroupId(config.globalGroupId);
      console.log("[XMTP] remote config:", config);

      // ── 3. Find or create the global group ─────────────────────────────────
      const { group, isNewAdmin } = await getOrCreateGlobalChat(
        client,
        config.globalGroupId
      );
      _group = group;

      if (isNewAdmin) {
        // This client just created the group — become the admin.
        setIsGroupAdmin(true);
        console.log("[XMTP] You are the admin. Group ID:", (group as any)?.id);
        // Publish group ID + admin inboxId to GitHub so testers can find this group.
        // (Admin will need to enter their GitHub PAT in Admin Settings to trigger this.)
        const groupId = (group as any)?.id ?? "";
        setRemoteGroupId(groupId);
        // Auto-publish if admin token is already saved.
        try {
          const token = await getAdminToken();
          if (token) {
            await publishAppConfig({ globalGroupId: groupId, adminInboxId: client.inboxId });
            console.log("[XMTP] Auto-published config to GitHub.");
          } else {
            console.warn("[XMTP] No GitHub PAT saved — open Admin Settings to publish the group ID.");
          }
        } catch (err) {
          console.warn("[XMTP] Auto-publish failed:", err);
        }
      }

      if (!group) {
        // Remote config has a group ID, but this user is not yet a member.
        setIsGroupMember(false);

        // Auto-send a join request DM to the admin (once per device).
        if (config.adminInboxId && config.adminInboxId !== client.inboxId) {
          const alreadySent = await AsyncStorage.getItem(AK_JOIN_REQUEST_SENT);
          if (!alreadySent) {
            try {
              const { username } = useAppStore.getState();
              await sendJoinRequestDM(client, config.adminInboxId, client.inboxId, username);
              await AsyncStorage.setItem(AK_JOIN_REQUEST_SENT, "1");
              console.log("[XMTP] Join request DM sent to admin.");
            } catch (err) {
              console.warn("[XMTP] Could not send join request DM:", err);
            }
          }
        }

        setLoading(false);
        return;
      }

      // ── 4. Load message history ────────────────────────────────────────────
      setIsGroupMember(true);
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

      // ── 5. Stream incoming messages ────────────────────────────────────────
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

        if (msg.senderAddress === _myInboxId) return;

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
    setIsGroupMember,
    setIsGroupAdmin,
    setJoinRequests,
    setRemoteGroupId,
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

  const addMember = useCallback(async (inboxId: string) => {
    if (!_group) throw new Error("Not in a group");
    await addMemberToGroup(_group, inboxId.trim());
  }, []);

  // ── Admin: load pending join requests from DMs ─────────────────────────────
  const loadJoinRequests = useCallback(async () => {
    if (!_client) return;
    try {
      const requests = await fetchJoinRequests(_client);
      setJoinRequests(requests);
      console.log(`[XMTP] ${requests.length} pending join request(s).`);
    } catch (err) {
      console.warn("[XMTP] loadJoinRequests failed:", err);
    }
  }, [setJoinRequests]);

  // ── Admin: approve a join request ─────────────────────────────────────────
  const approveJoinRequest = useCallback(
    async (inboxId: string) => {
      if (!_group) throw new Error("Not in a group");
      await addMemberToGroup(_group, inboxId);
      useAppStore.getState().removeJoinRequest(inboxId);
      console.log("[XMTP] Added", inboxId, "to the group.");
    },
    []
  );

  // ── Admin: publish group ID to GitHub config ───────────────────────────────
  const publishGroupId = useCallback(async (githubPat: string) => {
    if (!_client) throw new Error("XMTP client not ready");
    const groupId = (_group as any)?.id;
    if (!groupId) throw new Error("No group created yet — initialize the app first.");

    await saveAdminToken(githubPat);
    await publishAppConfig({ globalGroupId: groupId, adminInboxId: _client.inboxId });
    console.log("[XMTP] Group config published to GitHub.");
  }, []);

  return {
    initialize,
    disconnect,
    send,
    reply,
    react,
    addMember,
    loadJoinRequests,
    approveJoinRequest,
    publishGroupId,
  };
}
