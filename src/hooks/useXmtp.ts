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
import { clearSession, clearMatricaSession, clearVerifiedNft, saveWalletBinding } from "@/lib/session";
import type { WalletBinding } from "@/lib/session";
import {
  getOrInitXmtpClient,
  getOrCreateGlobalChat,
  addMemberToGroup,
  decodeMessage,
  applyReaction,
  applyEdit,
  applyStickerReaction,
  resolveReplyTargets,
  sendMessage,
  sendReply,
  sendReaction,
  sendEdit,
  sendStickerReaction,
  sendTypingIndicator,
  sendRemoteAttachment,
  sendJoinRequestDM,
  fetchJoinRequests,
  sendProfileUpdate,
  sendEventMessage,
  sendLiveRoomMessage,
  sendVideoRoomMessage,
  sendAvatarRoomMessage,
  parseProfileUpdate,
} from "@/lib/xmtp";
import { parseLiveRoomMessage, buildLiveRoomMessage, type LiveRoomData } from "@/lib/livekit";
import { parsePinMessage, pinMessage, unpinMessage, getPinnedMessages } from "@/lib/pinnedMessages";
import { parsePresenceMessage, updatePresence, buildPresenceMessage } from "@/lib/presence";
import { parseThreadMessage, trackThreadReply } from "@/lib/threads";
import { parseMarketplaceMessage, addListing, addBid, markPendingSwap, markSold, delistNft, getListingById, getBidsForListing, getHistory as getMarketplaceHistory, type NftSwapMessage } from "@/lib/marketplace";
import { parseVideoRoomMessage, type VideoRoomData } from "@/lib/liveVideo";
import { parseAvatarRoomMessage, type AvatarRoomData } from "@/lib/avatarRoom";
import { verifyNFTOwnership, verifyNftMintInCollection } from "@/lib/nftVerification";
import { cacheProfile, getCachedProfile, loadProfileCache, trackUser, loadAllTimeUsers } from "@/lib/userProfile";
import { loadWeeklyActivity, trackActivity } from "@/lib/activityTracker";
import { incrementProgress, updateStreak, getEarnedBadges, type BadgeDef } from "@/lib/badges";
import { processBananaGrant } from "@/lib/bananaGrant";
import { loadBananaState, mergeBananaBalance } from "@/lib/bananaRewards";
import { loadShopState, mergeOwnedItems, getEquippedStyles, addOwnedItem, equipItem } from "@/lib/bananaShop";
import { applyThemeFromShop } from "@/lib/shopTheme";
import { processRsvpMessage } from "@/lib/eventRsvp";
import { parseEventMessage, saveEvent } from "@/lib/calendar";
import {
  fetchAppConfig,
  publishAppConfig,
  saveAdminToken,
  getAdminToken,
} from "@/lib/remoteConfig";
import { toast } from "sonner-native";
import { useAppStore } from "@/store/appStore";
import { useChatStore } from "@/store/chatStore";
// Typing-indicator timeout map — module-level so it survives re-renders
// Capped at 100 to prevent memory leak in long sessions
const _typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_TYPING_ENTRIES = 100;
function setTypingTimeout(key: string, timer: ReturnType<typeof setTimeout>) {
  if (_typingTimeouts.has(key)) clearTimeout(_typingTimeouts.get(key)!);
  _typingTimeouts.set(key, timer);
  // Evict oldest if over cap
  if (_typingTimeouts.size > MAX_TYPING_ENTRIES) {
    const oldest = _typingTimeouts.keys().next().value;
    if (oldest) { clearTimeout(_typingTimeouts.get(oldest)!); _typingTimeouts.delete(oldest); }
  }
}
// Throttle own typing broadcasts (one signal per 2.5 s max)
let _lastTypingSent = 0;
import { showLocalNotification, detectMention, getCachedPushToken, registerForExpoPushToken, CH_ALL, CH_MENTIONS, CH_BOT, CH_LIVE, CH_MARKET, CH_SOCIAL } from "@/lib/notifications";

const BOT_USERNAME = "AI Agent #9385";
import { loadCachedMessages, saveCachedMessages, appendCachedMessage, getLastReadTimestamp } from "@/lib/messageCache";
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { XmtpClient, XmtpGroup } from "@/lib/xmtp";

// ─── Timeout helper (prevents XMTP sync from hanging on poor network) ────────
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// ─── Module-level singletons ──────────────────────────────────────────────────

let _group: XmtpGroup | null = null;
let _client: XmtpClient | null = null;

export function getXmtpClient(): XmtpClient | null { return _client; }

/** Send a raw string to the global group (no MSG: wrapping). Used by marketplace. */
export async function sendRawToGroup(raw: string): Promise<void> {
  if (!_group) throw new Error("Not connected to chat");
  await (_group as any).send(raw);
}

/** Admin: gift a shop item to a user. Sends GIFT_ITEM: message to group. */
export async function sendGiftItem(recipientInboxId: string, itemId: string): Promise<void> {
  if (!_group) throw new Error("Not connected to chat");
  const from = useAppStore.getState().username ?? "Admin";
  const payload = JSON.stringify({ recipientInboxId, itemId, from });
  await (_group as any).send(`GIFT_ITEM:${payload}`);
}
let _unsubscribeStream: (() => void) | null = null;
let _botChannelUnsubs: (() => void)[] = [];
let _myInboxId = "";
let _streamAlive = false;
let _lastStreamEvent = 0; // timestamp of last stream callback
let _profileBroadcastDone = false;
let _initRunning = false;
// Badge minting removed — badges now award bananas via _layout.tsx callback.
// tryMintBadge kept as no-op for existing call sites.
function tryMintBadge(): void { /* no-op */ }

/**
 * Re-broadcast own profile with a push token.
 * Called from _layout.tsx after registerForPushNotifications() completes,
 * ensuring the bot always receives a valid ExponentPushToken.
 * Safe to call even if XMTP isn't ready yet — exits silently.
 */
let _profileDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export async function triggerProfileRebroadcast(pushToken: string): Promise<void> {
  // Debounce 500ms — coalesces simultaneous calls (token change + push token)
  if (_profileDebounceTimer) clearTimeout(_profileDebounceTimer);
  return new Promise((resolve) => {
    _profileDebounceTimer = setTimeout(() => {
      _profileDebounceTimer = null;
      _doProfileRebroadcast(pushToken).then(resolve).catch(() => resolve());
    }, 500);
  });
}

async function _doProfileRebroadcast(pushToken: string): Promise<void> {
  if (!_group || !_myInboxId) return;
  const { username, bio, xAccount, wallet, tipWallet, verifiedNft, isLegendary,
    notificationsEnabled, mentionsOnly, botNotificationsEnabled,
    dmNotificationsEnabled, liveRoomNotificationsEnabled,
    mutedBotChannels, mutedSports, shopStyles: currentShopStyles,
  } = useAppStore.getState();
  try {
    const expoPushToken = useAppStore.getState().expoPushToken ?? await registerForExpoPushToken();
    const [bananaState, shopState] = await Promise.all([loadBananaState(), loadShopState()]);
    await sendProfileUpdate(
      _group as XmtpGroup, _myInboxId,
      username, bio, xAccount,
      wallet?.address ?? null, tipWallet ?? null,
      verifiedNft?.image ?? null, verifiedNft?.mint ?? null, isLegendary, pushToken,
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
      undefined, // location (not available here)
      getEarnedBadges(),
      Object.keys(currentShopStyles).length > 0 ? currentShopStyles : null,
      bananaState.balance,
      shopState.owned.length > 0 ? shopState.owned : null,
      shopState.pfpBindings ?? null,
    );
    if (__DEV__) console.log('[XMTP] Re-broadcast profile with push token:', pushToken.slice(0, 30) + '…');
  } catch { /* non-critical */ }
}

const AK_JOIN_REQUEST_SENT = "xmtp_join_request_sent";
const AK_IS_ADMIN         = "xmtp_is_group_admin";
const AK_APPROVED_IDS     = "xmtp_approved_inbox_ids";
// Inbox IDs we have already shown a "joined" notification for. Tracked
// separately from approvedSet because approval can fail repeatedly (NFT verify,
// already-a-member, network) — without this dedup the same user re-notifies on
// every initialize().
const AK_NOTIFIED_IDS     = "xmtp_notified_inbox_ids";

/**
 * Validate that an nftImage URL is from a legitimate source (Saga Monkes).
 * Accepts: data URIs (base64 from local verification), IPFS gateways, Arweave, Shyft CDN.
 * Rejects: arbitrary URLs that could be non-collection images or malicious.
 */
function isValidNftImage(url: string | null | undefined): boolean {
  if (!url) return false;
  // Data URIs from local verification are always trusted
  if (url.startsWith("data:image/")) return true;
  // Known NFT image hosts
  const trusted = [
    "nftstorage.link", "ipfs.io", "cloudflare-ipfs.com", "gateway.pinata.cloud",
    "arweave.net", "ar-io.net",
    "shyft.to", "cdn.shyft.to",
    "helius-rpc.com", "nft-cdn.helius.xyz",
    "shdw-drive.genesysgo.net",
  ];
  try {
    const host = new URL(url).hostname;
    return trusted.some(t => host === t || host.endsWith("." + t));
  } catch {
    return false;
  }
}

/**
 * Cache of wallet addresses verified to own a Saga Monke.
 * Prevents redundant Helius/Shyft API calls on repeated PROFILE_UPDATE messages.
 * true = wallet owns a Saga Monke, false = does not.
 * Capped at 500 entries with LRU eviction to prevent unbounded growth.
 */
const _verifiedWallets = new Map<string, boolean>();
const MAX_VERIFIED_WALLETS = 500;

/**
 * Background-verify that a wallet owns a Saga Monke NFT via Helius/Shyft.
 * If it doesn't, null out the nftImage in the profile cache.
 */
function bgVerifyWallet(inboxId: string, walletAddress: string): void {
  const cached = _verifiedWallets.get(walletAddress);
  if (cached === true) return;
  if (cached === false) {
    cacheProfile(inboxId, { nftImage: null });
    return;
  }
  verifyNFTOwnership(walletAddress)
    .then((result) => {
      // LRU: delete-then-set moves entry to end of insertion order
      _verifiedWallets.delete(walletAddress);
      _verifiedWallets.set(walletAddress, result.verified);
      // Evict oldest when over cap
      if (_verifiedWallets.size > MAX_VERIFIED_WALLETS) {
        const oldest = _verifiedWallets.keys().next().value;
        if (oldest) _verifiedWallets.delete(oldest);
      }
      if (!result.verified) {
        console.warn(`[XMTP] Wallet ${walletAddress.slice(0, 8)}… for ${inboxId.slice(0, 8)}… has no Saga Monke — clearing PFP`);
        cacheProfile(inboxId, { nftImage: null });
      }
    })
    .catch(() => {
      // Network error — leave image for now, re-check on next update
    });
}

/**
 * Bidirectional sync between message senderNft and profile cache.
 * - If message has senderNft.image but cache doesn't, seed the cache (validated).
 * - If message has no senderNft but cache has nftImage, fill it in.
 */
function enrichWithNft(msg: ChatMessage): ChatMessage {
  const cached = getCachedProfile(msg.senderAddress);
  // Seed cache from message if we have a valid image not yet cached
  if (msg.senderNft?.image && !cached?.nftImage && isValidNftImage(msg.senderNft.image)) {
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
    if (_initRunning) return;
    _initRunning = true;
    if (__DEV__) console.log("[XMTP] initialize() called");
    setLoading(true);
    setError(null);

    try {
      // Load caches in background — don't block XMTP client boot
      // loadAllTimeUsers seeds from profileCache, so it must run after loadProfileCache
      const cacheReady = loadProfileCache().then(() => Promise.all([loadAllTimeUsers(), loadWeeklyActivity()]));

      // ── 1. Boot XMTP client (uses prefetched if available) ─────────────────
      const client = await getOrInitXmtpClient();

      // Ensure caches are loaded before we start processing messages
      await cacheReady;
      if (__DEV__) console.log("[XMTP] client inboxId:", client.inboxId);
      _client = client;
      setXmtpClient(client as unknown as null);
      setMyInboxId(client.inboxId);
      _myInboxId = client.inboxId;

      // Seed own profile into the cache so PFP shows immediately for own messages
      const { wallet, username: ownUsername, verifiedNft: ownNft } = useAppStore.getState();
      cacheProfile(client.inboxId, {
        username: ownUsername ?? undefined,
        nftImage: ownNft?.image ?? null,
      });

      // ── 1b. Save wallet ↔ chat ID ↔ NFT binding ────────────────────────────
      if (wallet?.address && ownNft?.mint) {
        const binding: WalletBinding = {
          walletAddress: wallet.address,
          inboxId: client.inboxId,
          nftMint: ownNft.mint,
          nftName: ownNft.name ?? '',
          verifiedAt: Date.now(),
        };
        saveWalletBinding(binding).catch(() => {});
        if (__DEV__) console.log("[XMTP] Wallet binding saved:", wallet.address.slice(0, 8), "→", client.inboxId.slice(0, 12));
      }

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
      if (__DEV__) console.log("[XMTP] remote config:", config);

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
        if (__DEV__) console.log("[XMTP] You are the admin (new). Group ID:", (group as any)?.id);
      }

      // ── Admin: ensure bot channels exist & publish config ───────────────
      const isAdmin =
        storedAdmin === "1" ||
        isNewAdmin ||
        !!(config.adminInboxId && config.adminInboxId === client.inboxId);
      if (isAdmin && group) {
        if (__DEV__) console.log("[XMTP] Admin detected — checking bot channels…");
        const mainGroupId = (group as any)?.id ?? config.globalGroupId;
        setRemoteGroupId(mainGroupId);

        // Create any missing bot channels
        const existingBotIds = useAppStore.getState().botChannelIds ?? {} as any;
        const channelDefs = [
          { key: "bets", name: "Monke Bets" },
          { key: "trades", name: "Monke Trades" },
          { key: "sales", name: "Monke Sales" },
          { key: "predictions", name: "Monke Predictions" },
        ] as const;
        const botChannels: Record<string, string> = { ...existingBotIds };
        let botChannelsChanged = false;
        for (const ch of channelDefs) {
          if (botChannels[ch.key]) continue; // already have it
          try {
            const chGroup = await client.conversations.newGroup([], {
              permissionLevel: "all_members",
              name: ch.name,
            });
            botChannels[ch.key] = (chGroup as any).id ?? "";
            botChannelsChanged = true;
            if (__DEV__) console.log(`[XMTP] Created missing bot channel "${ch.name}":`, botChannels[ch.key]);
          } catch (chErr) {
            if (__DEV__) console.warn(`[XMTP] Failed to create bot channel "${ch.name}":`, chErr);
          }
        }
        if (botChannelsChanged) {
          useAppStore.getState().setBotChannelIds(botChannels as any);
        }

        // Ensure bot is a member of all groups (main + channels)
        // Bot inbox ID from remote config (fallback to hardcoded for offline startup)
        const BOT_INBOX = config?.botInboxId ?? "998001a498174b8a194110ee792b10f97de4965665eaf0d088ed2c71bdf62363";
        const BOT_INBOXES = [BOT_INBOX];
        const allGroupsToCheck = [
          { name: "main", ref: group },
          ...channelDefs.map(ch => ({
            name: ch.name,
            ref: null as any, // will find below
          })),
        ];
        // Add bots to main group
        for (const botId of BOT_INBOXES) {
          try {
            await (group as any).addMembers([botId]);
            if (__DEV__) console.log(`[XMTP] Added ${botId.slice(0, 8)}… to main group`);
          } catch { /* already a member */ }
        }
        // Add bots to each bot channel
        for (const ch of channelDefs) {
          const chId = botChannels[ch.key];
          if (!chId) continue;
          try {
            const chGroup = await client.conversations.findGroup(chId as any);
            if (chGroup) {
              for (const botId of BOT_INBOXES) {
                try {
                  await (chGroup as any).addMembers([botId]);
                  if (__DEV__) console.log(`[XMTP] Added ${botId.slice(0, 8)}… to ${ch.name}`);
                } catch { /* already a member */ }
              }
            }
          } catch { /* find failed */ }
        }

        // Auto-publish config if admin token is saved and bot channels were just created
        if (botChannelsChanged || isNewAdmin) {
          try {
            const token = await getAdminToken();
            if (token) {
              await publishAppConfig({
                globalGroupId: mainGroupId,
                adminInboxId: client.inboxId,
                botChannels: botChannels as any,
              });
              if (__DEV__) console.log("[XMTP] Auto-published config (with bot channels) to GitHub.");
            }
          } catch (err) {
            if (__DEV__) console.warn("[XMTP] Auto-publish failed:", err);
          }
        }
      }

      // ── Auto-approve all pending join requests (admin) ───────────────────
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
            const notifiedRaw = await AsyncStorage.getItem(AK_NOTIFIED_IDS);
            const notifiedSet = new Set<string>(
              notifiedRaw ? JSON.parse(notifiedRaw) : []
            );
            const newRequests = requests.filter((r) => !approvedSet.has(r.inboxId));

            if (newRequests.length > 0) {
              // Update badge so admin sees how many are waiting.
              setJoinRequests(newRequests);

              // Notify admin only about users we have never notified for before.
              // Persist notifiedSet immediately so a crash mid-loop still suppresses
              // the duplicate alert on next initialize(). One notification per
              // user, personalized with their chosen @username (cached profile
              // fallback when the join request payload doesn't include it).
              const toNotify = newRequests.filter((r) => !notifiedSet.has(r.inboxId));
              if (toNotify.length > 0) {
                for (const r of toNotify) notifiedSet.add(r.inboxId);
                await AsyncStorage.setItem(
                  AK_NOTIFIED_IDS,
                  JSON.stringify([...notifiedSet])
                );
                for (const r of toNotify) {
                  const cached = getCachedProfile(r.inboxId);
                  const handle = r.username || cached?.username;
                  const title = handle
                    ? `🍌 @${handle} joined chat`
                    : `🍌 New Monke joined chat`;
                  await showLocalNotification(title, "Tap to open OnlyMonkes");
                }
              }

              // Auto-approve each new request.
              // NFT holders are admitted immediately; others are added normally.
              // Only mark as approved if addMemberToGroup actually succeeds.
              for (const req of newRequests) {
                try {
                  // NFT gate: verify the mint belongs to the Saga Monkes collection.
                  if (req.nftMint) {
                    const validNft = await verifyNftMintInCollection(req.nftMint);
                    if (!validNft) {
                      if (__DEV__) console.log("[XMTP] NFT verification failed for", req.inboxId, "— skipping auto-approve");
                      continue;
                    }
                    if (__DEV__) console.log("[XMTP] NFT verified for", req.inboxId, "— auto-admitting");
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
                          if (__DEV__) console.log(`[XMTP] Added ${req.inboxId.slice(0, 8)}… to ${name} channel`);
                        }
                      } catch { /* already a member or non-critical */ }
                    }
                  }

                  approvedSet.add(req.inboxId);
                  useAppStore.getState().removeJoinRequest(req.inboxId);
                  if (__DEV__) console.log("[XMTP] Auto-approved:", req.inboxId);
                } catch (approveErr) {
                  if (__DEV__) console.warn("[XMTP] Failed to auto-approve", req.inboxId, approveErr);
                  // Do NOT add to approvedSet — leave visible in admin panel for manual action.
                }
              }

              // Persist updated approved set.
              await AsyncStorage.setItem(
                AK_APPROVED_IDS,
                JSON.stringify([...approvedSet])
              );
              if (__DEV__) console.log(`[XMTP] Auto-approved ${newRequests.length} join request(s).`);
            }
          } catch (err) {
            if (__DEV__) console.warn("[XMTP] Auto-approve failed:", err);
          }
        })();
      }

      if (!group) {
        // Remote config has a group ID, but this user is not yet a member.

        // ── Admin self-heal: if this device was admin, create all groups ──
        const storedAdminFlag = await AsyncStorage.getItem(AK_IS_ADMIN);
        const isAdminByConfig = config.adminInboxId === client.inboxId;
        if (storedAdminFlag === "1" || isAdminByConfig) {
          if (__DEV__) console.log("[XMTP] Admin device cannot find group — recreating all channels…");
          try {
            // Create main chat group
            const newGroup = await client.conversations.newGroup([], {
              permissionLevel: "all_members",
              name: "OnlyMonkes Global Chat",
            });
            const newGroupId = (newGroup as any).id ?? "";
            if (__DEV__) console.log("[XMTP] Main group created:", newGroupId);
            setRemoteGroupId(newGroupId);
            _group = newGroup as unknown as XmtpGroup;

            // Create all 4 bot channel groups
            const channelNames = [
              { key: "bets", name: "Monke Bets" },
              { key: "trades", name: "Monke Trades" },
              { key: "sales", name: "Monke Sales" },
              { key: "predictions", name: "Monke Predictions" },
            ] as const;
            const botChannels: Record<string, string> = {};
            for (const ch of channelNames) {
              const chGroup = await client.conversations.newGroup([], {
                permissionLevel: "all_members",
                name: ch.name,
              });
              botChannels[ch.key] = (chGroup as any).id ?? "";
              if (__DEV__) console.log(`[XMTP] Bot channel "${ch.name}" created:`, botChannels[ch.key]);
            }

            // Store bot channel IDs in app state
            useAppStore.getState().setBotChannelIds(botChannels as any);

            // Publish full config (main group + bot channels) to GitHub
            try {
              const token = await getAdminToken();
              if (token) {
                await publishAppConfig({
                  globalGroupId: newGroupId,
                  adminInboxId: client.inboxId,
                  botChannels: botChannels as any,
                });
                if (__DEV__) console.log("[XMTP] Auto-published full config to GitHub.");
              }
            } catch (pubErr) {
              if (__DEV__) console.warn("[XMTP] Could not auto-publish config:", pubErr);
            }

            await AsyncStorage.setItem(AK_IS_ADMIN, "1");
            setIsGroupAdmin(true);
            setIsGroupMember(true);
            // Fall through to load message history (group is now set)
          } catch (createErr) {
            if (__DEV__) console.warn("[XMTP] Admin group recreation failed:", createErr);
            setIsGroupMember(false);
            setLoading(false);
            return;
          }
        } else {
          // Non-admin: send join request DM and wait for bot/admin to approve
          setIsGroupMember(false);

          if (config.adminInboxId) {
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
                if (__DEV__) console.log("[XMTP] Join request DM sent to bot (nft:", verifiedNft?.mint ?? "none", ")");
              } catch (err) {
                if (__DEV__) console.warn("[XMTP] Could not send join request DM:", err);
              }
            }
          }

          setLoading(false);
          return;
        }
      }

      // ── 4. Load message history ────────────────────────────────────────────
      // Use _group (module-level) which is set by both normal path and admin self-heal
      const activeGroup = _group!;
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
      await withTimeout((activeGroup as any).sync(), 15_000, "group.sync");
      try { await withTimeout(client.conversations.syncAllConversations(["allowed", "unknown"] as any), 15_000, "syncAll"); } catch { /* ignore */ }
      // Fetch only last 24 hours of messages — reduced from 48h to cut PRESENCE
      // heartbeat flood in half (~50% fewer messages to decode on startup).
      const ONE_DAY_NS = 24 * 60 * 60 * 1_000_000_000;
      const afterNs = (Date.now() * 1_000_000) - ONE_DAY_NS;
      const rawHistory: any[] = await (activeGroup as any).messages({ afterNs });

      // ── Helper: seed profile cache + events from raw messages ────────────
      const seedProfilesAndEvents = async (raws: any[]) => {
        // Iterate oldest-first so later (newer) PROFILE_UPDATEs win.
        for (const raw of [...raws].reverse()) {
          try {
            let content = raw.content();
            // Normalize: XMTP SDK may return { text: "..." } instead of raw string
            if (content && typeof content === "object" && typeof (content as any).text === "string") {
              content = (content as any).text;
            }
            if (typeof content === "string" && content.startsWith("PROFILE_UPDATE:")) {
              const profile = parseProfileUpdate(content);
              if (profile) {
                const nftImage = isValidNftImage(profile.nftImage) ? profile.nftImage : null;
                cacheProfile(profile.id, { username: profile.username, bio: profile.bio, xAccount: profile.xAccount, walletAddress: profile.walletAddress, tipWallet: profile.tipWallet, location: profile.location, nftImage, legendary: profile.legendary, pushToken: profile.pushToken, expoPushToken: profile.expoPushToken, badges: profile.badges, shopStyles: profile.shopStyles, statusMessage: profile.statusMessage });
                trackUser(profile.id, profile.username);
                // Cross-device sync: same wallet, different device → merge banana + shop
                const isRemote = profile.id !== _myInboxId;
                if (profile.walletAddress && isRemote) {
                  const myWallet = useAppStore.getState().wallet?.address;
                  if (myWallet && profile.walletAddress === myWallet) {
                    (async () => {
                      try {
                        if (profile.bananaBalance != null) {
                          const newBal = await mergeBananaBalance(profile.bananaBalance);
                          useAppStore.getState().setBananaBalance(newBal);
                        }
                        if (profile.shopOwned?.length) {
                          const changed = await mergeOwnedItems(profile.shopOwned, profile.pfpBindings);
                          if (changed) {
                            const styles = await getEquippedStyles();
                            useAppStore.getState().setShopStyles(styles);
                          }
                        }
                      } catch { /* non-critical */ }
                    })();
                  }
                }
              }
            } else if (typeof content === "string" && content.startsWith("EVENT:")) {
              try {
                const event = parseEventMessage(content);
                if (event) await saveEvent(event);
              } catch { /* ignore */ }
            } else if (typeof content === "string" && content.startsWith("LOCATION_SYNC:")) {
              // Bot broadcasts all known user locations every 12h
              try {
                const locs = JSON.parse(content.slice("LOCATION_SYNC:".length));
                for (const [inboxId, data] of Object.entries(locs)) {
                  const d = data as { u?: string; loc?: string; ni?: string };
                  if (d.loc) {
                    cacheProfile(inboxId, {
                      username: d.u || undefined,
                      location: d.loc,
                      nftImage: d.ni || undefined,
                    });
                  }
                }
                if (__DEV__) console.log(`[XMTP] Location sync: updated ${Object.keys(locs).length} users`);
              } catch { /* ignore */ }
            } else if (typeof content === "string" && content.startsWith("RSVP:")) {
              processRsvpMessage(content).catch(() => {});
            } else if (typeof content === "string" && (
              content.startsWith("NFT_LIST:") || content.startsWith("NFT_BID:") ||
              content.startsWith("NFT_OFFER:") || content.startsWith("NFT_ACCEPT:") ||
              content.startsWith("NFT_DELIST:") || content.startsWith("NFT_SWAP:") ||
              content.startsWith("NFT_COMPLETE:")
            )) {
              const market = parseMarketplaceMessage(content);
              if (market) {
                switch (market.type) {
                  case 'list': addListing(market.data); break;
                  case 'bid': addBid(market.data); break;
                  case 'accept': markSold(market.data.listingId); break;
                  case 'delist': delistNft(market.data.listingId); break;
                  case 'complete': markSold(market.data.listingId); break;
                  default: break;
                }
              }
            } else if (typeof content === "string" && content.startsWith("LIVE_ROOM:")) {
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
            }
          } catch { /* skip */ }
        }
      };

      // ── Helper: check if raw content is a reaction (native or legacy) ──
      const isReactionContent = (content: unknown): boolean => {
        if (typeof content === "string") return content.startsWith("REACT:");
        if (content && typeof content === "object") return !!((content as any).reaction || (content as any).reactionV2);
        return false;
      };

      const getReactionTargetId = (content: unknown): string => {
        if (typeof content === "string" && content.startsWith("REACT:")) return content.split(":")[2] ?? "";
        if (content && typeof content === "object") {
          const r = (content as any).reaction ?? (content as any).reactionV2;
          if (r) return r.reference ?? "";
        }
        return "";
      };

      // ── Helper: decode messages + apply reactions/edits ────────────────
      const decodeAndEnrich = (raws: any[]): ChatMessage[] => {
        // Separate content messages from reactions/edits to avoid O(n²) re-scan
        const contentRaws: any[] = [];
        const reactionRaws: any[] = [];
        for (const raw of raws) {
          try {
            const content = raw.content();
            // Native or legacy reaction
            if (isReactionContent(content)) {
              reactionRaws.push(raw);
              trackActivity(raw.senderInboxId as string, 'given');
              continue;
            }
            // Legacy sticker reaction / edit (still string-based)
            if (typeof content === "string") {
              if (content.startsWith("STICKER_REACT:") || content.startsWith("EDIT:")) {
                reactionRaws.push(raw);
                continue;
              }
            }
            contentRaws.push(raw);
          } catch { /* skip */ }
        }

        // Process banana grants from history (deduped by message ID)
        for (const raw of contentRaws) {
          try {
            const c = raw.content();
            if (typeof c === "string" && c.startsWith("BANANA_GRANT:")) {
              processBananaGrant(raw.id as string, c, raw.senderInboxId as string, _myInboxId, false).catch(() => {});
            }
          } catch { /* skip */ }
        }

        // Process gift items from history (recipient may have been offline when sent)
        for (const raw of contentRaws) {
          try {
            const c = raw.content();
            if (typeof c === "string" && c.startsWith("GIFT_ITEM:")) {
              const payload = JSON.parse(c.slice("GIFT_ITEM:".length));
              const { recipientInboxId, itemId } = payload as { recipientInboxId: string; itemId: string };
              if (recipientInboxId === _myInboxId) {
                // Fire-and-forget — async but non-blocking for history decode
                (async () => {
                  try {
                    await addOwnedItem(itemId);
                    await equipItem(itemId);
                    const styles = await getEquippedStyles();
                    useAppStore.getState().setShopStyles(styles);
                    applyThemeFromShop(styles);
                  } catch { /* skip */ }
                })();
              }
            }
          } catch { /* skip */ }
        }

        // Decode only content messages (skip system prefixes like TYPING, PRESENCE, etc.)
        let decoded = contentRaws
          .map((m) => decodeMessage(m, _myInboxId))
          .filter(Boolean) as ChatMessage[];

        // Resolve native reply targets (fill in replyTo.content from referenced messages)
        decoded = resolveReplyTargets(decoded);

        // Build sender map for activity tracking
        const _msgSenderMap = new Map<string, string>(decoded.map(m => [m.id, m.senderAddress]));

        // Track reaction targets
        for (const raw of reactionRaws) {
          try {
            const content = raw.content();
            const targetId = getReactionTargetId(content);
            if (targetId) {
              const targetSender = _msgSenderMap.get(targetId);
              if (targetSender) trackActivity(targetSender, 'received');
            }
          } catch { /* skip */ }
        }

        // Trim to most recent 150 BEFORE applying reactions (big perf win)
        // rawHistory arrives newest-first from XMTP, so decoded is also newest-first.
        // slice(0, 150) keeps the 150 newest, then reverse for oldest-first processing.
        decoded = decoded.slice(0, 150);
        decoded.reverse();
        const recentIds = new Set(decoded.map(m => m.id));

        // Apply reactions/edits only to the 50 visible messages
        for (const raw of reactionRaws) {
          try {
            const content = raw.content();
            if (isReactionContent(content)) {
              decoded = applyReaction(decoded, raw, _myInboxId);
            } else if (typeof content === "string" && content.startsWith("STICKER_REACT:")) {
              decoded = applyStickerReaction(decoded, raw, _myInboxId);
            } else if (typeof content === "string" && content.startsWith("EDIT:")) {
              decoded = applyEdit(decoded, raw);
            }
          } catch { /* skip */ }
        }

        for (const msg of decoded) {
          trackUser(msg.senderAddress, msg.senderUsername);
          trackActivity(msg.senderAddress, 'sent');
        }

        return decoded.map(enrichWithNft).reverse();
      };

      // ── Seed profiles + decode all 50 messages ──────────────────────────
      await seedProfilesAndEvents(rawHistory);
      const recentMessages = decodeAndEnrich(rawHistory);
      // Ensure oldest-first order for inverted FlatList (index 0 = top, last = bottom)
      recentMessages.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

      if (recentMessages.length > 0) {
        // Merge with existing messages (cached + stream) instead of replacing.
        // This prevents older messages from disappearing when history only
        // covers last 24h / 50 messages.
        // Replace messages entirely with history (authoritative source)
        // but preserve any optimistic messages that haven't been confirmed yet
        const existing = useChatStore.getState().messages;
        const historyIds = new Set(recentMessages.map(m => m.id));
        // Keep optimistic messages (opt-*) that aren't in history yet
        const pendingOptimistic = existing.filter(m =>
          m.id.startsWith("opt-") && m.status !== "sent"
        );
        const merged = [...recentMessages, ...pendingOptimistic];
        merged.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
        setMessages(merged);
      }
      // If network returned 0 visible messages, keep the cached set already
      // loaded at line 553 — don't overwrite with empty array.
      setLoadingHistory(false); // UI is ready

      // ── Reconstruct pinned messages from history ──────────────────────────
      // PIN/UNPIN system messages in history must be replayed so all users see
      // the same pinned state (not just the device that originally pinned).
      try {
        // Collect PIN actions and the message IDs they target
        const pinActions: { messageId: string; action: 'pin' | 'unpin'; sender: string }[] = [];
        const targetIds = new Set<string>();
        for (const raw of [...rawHistory].reverse()) {
          try {
            const content = raw.content();
            if (typeof content === "string" && content.startsWith("PIN:")) {
              const pin = parsePinMessage(content);
              if (pin) {
                pinActions.push({ ...pin, sender: raw.senderInboxId as string });
                if (pin.action === "pin") targetIds.add(pin.messageId);
              }
            }
          } catch { /* skip */ }
        }
        // Only decode the specific messages that were pinned (not all 3000)
        if (pinActions.length > 0) {
          const msgById = new Map<string, ChatMessage>();
          if (targetIds.size > 0) {
            for (const raw of rawHistory) {
              try {
                if (targetIds.has(raw.id)) {
                  const decoded = decodeMessage(raw, _myInboxId);
                  if (decoded) msgById.set(decoded.id, decoded);
                }
              } catch { /* skip */ }
            }
          }
          for (const pa of pinActions) {
            if (pa.action === "pin") {
              const target = msgById.get(pa.messageId);
              if (target) await pinMessage(target, pa.sender);
            } else {
              await unpinMessage(pa.messageId);
            }
          }
        }
      } catch { /* non-critical */ }

      // Persist to cache (capped at 50 by messageCache)
      if (recentMessages.length > 0) {
        saveCachedMessages("main_chat", recentMessages).catch(e => { if (__DEV__) console.warn("[XMTP] cache save failed:", e); });
      }

      // ── 5. Stream incoming messages ────────────────────────────────────────
      _unsubscribeStream?.();
      _botChannelUnsubs.forEach(u => u());
      _botChannelUnsubs = [];
      _streamAlive = false;

      const unsub = await (activeGroup as any).streamMessages(async (raw: any) => {
        // Stream is healthy — we just received a message. Mark alive even if
        // the content fails to decode below; that's a per-message issue, not
        // a stream-level failure.
        _streamAlive = true;
        _lastStreamEvent = Date.now();
        let content: unknown;
        try {
          content = raw.content();
          // Normalize: XMTP SDK may return { text: "..." } object instead of raw string
          if (content && typeof content === "object" && typeof (content as any).text === "string") {
            content = (content as any).text;
          }
        } catch {
          return;
        }
        // Top-level error boundary — prevents stream crash from killing all message processing
        try {

        // Native or legacy reaction
        if (isReactionContent(content)) {
          const targetId = getReactionTargetId(content);
          trackActivity(raw.senderInboxId as string, 'given');
          const { messages } = useChatStore.getState();
          if (targetId) {
            const targetMsg = messages.find(m => m.id === targetId);
            if (targetMsg) trackActivity(targetMsg.senderAddress, 'received');
          }
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

        if (typeof content === "string" && content.startsWith("EDIT:")) {
          const { messages } = useChatStore.getState();
          const updated = applyEdit(messages, raw);
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
            setTypingTimeout(
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
          const profile = parseProfileUpdate(content);
          if (profile) {
            // Remote users must provide nftMint for PFP verification
            const isRemote = profile.id !== _myInboxId;
            const nftImage = isValidNftImage(profile.nftImage)
              ? (isRemote && !profile.nftMint ? null : profile.nftImage)
              : null;
            cacheProfile(profile.id, { username: profile.username, bio: profile.bio, xAccount: profile.xAccount, walletAddress: profile.walletAddress, tipWallet: profile.tipWallet, location: profile.location, nftImage, legendary: profile.legendary, pushToken: profile.pushToken, expoPushToken: profile.expoPushToken, badges: profile.badges, shopStyles: profile.shopStyles, statusMessage: profile.statusMessage });
            // Background-verify NFT mint belongs to Saga Monkes collection
            if (nftImage && profile.nftMint && isRemote) {
              verifyNftMintInCollection(profile.nftMint).then((valid) => {
                if (!valid) cacheProfile(profile.id, { nftImage: null });
              }).catch(() => {});
            }
            trackUser(profile.id, profile.username);
            // Cross-device sync: same wallet, different device → merge banana + shop
            if (profile.walletAddress && isRemote) {
              const myWallet = useAppStore.getState().wallet?.address;
              if (myWallet && profile.walletAddress === myWallet) {
                (async () => {
                  try {
                    if (profile.bananaBalance != null) {
                      const newBal = await mergeBananaBalance(profile.bananaBalance);
                      useAppStore.getState().setBananaBalance(newBal);
                    }
                    if (profile.shopOwned?.length) {
                      const changed = await mergeOwnedItems(profile.shopOwned, profile.pfpBindings);
                      if (changed) {
                        const styles = await getEquippedStyles();
                        useAppStore.getState().setShopStyles(styles);
                      }
                    }
                  } catch { /* non-critical */ }
                })();
              }
            }
          }
          return;
        }

        // ── GIFT_ITEM — admin grants a shop item to a specific user ────────
        if (typeof content === "string" && content.startsWith("GIFT_ITEM:")) {
          try {
            const payload = JSON.parse(content.slice("GIFT_ITEM:".length));
            const { recipientInboxId, itemId, from } = payload as { recipientInboxId: string; itemId: string; from?: string };
            if (recipientInboxId === _myInboxId) {
              const { addOwnedItem, equipItem: equipShopItem, getEquippedStyles: getStyles } = await import("@/lib/bananaShop");
              const { applyThemeFromShop } = await import("@/lib/shopTheme");
              await addOwnedItem(itemId);
              await equipShopItem(itemId);
              const styles = await getStyles();
              useAppStore.getState().setShopStyles(styles);
              applyThemeFromShop(styles);
              const itemName = itemId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
              const { Alert } = require("react-native");
              Alert.alert("Gift Received!", `${from ?? "Admin"} gifted you: ${itemName}`);
              if (__DEV__) console.log(`[GIFT] Received ${itemId} from ${from ?? "unknown"}`);
            }
          } catch (e) { if (__DEV__) console.warn("[GIFT] Failed to process gift:", e); }
          return;
        }

        if (typeof content === "string" && content.startsWith("LOCATION_SYNC:")) {
          try {
            const locs = JSON.parse(content.slice("LOCATION_SYNC:".length));
            for (const [inboxId, data] of Object.entries(locs)) {
              const d = data as { u?: string; loc?: string; ni?: string };
              if (d.loc) cacheProfile(inboxId, { username: d.u || undefined, location: d.loc, nftImage: d.ni || undefined });
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
              useAppStore.getState().incrementCommunityBadge('events');
            }
          } catch { /* ignore */ }
          return;
        }

        // ── Pinned messages ──────────────────────────────────────────────────
        if (typeof content === "string" && content.startsWith("PIN:")) {
          const pin = parsePinMessage(content);
          if (pin) {
            if (pin.action === 'pin') {
              const { messages } = useChatStore.getState();
              const target = messages.find(m => m.id === pin.messageId);
              if (target) {
                await pinMessage(target, raw.senderInboxId as string);
              }
            } else {
              await unpinMessage(pin.messageId);
            }
          }
          return;
        }

        // ── Presence heartbeat ──────────────────────────────────────────────
        if (typeof content === "string" && content.startsWith("PRESENCE:")) {
          const presence = parsePresenceMessage(content);
          if (presence) updatePresence(presence.inboxId, presence.timestamp);
          return;
        }

        // ── Banana grant (bot → users, deduped) ────────────────────────────
        if (typeof content === "string" && content.startsWith("BANANA_GRANT:")) {
          processBananaGrant(raw.id as string, content, raw.senderInboxId as string, _myInboxId, true).catch(() => {});
          return;
        }

        // ── Event RSVP ──────────────────────────────────────────────────────
        if (typeof content === "string" && content.startsWith("RSVP:")) {
          processRsvpMessage(content).catch(() => {});
          return;
        }

        // ── Thread replies ──────────────────────────────────────────────────
        if (typeof content === "string" && content.startsWith("THREAD:")) {
          const thread = parseThreadMessage(content);
          if (thread) {
            const { messages, addThreadMessage } = useChatStore.getState();
            const parent = messages.find(m => m.id === thread.parentMessageId);
            trackThreadReply(
              thread.parentMessageId,
              raw.senderInboxId as string,
              parent?.content,
              parent?.senderUsername,
            );
            // Store thread reply as a ChatMessage so ThreadScreen can display it
            const threadMsg: ChatMessage = {
              id: raw.id as string,
              senderAddress: raw.senderInboxId as string,
              senderUsername: thread.username,
              content: thread.content,
              sentAt: raw.sentAtNs ? new Date(Number(raw.sentAtNs) / 1_000_000) : new Date(),
              reactions: {},
              status: 'sent',
            };
            addThreadMessage(thread.parentMessageId, threadMsg);
          }
          return;
        }

        // ── NFT Marketplace messages ────────────────────────────────────────
        if (typeof content === "string" && (
          content.startsWith("NFT_LIST:") || content.startsWith("NFT_BID:") ||
          content.startsWith("NFT_ACCEPT:") || content.startsWith("NFT_DELIST:") ||
          content.startsWith("NFT_SWAP:") || content.startsWith("NFT_COMPLETE:")
        )) {
          const market = parseMarketplaceMessage(content);
          if (market) {
            switch (market.type) {
              case 'list': addListing(market.data); break;
              case 'bid': {
                addBid(market.data);
                // Notify seller if someone bids on their listing
                const bidListing = getListingById(market.data.listingId);
                if (bidListing && bidListing.sellerInboxId === _myInboxId) {
                  showLocalNotification(
                    'New Bid',
                    `${market.data.bidderUsername ?? 'Someone'} bid ${market.data.bidPrice} SOL on ${bidListing.name}`,
                    CH_MARKET,
                  );
                }
                break;
              }
              case 'accept': {
                // Seller accepted a bid — mark listing as pending_swap
                const listing = getListingById(market.data.listingId);
                const bids = getBidsForListing(market.data.listingId);
                const acceptedBid = bids.find((b: any) => b.bidderInboxId === market.data.bidderInboxId);
                if (listing && acceptedBid) {
                  markPendingSwap(market.data.listingId, acceptedBid);
                } else {
                  markSold(market.data.listingId);
                }
                break;
              }
              case 'delist': delistNft(market.data.listingId); break;
              case 'swap': {
                // Swap tx addressed to me — show buyer confirmation
                const swap = market.data as NftSwapMessage;
                if (swap.buyerInboxId === _myInboxId) {
                  useAppStore.getState().setPendingNftSwap(swap);
                  const listing = getListingById(swap.listingId);
                  showLocalNotification(
                    'NFT Swap Ready',
                    `${listing?.sellerUsername ?? 'Seller'} signed the swap for ${listing?.name ?? 'NFT'} (${swap.solPrice} SOL). Open MonkeMarkets to complete.`,
                    CH_MARKET,
                  );
                }
                break;
              }
              case 'complete': {
                // Trade completed on-chain — mark listing sold
                markSold(market.data.listingId);
                break;
              }
            }
          }
          return;
        }

        // ── Video room signaling ────────────────────────────────────────────
        if (typeof content === "string" && content.startsWith("VIDEO_ROOM:")) {
          try {
            const data = parseVideoRoomMessage(content);
            if (data) {
              if (data.active) {
                useAppStore.getState().setActiveVideoRoom(data);
                // Inject a visible pill message so users see who started the call
                const pillMsg: ChatMessage = {
                  id: `videopill-${data.id}`,
                  senderAddress: raw.senderInboxId as string,
                  senderUsername: data.host,
                  content: `LIVE_PILL:video:${data.host}:${data.id}`,
                  sentAt: new Date(raw.sentNs / 1_000_000),
                  reactions: {},
                  status: "sent",
                };
                mergeMessage(enrichWithNft(pillMsg));
              } else {
                const current = useAppStore.getState().activeVideoRoom;
                if (current?.id === data.id) useAppStore.getState().setActiveVideoRoom(null);
              }
            }
          } catch { /* ignore */ }
          return;
        }

        if (typeof content === "string" && content.startsWith("AVATAR_ROOM:")) {
          try {
            const data = parseAvatarRoomMessage(content);
            if (data) {
              if (data.active) {
                useAppStore.getState().setActiveAvatarRoom(data);
                const pillMsg: ChatMessage = {
                  id: `avatarpill-${data.id}`,
                  senderAddress: raw.senderInboxId as string,
                  senderUsername: data.host,
                  content: `LIVE_PILL:avatar:${data.host}:${data.id}`,
                  sentAt: new Date(raw.sentNs / 1_000_000),
                  reactions: {},
                  status: "sent",
                };
                mergeMessage(enrichWithNft(pillMsg));
              } else {
                const current = useAppStore.getState().activeAvatarRoom;
                if (current?.id === data.id) useAppStore.getState().setActiveAvatarRoom(null);
              }
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
                // Inject a visible pill message so users see who started the room
                const pillMsg: ChatMessage = {
                  id: `livepill-${data.id}`,
                  senderAddress: raw.senderInboxId as string,
                  senderUsername: data.host,
                  content: `LIVE_PILL:audio:${data.host}:${data.id}`,
                  sentAt: new Date(raw.sentNs / 1_000_000),
                  reactions: {},
                  status: "sent",
                };
                mergeMessage(enrichWithNft(pillMsg));
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

        // Resolve native reply target from existing messages in store
        if (msg.replyTo?.id && !msg.replyTo.content) {
          const { messages: existing } = useChatStore.getState();
          const target = existing.find(m => m.id === msg.replyTo!.id);
          if (target) {
            msg.replyTo = {
              ...msg.replyTo,
              senderAddress: target.senderAddress,
              senderUsername: target.senderUsername,
              content: target.content,
            };
          }
        }

        // Record every sender in the all-time registry + activity
        trackUser(msg.senderAddress, msg.senderUsername);
        trackActivity(msg.senderAddress, 'sent');

        // Skip own messages — already shown as optimistic bubbles
        if (msg.senderAddress === _myInboxId) return;

        const enrichedMsg = enrichWithNft(msg);
        mergeMessage(enrichedMsg);

        // Increment links badge if message contains a URL
        if (/https?:\/\/[^\s"'<>)]+/.test(msg.content)) {
          useAppStore.getState().incrementCommunityBadge('links');
        }

        // Persist to cache for Shared Images/Links
        appendCachedMessage("main_chat", enrichedMsg).catch(e => { if (__DEV__) console.warn("[XMTP] cache append failed:", e); });

        const { notificationsEnabled, mentionsOnly, botNotificationsEnabled, username } =
          useAppStore.getState();

        const senderLabel = msg.senderUsername ?? msg.senderAddress.slice(0, 6);
        const isBotMessage = msg.senderUsername === BOT_USERNAME;

        // Show heads-up notification for all incoming messages.
        // DirectNotif native module posts directly to the Android channel,
        // bypassing expo's groupKey=silent interception — works in foreground.
        if (isBotMessage) {
          // Bot messages get FCM push from the server — no local notification needed.
          // Local was causing duplicate pushes (FCM + local for same message).
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
        } catch (streamErr) {
          if (__DEV__) console.warn("[XMTP] Stream handler error:", (streamErr as Error).message);
        }
      });

      _streamAlive = true;
      _lastStreamEvent = Date.now();
      _unsubscribeStream = () => { _streamAlive = false; unsub(); };

      // ── 5b. Start presence heartbeat ─────────────────────────────────────
      const { startHeartbeat } = require("@/lib/presence");
      startHeartbeat(() => {
        if (_group && _myInboxId) {
          const msg = buildPresenceMessage(_myInboxId);
          (_group as any).send(msg).catch((e: any) => { if (__DEV__) console.warn("[XMTP] presence send failed:", e); });
        }
      });

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
              mutedBotChannels, mutedSports, shopStyles: currentShopStyles,
              location,
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
            if (__DEV__) console.log('[XMTP] Profile broadcast, FCM token:', pushToken ? pushToken.slice(0, 30) + '…' : 'none',
              'Expo token:', expoPushToken ? expoPushToken.slice(0, 40) + '…' : 'none');
            const [bananaState, shopState] = await Promise.all([loadBananaState(), loadShopState()]);
            await sendProfileUpdate(
              group as XmtpGroup,
              client.inboxId,
              username,
              bio,
              xAccount,
              wallet?.address ?? null,
              tipWallet ?? null,
              verifiedNft?.image ?? null,
              verifiedNft?.mint ?? null,
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
              location ?? undefined,
              getEarnedBadges(),
              Object.keys(currentShopStyles).length > 0 ? currentShopStyles : null,
              bananaState.balance,
              shopState.owned.length > 0 ? shopState.owned : null,
              shopState.pfpBindings ?? null,
              getMarketplaceHistory(),
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
          if (__DEV__) console.log('[XMTP] Bot channel unread counts:', counts);
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
                let content: unknown;
                try { content = raw.content(); } catch { return; }
                // Skip native reactions
                if (isReactionContent(content)) return;
                if (typeof content !== 'string') return;
                // Skip typing signals, own messages
                if (content.startsWith('TYPING:')) return;
                const senderInboxId = raw.senderInboxId ?? '';
                if (senderInboxId === client.inboxId) return;
                useAppStore.getState().incrementBotChannelCount(key);
                // Bot channel notifications handled by FCM push from the bot server.
                // Local notification removed — was causing duplicate pushes.
              });
              _botChannelUnsubs.push(unsub);
              if (__DEV__) console.log(`[XMTP] Streaming bot channel: ${key}`);
            } catch { /* skip individual channel */ }
          }
        } catch { /* non-critical */ }
      })();

      // ── 9. Stream DMs for community badge count ──────────────────────────────
      (async () => {
        try {
          await client.conversations.sync();
          const unsub = await (client.conversations as any).streamAllDmMessages(async (raw: any) => {
            try {
              let content: unknown;
              try { content = raw.content(); } catch { return; }
              // Skip native reactions
              if (isReactionContent(content)) return;
              if (typeof content !== 'string') return;
              const senderInboxId: string = raw.senderInboxId ?? '';
              if (senderInboxId === client.inboxId) return;

              // TRADE_CLOSED: structured close payload from the bot.
              // Only honor messages from a known bot inbox to prevent spoofing.
              if (content.startsWith('TRADE_CLOSED:')) {
                const { BOT_INBOX_IDS } = await import('@/lib/constants');
                if (!BOT_INBOX_IDS.includes(senderInboxId)) return;
                const { parseTradeClosed } = await import('@/lib/xmtp');
                const parsed = parseTradeClosed(content);
                if (!parsed) return;
                const { useTradesStore } = await import('@/store/tradesStore');
                useTradesStore.getState().addClosedTrade({
                  id: `${parsed.mint}-${parsed.ts}`,
                  source: parsed.source,
                  token: parsed.token,
                  mint: parsed.mint,
                  entrySolAmount: parsed.entrySolAmount,
                  exitSolAmount: parsed.exitSolAmount,
                  pnlSol: parsed.pnlSol,
                  pnlPct: parsed.pnlPct,
                  durationMs: parsed.durationMs,
                  openedAt: parsed.ts - parsed.durationMs,
                  closedAt: parsed.ts,
                  reason: parsed.reason,
                  signature: parsed.signature,
                });
                return;
              }

              // Skip protocol messages
              if (content.startsWith('TYPING:') || content.startsWith('PROFILE_UPDATE:') || content.startsWith('READ:') || content.startsWith('GIFT_ITEM:')) return;
              useAppStore.getState().incrementCommunityBadge('dms');
              // Per-DM unread — sender IS the peer in a 1:1 DM
              useAppStore.getState().incrementDmUnread(senderInboxId);
            } catch { /* ignore per-message errors */ }
          });
          _botChannelUnsubs.push(unsub);
          if (__DEV__) console.log('[XMTP] Streaming DMs for badge count');
        } catch (err) {
          if (__DEV__) console.warn('[XMTP] DM badge stream failed:', err);
        }
      })();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "XMTP initialization failed";
      if (__DEV__) console.error("[XMTP] initialize() failed:", message, err);
      setError(message);
      toast.error("Connection lost — retrying...");
    } finally {
      _initRunning = false;
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
    // Clear all typing indicator timeouts to prevent leaks
    for (const timer of _typingTimeouts.values()) clearTimeout(timer);
    _typingTimeouts.clear();
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
    incrementProgress('messages_sent');
    tryMintBadge();
  }, [initialize]);

  const reply = useCallback(async (target: ChatMessage, content: string) => {
    if (!_group) await initialize();
    if (!_group) throw new Error("Not connected to chat");
    const { username } = useAppStore.getState();
    await sendReply(_group, target, content, username);
    incrementProgress('messages_sent');
    tryMintBadge();
  }, [initialize]);

  const react = useCallback(
    async (emoji: ReactionEmoji, targetMessageId: string) => {
      if (!_group) {
        if (__DEV__) console.log("[XMTP] react() _group null — calling initialize() first");
        await initialize();
      }
      if (!_group) throw new Error("Not connected to chat");

      // Apply optimistically — XMTP does not echo own messages back in the stream.
      const fakeRaw = {
        content: () => ({
          reaction: {
            reference: targetMessageId,
            action: "added",
            schema: "unicode",
            content: emoji,
          },
        }),
        senderInboxId: _myInboxId,
      };
      const { messages } = useChatStore.getState();
      applyReactionUpdate(applyReaction(messages, fakeRaw, _myInboxId));

      await sendReaction(_group, emoji, targetMessageId);
      toast.success("Reaction sent");
      incrementProgress('reactions_given');
      tryMintBadge();
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

  const edit = useCallback(
    async (originalMessageId: string, newContent: string) => {
      if (!_group) await initialize();
      if (!_group) throw new Error("Not connected to chat");
      const { username } = useAppStore.getState();

      // Apply optimistically
      useChatStore.getState().updateMessageContent(originalMessageId, newContent);

      await sendEdit(_group, originalMessageId, newContent, username);
    },
    [initialize],
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!_group) await initialize();
      if (!_group) throw new Error("Not connected to chat");
      await (_group as any).deleteMessage(messageId);
    },
    [initialize],
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
      if (__DEV__) console.log(`[XMTP] ${pending.length} pending join request(s).`);
    } catch (err) {
      if (__DEV__) console.warn("[XMTP] loadJoinRequests failed:", err);
    }
  }, [setJoinRequests]);

  // ── Admin: approve a join request ─────────────────────────────────────────
  const approveJoinRequest = useCallback(
    async (inboxId: string) => {
      if (!_group) throw new Error("Not in a group");
      await addMemberToGroup(_group, inboxId);
      useAppStore.getState().removeJoinRequest(inboxId);
      if (__DEV__) console.log("[XMTP] Added", inboxId, "to the group.");
    },
    []
  );

  // ── Broadcast own profile to the group ────────────────────────────────────
  const broadcastProfile = useCallback(async () => {
    if (!_group || !_myInboxId) return;
    const { username, bio, xAccount, wallet, tipWallet, location, verifiedNft, isLegendary,
      notificationsEnabled, mentionsOnly, botNotificationsEnabled,
      dmNotificationsEnabled, liveRoomNotificationsEnabled,
      mutedBotChannels, mutedSports, shopStyles: currentShopStyles,
    } = useAppStore.getState();
    try {
      const pushToken = await getCachedPushToken();
      const expoPushToken = useAppStore.getState().expoPushToken ?? await registerForExpoPushToken();
      const [bananaState, shopState] = await Promise.all([loadBananaState(), loadShopState()]);
      await sendProfileUpdate(
        _group, _myInboxId,
        username, bio, xAccount,
        wallet?.address ?? null,
        tipWallet ?? null,
        verifiedNft?.image ?? null,
        verifiedNft?.mint ?? null,
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
        location,
        getEarnedBadges(),
        Object.keys(currentShopStyles).length > 0 ? currentShopStyles : null,
        bananaState.balance,
        shopState.owned.length > 0 ? shopState.owned : null,
        shopState.pfpBindings ?? null,
        getMarketplaceHistory(),
      );
      // Keep own cache entry current so PFP is always available locally
      cacheProfile(_myInboxId, {
        username: username ?? undefined,
        nftImage: verifiedNft?.image ?? null,
        location: location ?? undefined,
      });
    } catch (err) {
      if (__DEV__) console.warn("[XMTP] broadcastProfile failed:", err);
    }
  }, []);

  // ── Sync recent messages (call when app returns to foreground) ────────────
  const syncMessages = useCallback(async () => {
    if (!_group) return;

    // Stream liveness check: if no stream event in 90s, the stream is dead.
    // Force a full re-initialize to restart it (throws to trigger reconnect).
    const STREAM_STALE_MS = 90_000;
    if (_lastStreamEvent > 0 && Date.now() - _lastStreamEvent > STREAM_STALE_MS && !_streamAlive) {
      if (__DEV__) console.warn("[XMTP] Stream appears dead (no events in 90s) — forcing reconnect");
      throw new Error("Stream stale — reconnect needed");
    }

    try {
      await (_group as any).sync();
      // Use time-based window instead of count limit — PRESENCE heartbeats
      // flood the history (one per user per 60s), so { limit: 50 } can miss
      // all real chat messages if the group has active presence.
      const TWO_HOURS_NS = 2 * 60 * 60 * 1_000_000_000;
      const afterNs = (Date.now() * 1_000_000) - TWO_HOURS_NS;
      const rawHistory: any[] = await (_group as any).messages({ afterNs });

      const { messages: existing } = useChatStore.getState();
      const existingIds = new Set(existing.map((m) => m.id));

      const newMsgs: ChatMessage[] = resolveReplyTargets(
        rawHistory
          .map((m) => decodeMessage(m, _myInboxId))
          .filter((m): m is ChatMessage => !!m && !existingIds.has(m.id))
      ).reverse(); // oldest-first within the batch

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
      if (__DEV__) console.warn("[XMTP] syncMessages failed:", err);
    }

    // ── Refresh bot channel + DM unread counts on every sync ─────────────
    // Authoritative recalculation from last-read timestamps — replaces
    // whatever the stream incremented, eliminating double-count races.
    // Also catches messages missed when streams silently die.
    if (_client) {
      try {
        // Bot channel counts
        const channelIds = useAppStore.getState().botChannelIds;
        if (channelIds) {
          const counts = { bets: 0, trades: 0, sales: 0, predictions: 0 };
          for (const key of ['bets', 'trades', 'sales', 'predictions'] as const) {
            const chId = channelIds[key];
            if (!chId) continue;
            try {
              const ch = await _client.conversations.findGroup(chId as any);
              if (ch) {
                await (ch as any).sync();
                const msgs: any[] = await (ch as any).messages({ limit: 100 });
                const decoded = msgs
                  .map((m: any) => decodeMessage(m, _client!.inboxId))
                  .filter(Boolean) as ChatMessage[];
                const freshMessages = decoded.reverse();
                await saveCachedMessages(key, freshMessages);
                const lastRead = await getLastReadTimestamp(key);
                counts[key] = freshMessages.filter((m) =>
                  m.sentAt.getTime() > lastRead
                ).length;
              }
            } catch { /* skip */ }
          }
          useAppStore.getState().setBotChannelCounts(counts);
        }

        // DM unread count — use the existing streamAllDmMessages listener
        // (step 9) for real-time increments. The markChannelRead('dms')
        // call in DmInboxScreen resets the baseline for accurate counts.
      } catch { /* non-critical */ }
    }
  }, [mergeMessage, upgradeOwnMessage]);

  // ── Broadcast a calendar event to the group ───────────────────────────────
  const broadcastEvent = useCallback(async (eventJson: string) => {
    if (!_group) return;
    try {
      await sendEventMessage(_group, eventJson);
    } catch (err) {
      if (__DEV__) console.warn("[XMTP] broadcastEvent failed:", err);
    }
  }, []);

  // ── Broadcast a live room signal (start / end) ─────────────────────────────
  const broadcastLiveRoom = useCallback(async (data: LiveRoomData) => {
    if (!_group) return;
    try {
      await sendLiveRoomMessage(_group, JSON.stringify(data));
    } catch (err) {
      if (__DEV__) console.warn("[XMTP] broadcastLiveRoom failed:", err);
    }
  }, []);

  // ── Broadcast a video room signal (start / end) ───────────────────────────
  const broadcastVideoRoom = useCallback(async (data: VideoRoomData) => {
    if (!_group) return;
    try {
      await sendVideoRoomMessage(_group, JSON.stringify(data));
    } catch (err) {
      if (__DEV__) console.warn("[XMTP] broadcastVideoRoom failed:", err);
    }
  }, []);

  // ── Broadcast an avatar room signal (start / end) ─────────────────────────
  const broadcastAvatarRoom = useCallback(async (data: AvatarRoomData) => {
    if (!_group) return;
    try {
      await sendAvatarRoomMessage(_group, JSON.stringify(data));
    } catch (err) {
      if (__DEV__) console.warn("[XMTP] broadcastAvatarRoom failed:", err);
    }
  }, []);

  // ── Admin: publish group ID to GitHub config ───────────────────────────────
  const publishGroupId = useCallback(async (githubPat: string) => {
    if (!_client) throw new Error("XMTP client not ready");
    const groupId = (_group as any)?.id;
    if (!groupId) throw new Error("No group created yet — initialize the app first.");

    await saveAdminToken(githubPat);
    await publishAppConfig({ globalGroupId: groupId, adminInboxId: _client.inboxId });
    if (__DEV__) console.log("[XMTP] Group config published to GitHub.");
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
    // force:true because forceAdminInit is explicit manual recovery.
    await publishAppConfig({ globalGroupId: groupId, adminInboxId: _client.inboxId }, { force: true });
    if (__DEV__) console.log("[XMTP] forceAdminInit: new group", groupId, "published.");

    // Re-run full initialize — it will find the new group and complete setup.
    await initialize();
  }, [initialize]);

  const sendFile = useCallback(async (url: string, filename: string, size: number) => {
    if (!_group) await initialize();
    if (!_group) throw new Error("Not connected to chat");
    await sendRemoteAttachment(_group, url, filename, size);
  }, [initialize]);

  // ── Load older messages (pagination on scroll-to-top) ─────────────────────
  const loadOlderMessages = useCallback(async () => {
    if (!_group) return;
    const { messages: existing, isLoadingHistory } = useChatStore.getState();
    if (isLoadingHistory || existing.length === 0) return;

    useChatStore.getState().setLoadingHistory(true);
    try {
      // Oldest message timestamp → fetch before it
      const oldest = existing[0]; // messagesAsc is oldest-first
      const beforeNs = BigInt(oldest.sentAt.getTime()) * 1_000_000n;
      // Fetch a 24-hour window before the oldest message
      const ONE_DAY_NS = BigInt(24 * 60 * 60) * 1_000_000_000n;
      const afterNs = beforeNs - ONE_DAY_NS;

      await (_group as any).sync();
      const rawHistory: any[] = await (_group as any).messages({
        afterNs: Number(afterNs),
        beforeNs: Number(beforeNs),
      });

      if (rawHistory.length === 0) {
        useChatStore.getState().setLoadingHistory(false);
        return;
      }

      const existingIds = new Set(existing.map(m => m.id));
      const decoded = resolveReplyTargets(
        rawHistory
          .map(m => decodeMessage(m, _myInboxId))
          .filter((m): m is ChatMessage => !!m && !existingIds.has(m.id))
      );

      if (decoded.length === 0) {
        useChatStore.getState().setLoadingHistory(false);
        return;
      }

      // Sort oldest-first, then prepend to existing messages
      decoded.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
      // Enrich with NFT data
      const enriched = decoded.map(msg => enrichWithNft(msg));
      useChatStore.getState().prependMessages(enriched);
    } catch (err) {
      if (__DEV__) console.warn("[XMTP] loadOlderMessages failed:", err);
    } finally {
      useChatStore.getState().setLoadingHistory(false);
    }
  }, []);

  return {
    initialize,
    disconnect,
    logout,
    streamAlive,
    send,
    reply,
    react,
    edit,
    deleteMessage,
    stickerReact,
    sendFile,
    sendTyping,
    addMember,
    loadJoinRequests,
    approveJoinRequest,
    publishGroupId,
    forceAdminInit,
    broadcastProfile,
    broadcastEvent,
    broadcastLiveRoom,
    broadcastVideoRoom,
    broadcastAvatarRoom,
    syncMessages,
    loadOlderMessages,
  };
}
