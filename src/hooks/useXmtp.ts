/**
 * useXmtp
 *
 * Initializes an XMTP v5 client (random identity, persisted in SecureStore),
 * loads global group chat history, and subscribes to incoming messages.
 *
 * Open-access flow (Saga Monkes NFT holders):
 *   1. Admin runs first → creates XMTP group → config auto-published to GitHub.
 *   2. Every user fetches the config on init. If not yet a member, the app
 *      auto-sends a JOIN_REQUEST DM to the admin (once per device) and shows
 *      a "waiting" screen.
 *   3. Next time the admin's app opens it auto-approves ALL pending requests —
 *      no manual review needed. Admin just needs to open the app periodically.
 *   4. User hits "Retry" → now a member → chat opens.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback } from "react";
import { clearSession, clearMatricaSession, clearVerifiedNft } from "@/lib/session";
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
  sendProfileUpdate,
  sendEventMessage,
} from "@/lib/xmtp";
import { cacheProfile, loadProfileCache } from "@/lib/userProfile";
import { parseEventMessage, saveEvent } from "@/lib/calendar";
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
let _streamAlive = false;

const AK_JOIN_REQUEST_SENT = "xmtp_join_request_sent";
const AK_IS_ADMIN         = "xmtp_is_group_admin";

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
  const { setMessages, addMessage, mergeMessage, applyReactionUpdate, setLoadingHistory } =
    useChatStore();

  const initialize = useCallback(async () => {
    console.log("[XMTP] initialize() called");
    setLoading(true);
    setError(null);

    try {
      // ── 0. Restore profile cache so PFPs are available before history loads ─
      await loadProfileCache();

      // ── 1. Boot XMTP client ────────────────────────────────────────────────
      const client = await initXmtpClient();
      console.log("[XMTP] client inboxId:", client.inboxId);
      _client = client;
      setXmtpClient(client as unknown as null);
      setMyInboxId(client.inboxId);
      _myInboxId = client.inboxId;

      // Seed own profile into the cache so PFP shows immediately for own messages
      const { username: ownUsername, verifiedNft: ownNft } = useAppStore.getState();
      cacheProfile(client.inboxId, {
        username: ownUsername ?? undefined,
        nftImage: ownNft?.image ?? null,
      });

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

      // ── Restore admin flag across restarts ────────────────────────────────
      const storedAdmin = await AsyncStorage.getItem(AK_IS_ADMIN);
      if (storedAdmin === "1") {
        setIsGroupAdmin(true);
      } else if (config.adminInboxId && config.adminInboxId === client.inboxId) {
        // Admin detected by matching inboxId to published remote config.
        await AsyncStorage.setItem(AK_IS_ADMIN, "1");
        setIsGroupAdmin(true);
      }

      if (isNewAdmin) {
        // This client just created the group — persist the admin flag.
        await AsyncStorage.setItem(AK_IS_ADMIN, "1");
        setIsGroupAdmin(true);
        console.log("[XMTP] You are the admin. Group ID:", (group as any)?.id);
        const groupId = (group as any)?.id ?? "";
        setRemoteGroupId(groupId);
        // Auto-publish if admin token is already saved.
        try {
          const token = await getAdminToken();
          if (token) {
            await publishAppConfig({ globalGroupId: groupId, adminInboxId: client.inboxId });
            console.log("[XMTP] Auto-published config to GitHub.");
          }
        } catch (err) {
          console.warn("[XMTP] Auto-publish failed:", err);
        }
      }

      // ── Auto-save PAT + auto-approve all pending join requests (admin) ────
      const isAdmin =
        storedAdmin === "1" ||
        !!(config.adminInboxId && config.adminInboxId === client.inboxId);
      if (isAdmin && group) {
        // Seed the GitHub PAT on first run so auto-publish always works.
        const existingToken = await getAdminToken();
        if (!existingToken) {
          await saveAdminToken("***REDACTED_GITHUB_PAT***");
          console.log("[XMTP] Admin PAT seeded to SecureStore.");
        }

        // Fire-and-forget: approve all pending join requests automatically.
        // Anyone who sent a JOIN_REQUEST DM to the admin gets added to the group.
        (async () => {
          try {
            const requests = await fetchJoinRequests(client);
            if (requests.length > 0) {
              for (const req of requests) {
                try {
                  await addMemberToGroup(group as XmtpGroup, req.inboxId);
                  console.log("[XMTP] Auto-approved:", req.inboxId);
                } catch { /* already a member — skip */ }
              }
              console.log(`[XMTP] Auto-approved ${requests.length} join request(s).`);
              setJoinRequests([]);
            }
          } catch (err) {
            console.warn("[XMTP] Auto-approve failed:", err);
          }
        })();
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
          } else if (typeof content === "string" && content.startsWith("PROFILE_UPDATE:")) {
            try {
              const data = JSON.parse(content.slice("PROFILE_UPDATE:".length));
              if (data.id) cacheProfile(data.id, { username: data.u || undefined, bio: data.b || undefined, xAccount: data.x || undefined, walletAddress: data.w || undefined, tipWallet: data.tw || undefined, nftImage: data.ni || undefined });
            } catch { /* ignore */ }
          } else if (typeof content === "string" && content.startsWith("EVENT:")) {
            try {
              const event = parseEventMessage(content);
              if (event) await saveEvent(event);
            } catch { /* ignore */ }
          }
        } catch {
          // skip
        }
      }

      setMessages(enriched.reverse()); // oldest-first
      setLoadingHistory(false);

      // ── 5. Stream incoming messages ────────────────────────────────────────
      _unsubscribeStream?.();
      _streamAlive = false;

      const unsub = await (group as any).streamMessages(async (raw: any) => {
        _streamAlive = true;
        let content: string;
        try {
          content = raw.content();
        } catch {
          _streamAlive = false;
          return;
        }

        if (typeof content === "string" && content.startsWith("REACT:")) {
          const { messages } = useChatStore.getState();
          const updated = applyReaction(messages, raw, _myInboxId);
          applyReactionUpdate(updated);
          return;
        }

        if (typeof content === "string" && content.startsWith("PROFILE_UPDATE:")) {
          try {
            const data = JSON.parse(content.slice("PROFILE_UPDATE:".length));
            if (data.id) cacheProfile(data.id, { username: data.u || undefined, bio: data.b || undefined, xAccount: data.x || undefined, walletAddress: data.w || undefined, tipWallet: data.tw || undefined, nftImage: data.ni || undefined });
          } catch { /* ignore */ }
          return;
        }

        if (typeof content === "string" && content.startsWith("EVENT:")) {
          try {
            const event = parseEventMessage(content);
            if (event) {
              await saveEvent(event);
              useAppStore.getState().addCalendarEvent(event);
            }
          } catch { /* ignore */ }
          return;
        }

        const msg = decodeMessage(raw, _myInboxId);
        if (!msg) return;

        // Skip own messages — already shown as optimistic bubbles
        if (msg.senderAddress === _myInboxId) return;

        mergeMessage(msg);

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

      _streamAlive = true;
      _unsubscribeStream = () => { _streamAlive = false; unsub(); };
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
    mergeMessage,
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

  const streamAlive = useCallback(() => _streamAlive, []);

  const logout = useCallback(async () => {
    _unsubscribeStream?.();
    _unsubscribeStream = null;
    _streamAlive = false;
    _group = null;
    _client = null;
    _myInboxId = "";
    await clearSession();
    await clearMatricaSession();
    await clearVerifiedNft();
    await AsyncStorage.removeItem(AK_JOIN_REQUEST_SENT);
    useAppStore.getState().reset();
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

  // ── Broadcast own profile to the group ────────────────────────────────────
  const broadcastProfile = useCallback(async () => {
    if (!_group || !_myInboxId) return;
    const { username, bio, xAccount, wallet, tipWallet, verifiedNft } = useAppStore.getState();
    try {
      await sendProfileUpdate(
        _group, _myInboxId,
        username, bio, xAccount,
        wallet?.address ?? null,
        tipWallet ?? null,
        verifiedNft?.image ?? null
      );
      // Keep own cache entry current so PFP is always available locally
      cacheProfile(_myInboxId, {
        username: username ?? undefined,
        nftImage: verifiedNft?.image ?? null,
      });
    } catch (err) {
      console.warn("[XMTP] broadcastProfile failed:", err);
    }
  }, []);

  // ── Sync recent messages (call when app returns to foreground) ────────────
  const syncMessages = useCallback(async () => {
    if (!_group) return;
    try {
      await (_group as any).sync();
      const rawHistory: any[] = await (_group as any).messages({ limit: 50 });

      const { messages: existing } = useChatStore.getState();
      const existingIds = new Set(existing.map((m) => m.id));

      const newMsgs: ChatMessage[] = rawHistory
        .map((m) => decodeMessage(m, _myInboxId))
        .filter((m): m is ChatMessage => !!m && !existingIds.has(m.id))
        .reverse(); // oldest-first within the batch

      for (const msg of newMsgs) {
        // mergeMessage deduplicates against optimistic bubbles (same sender+content)
        // so own sent messages don't appear twice with the wrong avatar
        mergeMessage(msg);
      }
    } catch (err) {
      console.warn("[XMTP] syncMessages failed:", err);
    }
  }, [mergeMessage]);

  // ── Broadcast a calendar event to the group ───────────────────────────────
  const broadcastEvent = useCallback(async (eventJson: string) => {
    if (!_group) return;
    try {
      await sendEventMessage(_group, eventJson);
    } catch (err) {
      console.warn("[XMTP] broadcastEvent failed:", err);
    }
  }, []);

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
    logout,
    streamAlive,
    send,
    reply,
    react,
    addMember,
    loadJoinRequests,
    approveJoinRequest,
    publishGroupId,
    broadcastProfile,
    broadcastEvent,
    syncMessages,
  };
}
