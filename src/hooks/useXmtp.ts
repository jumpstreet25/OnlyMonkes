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
import { AppState } from "react-native";
import { clearSession, clearMatricaSession, clearVerifiedNft } from "@/lib/session";
import {
  initXmtpClient,
  getOrCreateGlobalChat,
  addMemberToGroup,
  decodeMessage,
  applyReaction,
  applyStickerReaction,
  sendMessage,
  sendReply,
  sendReaction,
  sendStickerReaction,
  sendTypingIndicator,
  sendJoinRequestDM,
  fetchJoinRequests,
  sendProfileUpdate,
  sendEventMessage,
  sendLiveRoomMessage,
} from "@/lib/xmtp";
import { parseLiveRoomMessage, buildLiveRoomMessage, type LiveRoomData } from "@/lib/livekit";
import { verifyNftMintInCollection } from "@/lib/nftVerification";
import { cacheProfile, getCachedProfile, loadProfileCache, trackUser, loadAllTimeUsers } from "@/lib/userProfile";
import { loadWeeklyActivity, trackActivity } from "@/lib/activityTracker";
import { parseEventMessage, saveEvent } from "@/lib/calendar";
import {
  fetchAppConfig,
  publishAppConfig,
  saveAdminToken,
  getAdminToken,
} from "@/lib/remoteConfig";
import { useAppStore } from "@/store/appStore";
import { useChatStore } from "@/store/chatStore";
// Typing-indicator timeout map — module-level so it survives re-renders
const _typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
// Throttle own typing broadcasts (one signal per 2.5 s max)
let _lastTypingSent = 0;
import { showLocalNotification, detectMention, getCachedPushToken, registerForExpoPushToken, CH_ALL, CH_MENTIONS, CH_BOT } from "@/lib/notifications";

const BOT_USERNAME = "AI Agent #9385";
import { loadCachedMessages, saveCachedMessages, appendCachedMessage, getLastReadTimestamp } from "@/lib/messageCache";
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { XmtpClient, XmtpGroup } from "@/lib/xmtp";

// ─── Module-level singletons ──────────────────────────────────────────────────

let _group: XmtpGroup | null = null;
let _client: XmtpClient | null = null;

export function getXmtpClient(): XmtpClient | null { return _client; }
let _unsubscribeStream: (() => void) | null = null;
let _botChannelUnsubs: (() => void)[] = [];
let _myInboxId = "";
let _streamAlive = false;
let _profileBroadcastDone = false;

/**
 * Re-broadcast own profile with a push token.
 * Called from _layout.tsx after registerForPushNotifications() completes,
 * ensuring the bot always receives a valid ExponentPushToken.
 * Safe to call even if XMTP isn't ready yet — exits silently.
 */
export async function triggerProfileRebroadcast(pushToken: string): Promise<void> {
  if (!_group || !_myInboxId) return;
  const { username, bio, xAccount, wallet, tipWallet, verifiedNft, isLegendary,
    notificationsEnabled, mentionsOnly, botNotificationsEnabled,
    dmNotificationsEnabled, liveRoomNotificationsEnabled,
    mutedBotChannels, mutedSports,
  } = useAppStore.getState();
  try {
    const expoPushToken = useAppStore.getState().expoPushToken ?? await registerForExpoPushToken();
    await sendProfileUpdate(
      _group as XmtpGroup, _myInboxId,
      username, bio, xAccount,
      wallet?.address ?? null, tipWallet ?? null,
      verifiedNft?.image ?? null, isLegendary, pushToken,
      {
        all: notificationsEnabled,
        mentions: mentionsOnly,
        bot: botNotificationsEnabled,
        dm: dmNotificationsEnabled,
        live: liveRoomNotificationsEnabled,
        mutedChannels: mutedBotChannels,
        mutedSports,
      },
      expoPushToken,
    );
    console.log('[XMTP] Re-broadcast profile with push token:', pushToken.slice(0, 30) + '…');
  } catch { /* non-critical */ }
}

const AK_JOIN_REQUEST_SENT = "xmtp_join_request_sent";
const AK_IS_ADMIN         = "xmtp_is_group_admin";
const AK_APPROVED_IDS     = "xmtp_approved_inbox_ids";

/**
 * Bidirectional sync between message senderNft and profile cache.
 * - If message has senderNft.image but cache doesn't, seed the cache.
 * - If message has no senderNft but cache has nftImage, fill it in.
 */
function enrichWithNft(msg: ChatMessage): ChatMessage {
  const cached = getCachedProfile(msg.senderAddress);
  // Seed cache from message if we have an image not yet cached
  if (msg.senderNft?.image && !cached?.nftImage) {
    cacheProfile(msg.senderAddress, { nftImage: msg.senderNft.image });
  }
  if (msg.senderNft) return msg;
  if (cached?.nftImage) {
    return { ...msg, senderNft: { mint: "", name: "", image: cached.nftImage } };
  }
  return msg;
}

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
  const { setMessages, addMessage, mergeMessage, upgradeOwnMessage, applyReactionUpdate, setLoadingHistory } =
    useChatStore();

  const initialize = useCallback(async () => {
    console.log("[XMTP] initialize() called");
    setLoading(true);
    setError(null);

    try {
      await loadProfileCache();
      await loadAllTimeUsers();
      await loadWeeklyActivity();

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
      if (config.botChannels) {
        useAppStore.getState().setBotChannelIds({
          bets: config.botChannels.bets ?? '',
          trades: config.botChannels.trades ?? '',
          sales: config.botChannels.sales ?? '',
          predictions: config.botChannels.predictions ?? '',
        });
      }
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

      // ── Auto-approve all pending join requests (admin) ───────────────────
      const isAdmin =
        storedAdmin === "1" ||
        !!(config.adminInboxId && config.adminInboxId === client.inboxId);
      if (isAdmin && group) {
        // Fire-and-forget: approve genuinely new join requests automatically.
        // Tracks approved IDs in AsyncStorage so repeated app opens don't
        // re-notify for users who were already added.
        (async () => {
          try {
            const requests = await fetchJoinRequests(client);
            if (requests.length === 0) return;

            // Filter to only requests that haven't been processed before.
            const approvedRaw = await AsyncStorage.getItem(AK_APPROVED_IDS);
            const approvedSet = new Set<string>(
              approvedRaw ? JSON.parse(approvedRaw) : []
            );
            const newRequests = requests.filter((r) => !approvedSet.has(r.inboxId));

            if (newRequests.length > 0) {
              // Update badge so admin sees how many are waiting.
              setJoinRequests(newRequests);

              // Notify admin of new arrivals.
              const names = newRequests
                .map((r) => r.username || r.inboxId.slice(0, 8))
                .join(", ");
              await showLocalNotification(
                `👥 ${newRequests.length} new Monke${newRequests.length > 1 ? "s" : ""} joined!`,
                names
              );

              // Auto-approve each new request.
              // NFT holders are admitted immediately; others are added normally.
              // Only mark as approved if addMemberToGroup actually succeeds.
              for (const req of newRequests) {
                try {
                  // NFT gate: verify the mint belongs to the Saga Monkes collection.
                  if (req.nftMint) {
                    const validNft = await verifyNftMintInCollection(req.nftMint);
                    if (!validNft) {
                      console.log("[XMTP] NFT verification failed for", req.inboxId, "— skipping auto-approve");
                      continue;
                    }
                    console.log("[XMTP] NFT verified for", req.inboxId, "— auto-admitting");
                  }
                  await addMemberToGroup(group as XmtpGroup, req.inboxId);

                  // Also add to all bot channels
                  const channelIds = useAppStore.getState().botChannelIds;
                  if (channelIds) {
                    for (const [name, chId] of Object.entries(channelIds)) {
                      if (!chId) continue;
                      try {
                        const ch = await client.conversations.findGroup(chId as any);
                        if (ch) {
                          await (ch as any).addMembers([req.inboxId]);
                          console.log(`[XMTP] Added ${req.inboxId.slice(0, 8)}… to ${name} channel`);
                        }
                      } catch { /* already a member or non-critical */ }
                    }
                  }

                  approvedSet.add(req.inboxId);
                  useAppStore.getState().removeJoinRequest(req.inboxId);
                  console.log("[XMTP] Auto-approved:", req.inboxId);
                } catch (approveErr) {
                  console.warn("[XMTP] Failed to auto-approve", req.inboxId, approveErr);
                  // Do NOT add to approvedSet — leave visible in admin panel for manual action.
                }
              }

              // Persist updated approved set.
              await AsyncStorage.setItem(
                AK_APPROVED_IDS,
                JSON.stringify([...approvedSet])
              );
              console.log(`[XMTP] Auto-approved ${newRequests.length} join request(s).`);
            }
          } catch (err) {
            console.warn("[XMTP] Auto-approve failed:", err);
          }
        })();
      }

      if (!group) {
        // Remote config has a group ID, but this user is not yet a member.
        setIsGroupMember(false);

        // Auto-send a join request DM to the bot (re-sends every 30s until approved).
        // The bot auto-approves NFT holders and adds them to all channels.
        if (config.adminInboxId && config.adminInboxId !== client.inboxId) {
          const lastSentRaw = await AsyncStorage.getItem(AK_JOIN_REQUEST_SENT);
          const lastSent = lastSentRaw ? parseInt(lastSentRaw, 10) : 0;
          const elapsed = Date.now() - lastSent;
          // Re-send every 30s to handle bot restarts / missed DMs
          if (elapsed > 30_000) {
            try {
              const { username, verifiedNft } = useAppStore.getState();
              await sendJoinRequestDM(
                client,
                config.adminInboxId,
                client.inboxId,
                username,
                verifiedNft?.mint ?? null,
                config.botInboxId ?? null,
              );
              await AsyncStorage.setItem(AK_JOIN_REQUEST_SENT, String(Date.now()));
              console.log("[XMTP] Join request DM sent to bot (nft:", verifiedNft?.mint ?? "none", ")");
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

      // Load cached main chat messages immediately so Shared Images/Links are available
      try {
        const cached = await loadCachedMessages("main_chat");
        if (cached.length > 0) setMessages(cached);
      } catch { /* non-critical */ }
      // First sync the group to pull its latest messages from the network.
      // Then syncAllConversations triggers the epoch update for fresh installs
      // (new installation key needs the group to propagate its latest epoch).
      await (group as any).sync();
      try { await client.conversations.syncAllConversations(); } catch { /* ignore */ }
      await (group as any).sync(); // second pass after epoch update
      const rawHistory: any[] = await (group as any).messages({ limit: 200 });

      // ── Pass 1: seed profile cache + events from history ─────────────────
      // Must run BEFORE decoding messages so enrichWithNft() has fresh cache data.
      // Iterate oldest-first so later (newer) PROFILE_UPDATEs win over older ones.
      for (const raw of [...rawHistory].reverse()) {
        try {
          const content = raw.content();
          if (typeof content === "string" && content.startsWith("PROFILE_UPDATE:")) {
            try {
              const data = JSON.parse(content.slice("PROFILE_UPDATE:".length));
              if (data.id) {
                cacheProfile(data.id, { username: data.u || undefined, bio: data.b || undefined, xAccount: data.x || undefined, walletAddress: data.w || undefined, tipWallet: data.tw || undefined, nftImage: data.ni || null, legendary: !!data.lg, pushToken: data.pt || undefined, expoPushToken: data.ept || undefined });
                trackUser(data.id, data.u || undefined);
              }
            } catch { /* ignore */ }
          } else if (typeof content === "string" && content.startsWith("EVENT:")) {
            try {
              const event = parseEventMessage(content);
              if (event) await saveEvent(event);
            } catch { /* ignore */ }
          } else if (typeof content === "string" && content.startsWith("LIVE_ROOM:")) {
            try {
              const data = parseLiveRoomMessage(content);
              if (data) {
                // Track the most recent active room from history
                if (data.active) {
                  useAppStore.getState().setActiveLiveRoom({ ...data, participantCount: 1 });
                } else {
                  const current = useAppStore.getState().activeLiveRoom;
                  if (current?.id === data.id) useAppStore.getState().setActiveLiveRoom(null);
                }
              }
            } catch { /* ignore */ }
          }
        } catch { /* skip */ }
      }

      // ── Pass 2: decode messages, apply reactions, enrich with NFT images ──
      let decoded = rawHistory
        .map((m) => decodeMessage(m, _myInboxId))
        .filter(Boolean) as ChatMessage[];

      // Build a quick lookup: messageId → senderInboxId for reaction tracking
      const _msgSenderMap = new Map<string, string>(decoded.map(m => [m.id, m.senderAddress]));

      for (const raw of rawHistory) {
        try {
          const content = raw.content();
          if (typeof content === "string" && content.startsWith("REACT:")) {
            // Track activity: reactor gave a reaction; target sender received one
            const parts = content.split(":");
            const targetId = parts[2] ?? "";
            trackActivity(raw.senderInboxId as string, 'given');
            const targetSender = _msgSenderMap.get(targetId);
            if (targetSender) trackActivity(targetSender, 'received');
            decoded = applyReaction(decoded, raw, _myInboxId);
          } else if (typeof content === "string" && content.startsWith("STICKER_REACT:")) {
            decoded = applyStickerReaction(decoded, raw, _myInboxId);
          }
        } catch { /* skip */ }
      }

      // Track every message sender in the all-time registry + activity
      for (const msg of decoded) {
        trackUser(msg.senderAddress, msg.senderUsername);
        trackActivity(msg.senderAddress, 'sent');
      }

      // Populate senderNft from profile cache so avatars always show correctly
      const historyMessages = decoded.map(enrichWithNft);

      const orderedHistory = historyMessages.reverse(); // oldest-first

      // Merge cached messages (up to 7 days) with fresh XMTP history so
      // messages older than the 200-message XMTP window are preserved.
      const cached = await loadCachedMessages("main_chat").catch(() => [] as ChatMessage[]);
      const freshIds = new Set(orderedHistory.map((m) => m.id));
      const olderCached = cached.filter((m) => !freshIds.has(m.id)).map(enrichWithNft);
      const merged = [...olderCached, ...orderedHistory].sort(
        (a, b) => a.sentAt.getTime() - b.sentAt.getTime(),
      );
      setMessages(merged);
      setLoadingHistory(false);

      // Persist merged messages for next restart
      saveCachedMessages("main_chat", merged).catch(() => {});

      // ── 5. Stream incoming messages ────────────────────────────────────────
      _unsubscribeStream?.();
      _botChannelUnsubs.forEach(u => u());
      _botChannelUnsubs = [];
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
          // Track activity for streamed reactions
          const parts = content.split(":");
          const targetId = parts[2] ?? "";
          trackActivity(raw.senderInboxId as string, 'given');
          const { messages } = useChatStore.getState();
          const targetMsg = messages.find(m => m.id === targetId);
          if (targetMsg) trackActivity(targetMsg.senderAddress, 'received');
          const updated = applyReaction(messages, raw, _myInboxId);
          applyReactionUpdate(updated);
          return;
        }

        if (typeof content === "string" && content.startsWith("STICKER_REACT:")) {
          const { messages } = useChatStore.getState();
          const updated = applyStickerReaction(messages, raw, _myInboxId);
          applyReactionUpdate(updated);
          return;
        }

        if (typeof content === "string" && content.startsWith("TYPING:")) {
          // Format: TYPING:<inboxId>:<username>
          const parts = content.split(":");
          const typerId = parts[1] ?? (raw.senderInboxId as string);
          const typerUsername = parts[2] || undefined;
          // Ignore own typing signals
          if (typerId && typerId !== _myInboxId) {
            useChatStore.getState().setTypingUser(typerId, typerUsername);
            // Auto-clear after 4 s of silence
            const existing = _typingTimeouts.get(typerId);
            if (existing) clearTimeout(existing);
            _typingTimeouts.set(
              typerId,
              setTimeout(() => {
                useChatStore.getState().clearTypingUser(typerId);
                _typingTimeouts.delete(typerId);
              }, 4000)
            );
          }
          return;
        }

        if (typeof content === "string" && content.startsWith("PROFILE_UPDATE:")) {
          try {
            const data = JSON.parse(content.slice("PROFILE_UPDATE:".length));
            if (data.id) {
              cacheProfile(data.id, { username: data.u || undefined, bio: data.b || undefined, xAccount: data.x || undefined, walletAddress: data.w || undefined, tipWallet: data.tw || undefined, nftImage: data.ni || null, legendary: !!data.lg, pushToken: data.pt || undefined, expoPushToken: data.ept || undefined });
              trackUser(data.id, data.u || undefined);
            }
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

        if (typeof content === "string" && content.startsWith("LIVE_ROOM:")) {
          try {
            const data = parseLiveRoomMessage(content);
            if (data) {
              if (data.active) {
                useAppStore.getState().setActiveLiveRoom({ ...data, participantCount: 1 });
              } else {
                const current = useAppStore.getState().activeLiveRoom;
                if (current?.id === data.id) useAppStore.getState().setActiveLiveRoom(null);
              }
            }
          } catch { /* ignore */ }
          return;
        }

        const msg = decodeMessage(raw, _myInboxId);
        if (!msg) return;

        // Record every sender in the all-time registry + activity
        trackUser(msg.senderAddress, msg.senderUsername);
        trackActivity(msg.senderAddress, 'sent');

        // Skip own messages — already shown as optimistic bubbles
        if (msg.senderAddress === _myInboxId) return;

        const enrichedMsg = enrichWithNft(msg);
        mergeMessage(enrichedMsg);

        // Persist to cache for Shared Images/Links
        appendCachedMessage("main_chat", enrichedMsg).catch(() => {});

        const { notificationsEnabled, mentionsOnly, botNotificationsEnabled, username } =
          useAppStore.getState();

        const senderLabel = msg.senderUsername ?? msg.senderAddress.slice(0, 6);
        const isBotMessage = msg.senderUsername === BOT_USERNAME;

        // Show heads-up notification for all incoming messages.
        // DirectNotif native module posts directly to the Android channel,
        // bypassing expo's groupKey=silent interception — works in foreground.
        if (isBotMessage) {
          if (botNotificationsEnabled) {
            await showLocalNotification(`${senderLabel} 🤖`, msg.content, CH_BOT);
          }
          return;
        }

        if (!notificationsEnabled) return;

        const isMention = detectMention(msg.content, username ?? "");
        if (mentionsOnly && !isMention) return;

        const channelId = isMention ? CH_MENTIONS : CH_ALL;
        const title = isMention
          ? `${senderLabel} mentioned you 🍌`
          : `${senderLabel} in OnlyMonkes`;

        await showLocalNotification(title, msg.content, channelId);
      });

      _streamAlive = true;
      _unsubscribeStream = () => { _streamAlive = false; unsub(); };

      // ── 6. Auto-broadcast own profile once per session ─────────────────────
      // Ensures every user's PFP is visible in the cache of everyone in the chat,
      // even if they never manually updated their profile settings.
      if (!_profileBroadcastDone) {
        _profileBroadcastDone = true;
        (async () => {
          try {
            const { username, bio, xAccount, wallet, tipWallet, verifiedNft, isLegendary,
              notificationsEnabled, mentionsOnly, botNotificationsEnabled,
              dmNotificationsEnabled, liveRoomNotificationsEnabled,
              mutedBotChannels, mutedSports,
            } = useAppStore.getState();
            // Wait up to 8s for FCM token — on first launch, registerForPushNotifications()
            // in _layout.tsx runs concurrently with XMTP init, causing a race condition
            // where the token isn't in SecureStore yet when we broadcast.
            let pushToken: string | null = await getCachedPushToken();
            if (!pushToken) {
              for (let i = 0; i < 8 && !pushToken; i++) {
                await new Promise(r => setTimeout(r, 1000));
                pushToken = await getCachedPushToken();
              }
            }
            // Also fetch Expo push token for client-side DM relay
            let expoPushToken: string | null = await registerForExpoPushToken();
            if (expoPushToken) useAppStore.getState().setExpoPushToken(expoPushToken);
            console.log('[XMTP] Profile broadcast, FCM token:', pushToken ? pushToken.slice(0, 30) + '…' : 'none',
              'Expo token:', expoPushToken ? expoPushToken.slice(0, 40) + '…' : 'none');
            await sendProfileUpdate(
              group as XmtpGroup,
              client.inboxId,
              username,
              bio,
              xAccount,
              wallet?.address ?? null,
              tipWallet ?? null,
              verifiedNft?.image ?? null,
              isLegendary,
              pushToken,
              {
                all: notificationsEnabled,
                mentions: mentionsOnly,
                bot: botNotificationsEnabled,
                dm: dmNotificationsEnabled,
                live: liveRoomNotificationsEnabled,
                mutedChannels: mutedBotChannels,
                mutedSports,
              },
              expoPushToken,
            );
            cacheProfile(client.inboxId, {
              username: username ?? undefined,
              nftImage: verifiedNft?.image ?? null,
            });
          } catch { /* non-critical */ }
        })();
      }

      // ── 7. Fetch bot channel unread counts (using last-read timestamps) ──
      (async () => {
        try {
          const channelIds = useAppStore.getState().botChannelIds;
          if (!channelIds) return;
          const counts = { bets: 0, trades: 0, sales: 0, predictions: 0 };
          for (const key of ['bets', 'trades', 'sales', 'predictions'] as const) {
            const chId = channelIds[key];
            if (!chId) continue;
            try {
              const ch = await client.conversations.findGroup(chId as any);
              if (ch) {
                await (ch as any).sync();
                const msgs: any[] = await (ch as any).messages({ limit: 100 });
                // Decode and cache fresh messages
                const decoded = msgs
                  .map((m: any) => decodeMessage(m, client.inboxId))
                  .filter(Boolean) as ChatMessage[];
                const freshMessages = decoded.reverse();
                await saveCachedMessages(key, freshMessages);
                // Count only messages newer than last-read timestamp
                const lastRead = await getLastReadTimestamp(key);
                counts[key] = freshMessages.filter((m) =>
                  m.sentAt.getTime() > lastRead
                ).length;
              }
            } catch { /* skip */ }
          }
          useAppStore.getState().setBotChannelCounts(counts);
          console.log('[XMTP] Bot channel unread counts:', counts);
        } catch { /* non-critical */ }
      })();

      // ── 8. Stream bot channels for real-time badge counts ──────────────────
      (async () => {
        try {
          const channelIds = useAppStore.getState().botChannelIds;
          if (!channelIds) return;
          const channelMap = new Map<string, 'bets' | 'trades' | 'sales' | 'predictions'>();
          for (const key of ['bets', 'trades', 'sales', 'predictions'] as const) {
            const chId = channelIds[key];
            if (chId) channelMap.set(chId, key);
          }
          for (const [chId, key] of channelMap) {
            try {
              const ch = await client.conversations.findGroup(chId as any);
              if (!ch) continue;
              const unsub = await (ch as any).streamMessages(async (raw: any) => {
                let content: string;
                try { content = raw.content(); } catch { return; }
                if (typeof content !== 'string') return;
                // Skip reactions, typing, own messages
                if (content.startsWith('REACT:') || content.startsWith('TYPING:')) return;
                const senderInboxId = raw.senderInboxId ?? '';
                if (senderInboxId === client.inboxId) return;
                useAppStore.getState().incrementBotChannelCount(key);
                // Show heads-up notification for bot channel messages
                const { botNotificationsEnabled } = useAppStore.getState();
                if (botNotificationsEnabled) {
                  const label = key === 'bets' ? 'Monke Bets' : key === 'trades' ? 'Monke Trades' : key === 'sales' ? 'Monke Sales' : 'Monke Predictions';
                  const firstLine = content.startsWith('MSG:') ? content.split(':').slice(2).join(':').split('\n')[0] : content.split('\n')[0];
                  await showLocalNotification(`${label} 🤖`, firstLine, CH_BOT);
                }
              });
              _botChannelUnsubs.push(unsub);
              console.log(`[XMTP] Streaming bot channel: ${key}`);
            } catch { /* skip individual channel */ }
          }
        } catch { /* non-critical */ }
      })();
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
    upgradeOwnMessage,
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
    _botChannelUnsubs.forEach(u => u());
    _botChannelUnsubs = [];
  }, []);

  const streamAlive = useCallback(() => _streamAlive, []);

  const logout = useCallback(async () => {
    _unsubscribeStream?.();
    _unsubscribeStream = null;
    _botChannelUnsubs.forEach(u => u());
    _botChannelUnsubs = [];
    _streamAlive = false;
    _group = null;
    _client = null;
    _myInboxId = "";
    _profileBroadcastDone = false;
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

      // Apply optimistically — XMTP does not echo own messages back in the stream.
      const fakeRaw = {
        content: () => `REACT:${emoji}:${targetMessageId}`,
        senderInboxId: _myInboxId,
      };
      const { messages } = useChatStore.getState();
      applyReactionUpdate(applyReaction(messages, fakeRaw, _myInboxId));

      await sendReaction(_group, emoji, targetMessageId);
    },
    [initialize, applyReactionUpdate]
  );

  const stickerReact = useCallback(
    async (url: string, targetMessageId: string) => {
      if (!_group) await initialize();
      if (!_group) throw new Error("Not connected to chat");

      // Apply optimistically — XMTP does not echo own messages back in the stream.
      const fakeRaw = {
        content: () => `STICKER_REACT:${url}:${targetMessageId}`,
        senderInboxId: _myInboxId,
      };
      const { messages } = useChatStore.getState();
      applyReactionUpdate(applyStickerReaction(messages, fakeRaw, _myInboxId));

      await sendStickerReaction(_group, url, targetMessageId);
    },
    [initialize, applyReactionUpdate]
  );

  // Throttled typing signal — max one broadcast per 2.5 s
  const sendTyping = useCallback(async () => {
    if (!_group) return;
    const now = Date.now();
    if (now - _lastTypingSent < 2500) return;
    _lastTypingSent = now;
    const { username, myInboxId: id } = useAppStore.getState();
    try {
      await sendTypingIndicator(_group, id ?? _myInboxId, username);
    } catch { /* ignore — typing is best-effort */ }
  }, []);

  const addMember = useCallback(async (inboxId: string) => {
    if (!_group) throw new Error("Not in a group");
    await addMemberToGroup(_group, inboxId.trim());
  }, []);

  // ── Admin: load pending join requests from DMs ─────────────────────────────
  const loadJoinRequests = useCallback(async () => {
    if (!_client) return;
    try {
      const requests = await fetchJoinRequests(_client);
      // Filter out already-approved IDs so the list only shows genuinely pending users
      const approvedRaw = await AsyncStorage.getItem(AK_APPROVED_IDS);
      const approvedSet = new Set<string>(approvedRaw ? JSON.parse(approvedRaw) : []);
      const pending = requests.filter((r) => !approvedSet.has(r.inboxId));
      setJoinRequests(pending);
      console.log(`[XMTP] ${pending.length} pending join request(s).`);
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
    const { username, bio, xAccount, wallet, tipWallet, verifiedNft, isLegendary,
      notificationsEnabled, mentionsOnly, botNotificationsEnabled,
      dmNotificationsEnabled, liveRoomNotificationsEnabled,
      mutedBotChannels, mutedSports,
    } = useAppStore.getState();
    try {
      const pushToken = await getCachedPushToken();
      const expoPushToken = useAppStore.getState().expoPushToken ?? await registerForExpoPushToken();
      await sendProfileUpdate(
        _group, _myInboxId,
        username, bio, xAccount,
        wallet?.address ?? null,
        tipWallet ?? null,
        verifiedNft?.image ?? null,
        isLegendary,
        pushToken,
        {
          all: notificationsEnabled,
          mentions: mentionsOnly,
          bot: botNotificationsEnabled,
          dm: dmNotificationsEnabled,
          live: liveRoomNotificationsEnabled,
          mutedChannels: mutedBotChannels,
          mutedSports,
        },
        expoPushToken,
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
        if (msg.senderAddress === _myInboxId) {
          // Own messages: only upgrade an existing opt-* bubble — never append.
          // This eliminates the duplicate where heartbeat sync adds a second copy.
          upgradeOwnMessage(enrichWithNft(msg));
        } else {
          mergeMessage(enrichWithNft(msg));
        }
      }
    } catch (err) {
      console.warn("[XMTP] syncMessages failed:", err);
    }
  }, [mergeMessage, upgradeOwnMessage]);

  // ── Broadcast a calendar event to the group ───────────────────────────────
  const broadcastEvent = useCallback(async (eventJson: string) => {
    if (!_group) return;
    try {
      await sendEventMessage(_group, eventJson);
    } catch (err) {
      console.warn("[XMTP] broadcastEvent failed:", err);
    }
  }, []);

  // ── Broadcast a live room signal (start / end) ─────────────────────────────
  const broadcastLiveRoom = useCallback(async (data: LiveRoomData) => {
    if (!_group) return;
    try {
      await sendLiveRoomMessage(_group, JSON.stringify(data));
    } catch (err) {
      console.warn("[XMTP] broadcastLiveRoom failed:", err);
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

  // ── Admin recovery: create a new group + publish when stale config blocks admin ─
  // Call this from the pending screen when the admin is locked out after reinstall.
  const forceAdminInit = useCallback(async (githubPat: string) => {
    if (!_client) throw new Error("XMTP client not ready");

    // Save PAT first so publishAppConfig can use it.
    await saveAdminToken(githubPat);

    // Create a brand-new group.
    const rawGroup = await (_client.conversations as any).newGroup([], {
      permissionLevel: "all_members",
      name: "OnlyMonkes Global Chat",
    });
    const groupId = (rawGroup as any).id;

    // Mark as admin in persistent storage so the next initialize() picks it up.
    await AsyncStorage.setItem(AK_IS_ADMIN, "1");

    // Publish new config — all clients will pick this up on next launch.
    await publishAppConfig({ globalGroupId: groupId, adminInboxId: _client.inboxId });
    console.log("[XMTP] forceAdminInit: new group", groupId, "published.");

    // Re-run full initialize — it will find the new group and complete setup.
    await initialize();
  }, [initialize]);

  return {
    initialize,
    disconnect,
    logout,
    streamAlive,
    send,
    reply,
    react,
    stickerReact,
    sendTyping,
    addMember,
    loadJoinRequests,
    approveJoinRequest,
    publishGroupId,
    forceAdminInit,
    broadcastProfile,
    broadcastEvent,
    broadcastLiveRoom,
    syncMessages,
  };
}
