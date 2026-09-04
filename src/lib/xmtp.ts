/**
 * XMTP Messaging Service — v5 (MLS protocol)
 *
 * Message format:
 *   Regular:  MSG:<username>:<content>
 *   Reply:    Native ReplyCodec { reply: { reference, content: { text } } } (legacy: REPLYv2: string still decoded)
 *   Reaction: Native ReactionCodec { reaction: { reference, action, schema, content } } (legacy: REACT: string still decoded)
 *
 * Wallet-stable identity: a secp256k1 EOA is derived from a Solana wallet
 * signature (see xmtpIdentity.ts). Same wallet => same inboxId on every device.
 * Group / channel IDs come from remote app-config.json and are never minted here.
 * Local dbEncryptionKey stays per-device (installation), not per-inbox.
 */

import { Client, Group, PublicIdentity, ReactionCodec, ReactionV2Codec, ReplyCodec, RemoteAttachmentCodec } from "@xmtp/react-native-sdk";
import type { ReactionContent, ReplyContent, RemoteAttachmentContent, Signer } from "@xmtp/react-native-sdk";
import {
  deriveXmtpEoa,
  hasDerivedXmtpEoa,
  loadDerivedXmtpEoa,
  makeXmtpEoaSigner,
  saveDerivedXmtpEoa,
  xmtpIdentityMessageBytes,
} from "@/lib/xmtpIdentity";
import { rememberLocalInboxId, loadLocalInboxIds } from "@/lib/localInboxes";

const NATIVE_CODECS = [new ReactionCodec(), new ReactionV2Codec(), new ReplyCodec(), new RemoteAttachmentCodec()];
import type { ChatMessage, MessageReaction, ReactionEmoji, StickerReaction } from "@/types";
import { REACTIONS } from "./constants";
import * as SecureStore from "expo-secure-store";
import type { JoinRequest } from "@/store/appStore";
import { getLastReadTimestamp } from "@/lib/messageCache";

export type XmtpClient = Client;
export type XmtpGroup = Group;

// ─── SecureStore keys ────────────────────────────────────────────────────────
// Keys are wallet-scoped: same wallet = same XMTP identity across installs.

const SK_ENC_KEY_PREFIX = "xmtp_v5_enc_key_";
const SK_INBOX_ID_PREFIX = "xmtp_v5_inbox_id_";
const SK_IDENTITY_ID_PREFIX = "xmtp_v5_identity_id_";
const SK_IDENTITY_KIND_PREFIX = "xmtp_v5_identity_kind_";
// Legacy keys (pre-wallet-binding) — checked as fallback
const SK_ENC_KEY_LEGACY = "xmtp_v5_enc_key";
const SK_INBOX_ID_LEGACY = "xmtp_v5_inbox_id";
const SK_IDENTITY_ID_LEGACY = "xmtp_v5_identity_id";
const SK_IDENTITY_KIND_LEGACY = "xmtp_v5_identity_kind";

let _boundWalletAddress: string | null = null;
let _eoaSigner: Signer | null = null;
let _prefetchPromise: Promise<Client> | null = null;

/** Bind the XMTP identity to a specific wallet address. Call before initXmtpClient(). */
export function bindXmtpToWallet(walletAddress: string): void {
  _boundWalletAddress = walletAddress;
  void loadLocalInboxIds(walletAddress);
}

/**
 * Derive (or restore) the wallet-bound XMTP EOA. Must run before init/prefetch
 * on a device that does not already have this wallet's identity in SecureStore.
 * One Solana signature; XMTP registration then uses the derived EOA locally.
 */
export async function prepareWalletBoundXmtp(
  walletAddress: string,
  signMessage: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<void> {
  bindXmtpToWallet(walletAddress);
  const existing = await loadDerivedXmtpEoa(walletAddress);
  if (existing) {
    _eoaSigner = makeXmtpEoaSigner(existing);
    return;
  }
  const sig = await signMessage(xmtpIdentityMessageBytes(walletAddress));
  const derived = deriveXmtpEoa(sig, walletAddress);
  await saveDerivedXmtpEoa(walletAddress, derived);
  _eoaSigner = makeXmtpEoaSigner(derived);
  _prefetchPromise = null;
}

export { hasDerivedXmtpEoa };

function skKey(prefix: string): string {
  const addr = _boundWalletAddress;
  if (!addr) return prefix.replace(/_$/, ''); // fallback to legacy key format
  // Use first 16 chars of wallet address as scope — SecureStore keys have length limits
  return prefix + addr.slice(0, 16);
}

async function getOrCreateEncryptionKey(): Promise<Uint8Array> {
  // Try wallet-scoped key first
  const key = skKey(SK_ENC_KEY_PREFIX);
  const stored = await SecureStore.getItemAsync(key);
  if (stored) return Buffer.from(stored, "base64");

  // Try legacy key (migrate if found)
  const legacy = await SecureStore.getItemAsync(SK_ENC_KEY_LEGACY);
  if (legacy) {
    await SecureStore.setItemAsync(key, legacy);
    return Buffer.from(legacy, "base64");
  }

  const newKey = crypto.getRandomValues(new Uint8Array(32));
  await SecureStore.setItemAsync(key, Buffer.from(newKey).toString("base64"));
  return newKey;
}

// ─── Client Init ────────────────────────────────────────────��────────────────

type ClientOpts = { env: "production"; dbEncryptionKey: Uint8Array; codecs: typeof NATIVE_CODECS };

async function persistIdentity(client: Client, identifier?: string, kind?: string): Promise<void> {
  const id = identifier ?? client.publicIdentity.identifier;
  const k = kind ?? client.publicIdentity.kind;
  await SecureStore.setItemAsync(skKey(SK_INBOX_ID_PREFIX), client.inboxId);
  await SecureStore.setItemAsync(skKey(SK_IDENTITY_ID_PREFIX), id);
  await SecureStore.setItemAsync(skKey(SK_IDENTITY_KIND_PREFIX), k);
  await SecureStore.setItemAsync(SK_INBOX_ID_LEGACY, client.inboxId);
  await SecureStore.setItemAsync(SK_IDENTITY_ID_LEGACY, id);
  await SecureStore.setItemAsync(SK_IDENTITY_KIND_LEGACY, k);
  if (_boundWalletAddress) {
    await rememberLocalInboxId(_boundWalletAddress, client.inboxId);
  }
}

function kickHistorySync(client: Client): void {
  (client as any).sendSyncRequest?.().catch(() => { /* no other device, network, etc. */ });
}

async function tryBuildStored(opts: ClientOpts): Promise<Client | null> {
  const storedInboxId = await SecureStore.getItemAsync(skKey(SK_INBOX_ID_PREFIX))
    || await SecureStore.getItemAsync(SK_INBOX_ID_LEGACY);
  const storedIdentifier = await SecureStore.getItemAsync(skKey(SK_IDENTITY_ID_PREFIX))
    || await SecureStore.getItemAsync(SK_IDENTITY_ID_LEGACY);
  const storedKind = await SecureStore.getItemAsync(skKey(SK_IDENTITY_KIND_PREFIX))
    || await SecureStore.getItemAsync(SK_IDENTITY_KIND_LEGACY);

  if (!storedInboxId || !storedIdentifier || !storedKind) return null;

  try {
    const identity = new PublicIdentity(
      storedIdentifier,
      storedKind as "ETHEREUM" | "PASSKEY",
    );
    const client = await Client.build(identity, opts, storedInboxId as any);
    if (_boundWalletAddress) {
      await persistIdentity(client);
    }
    kickHistorySync(client);
    return client;
  } catch {
    return null;
  }
}

async function initWithWalletSigner(signer: Signer, opts: ClientOpts): Promise<Client> {
  const derived = await signer.getIdentifier();
  const derivedAddr = derived.identifier.toLowerCase();

  const storedIdentifier = (
    await SecureStore.getItemAsync(skKey(SK_IDENTITY_ID_PREFIX))
    || await SecureStore.getItemAsync(SK_IDENTITY_ID_LEGACY)
    || ""
  ).toLowerCase();

  if (storedIdentifier === derivedAddr) {
    const built = await tryBuildStored(opts);
    if (built) return built;
  }

  // Existing random inbox on this phone: attach the derived EOA so this
  // inbox becomes the canonical one for the wallet (keeps group memberships).
  // If the EOA is already registered to another inbox (the other phone won
  // the race), addAccount fails and we Client.create into that inbox instead.
  if (storedIdentifier && storedIdentifier !== derivedAddr) {
    const local = await tryBuildStored(opts);
    if (local) {
      try {
        await local.addAccount(signer, false);
        await persistIdentity(local, derived.identifier, "ETHEREUM");
        kickHistorySync(local);
        return local;
      } catch {
        if (_boundWalletAddress) {
          await rememberLocalInboxId(_boundWalletAddress, local.inboxId);
        }
        try {
          await Client.dropClient(local.installationId);
        } catch { /* abandoned local installation */ }
      }
    }
  }

  const client = await Client.create(signer, opts);
  await persistIdentity(client, derived.identifier, "ETHEREUM");
  kickHistorySync(client);
  return client;
}

/**
 * Thrown by initXmtpClient() when there is no derived EOA signer and no
 * previously-persisted client to fall back to — i.e. the wallet-bound
 * identity signature (prepareWalletBoundXmtp) never completed, usually
 * because the user dismissed/rejected the MWA sign prompt. Exported so
 * callers (ChatScreen's retry UI) can recover by re-prompting the
 * signature instead of blindly retrying init, which would fail identically.
 */
export const XMTP_SIGNATURE_REQUIRED_ERROR = "XMTP identity requires a wallet signature. Reconnect wallet.";

export async function initXmtpClient(): Promise<Client> {
  const dbEncryptionKey = await getOrCreateEncryptionKey();
  const opts: ClientOpts = { env: "production", dbEncryptionKey, codecs: NATIVE_CODECS };

  if (!_eoaSigner && _boundWalletAddress) {
    const stored = await loadDerivedXmtpEoa(_boundWalletAddress);
    if (stored) _eoaSigner = makeXmtpEoaSigner(stored);
  }

  if (_eoaSigner) {
    return initWithWalletSigner(_eoaSigner, opts);
  }

  const built = await tryBuildStored(opts);
  if (built) return built;

  throw new Error(XMTP_SIGNATURE_REQUIRED_ERROR);
}

// ─── Client Prefetch ─────────────────────────────────────────────────────────
// Fire-and-forget during ConnectScreen fast path so the client is already booted
// by the time ChatScreen mounts.

/**
 * Start booting the XMTP client in the background.
 * Returns immediately — the promise is cached and awaited later by useXmtp.
 */
export function prefetchXmtpClient(): void {
  if (!_prefetchPromise) {
    _prefetchPromise = initXmtpClient();
    _prefetchPromise.catch(() => { _prefetchPromise = null; });
  }
}

/**
 * Consume the prefetched client if available, otherwise init fresh.
 * Clears the cached promise so it's only consumed once.
 */
export async function getOrInitXmtpClient(): Promise<Client> {
  if (_prefetchPromise) {
    const promise = _prefetchPromise;
    _prefetchPromise = null;
    return promise;
  }
  return initXmtpClient();
}

// ─── Global Group ─────────────────────────────────────────────────────────────

/**
 * Join the production global group from remote config. Never creates a group.
 * Empty/missing groupId or not-a-member → { group: null } so the UI can
 * show "ask admin" instead of minting another OnlyMonkes Global Chat.
 */
export async function getOrCreateGlobalChat(
  client: XmtpClient,
  groupId: string
): Promise<{ group: XmtpGroup | null; isNewAdmin: boolean }> {
  if (!groupId) {
    console.warn("[XMTP] No globalGroupId in remote config — not creating a group");
    return { group: null, isNewAdmin: false };
  }

  // Step 1: discover conversations (fetches welcome messages / group invites)
  // Include "unknown" consent state — groups added by bot start as "unknown"
  console.log("[XMTP] Syncing conversations to discover group invites…");
  await client.conversations.sync();

  // syncAllConversations with all consent states to pick up bot-added groups
  try {
    await client.conversations.syncAllConversations(["allowed", "unknown"] as any);
  } catch (e) {
    console.warn("[XMTP] syncAllConversations failed:", (e as Error).message);
  }

  // Try findGroup first (fastest path)
  let found = await client.conversations.findGroup(groupId as any);
  if (found) {
    console.log("[XMTP] Found group via findGroup");
    return { group: found as unknown as XmtpGroup, isNewAdmin: false };
  }

  // Fallback: list all groups INCLUDING "unknown" consent state
  // Groups added by the bot start as "unknown" until the user explicitly allows them
  try {
    const allGroups = await client.conversations.listGroups(
      undefined, undefined, ["allowed", "unknown"] as any,
    );
    console.log(`[XMTP] listGroups returned ${allGroups.length} groups, looking for ${groupId.slice(0, 12)}…`);
    for (const g of allGroups) {
      if ((g as any).id === groupId) {
        console.log("[XMTP] Found group via listGroups fallback (consent: unknown)");
        return { group: g as unknown as XmtpGroup, isNewAdmin: false };
      }
    }
  } catch (e) {
    console.log(`[XMTP] listGroups threw: ${(e as Error).message}`);
  }

  // Second pass: sync again in case the welcome message arrived during first pass
  try {
    await client.conversations.sync();
    found = await client.conversations.findGroup(groupId as any);
    if (found) {
      console.log("[XMTP] Found group on second sync pass");
      return { group: found as unknown as XmtpGroup, isNewAdmin: false };
    }
  } catch { /* ignore */ }

  // Group ID set but user is not yet a member — must be added by admin.
  console.log("[XMTP] Group not found after sync — user not yet a member");
  return { group: null, isNewAdmin: false };
}

/**
 * Add (or re-add) an inbox to a group, refreshing its installation set.
 * Inbox IDs are wallet-derived, so a reinstall or Cross-Device Recovery
 * regenerates the SAME inbox ID with a brand-new local installation.
 * addMembers() on an already-member inbox silently no-ops instead of
 * granting the new installation access — removing first forces a fresh
 * add-commit that picks up the current installation set. Mirrors the
 * bot-side fix in Monke_Eliza's xmtpOnlyMonkes.ts (addOrRefreshMember).
 */
export async function addMemberToGroup(
  group: XmtpGroup,
  inboxId: string
): Promise<void> {
  try {
    await (group as any).removeMembers?.([inboxId]);
  } catch { /* not a member yet — expected for genuinely new users */ }
  await (group as any).addMembers([inboxId]);
}

// ─── Join Request DMs ─────────────────────────────────────────────────────────

const JOIN_REQUEST_PREFIX = "JOIN_REQUEST:";

/**
 * Tester sends a DM to the admin's inboxId (and optionally the bot) to request group membership.
 * Format: JOIN_REQUEST:<walletAddress>
 * Bot/admin bind membership to the XMTP DM sender, then verify THIS wallet
 * currently holds a Saga Monke. InboxId and username are not in the payload
 * (colon-safe; cannot spoof another inbox).
 */
export async function sendJoinRequestDM(
  client: XmtpClient,
  adminInboxId: string,
  myInboxId: string,
  username?: string | null,
  nftMint?: string | null,
  botInboxId?: string | null,
  walletAddress?: string | null,
): Promise<void> {
  const payload = `${JOIN_REQUEST_PREFIX}${walletAddress ?? ""}`;

  // Bot first — it auto-adds to Main + Trades. Admin DM is only a notify.
  // Used to send admin first and let that throw, so a closed/unreachable
  // admin inbox swallowed the request and the holder sat on "joining…".
  let botSent = false;
  if (botInboxId && botInboxId !== myInboxId) {
    try {
      const botDm = await client.conversations.findOrCreateDm(botInboxId as any);
      await (botDm as any).send(payload);
      botSent = true;
    } catch (err) {
      if (__DEV__) console.warn("[XMTP] JOIN_REQUEST to bot failed:", err);
    }
  }

  try {
    const adminDm = await client.conversations.findOrCreateDm(adminInboxId as any);
    await (adminDm as any).send(payload);
  } catch (err) {
    if (__DEV__) console.warn("[XMTP] JOIN_REQUEST to admin failed:", err);
    if (!botSent) throw err;
  }
}

/**
 * Admin calls this to scan all DMs and collect pending join requests.
 */
export async function fetchJoinRequests(client: XmtpClient): Promise<JoinRequest[]> {
  await client.conversations.sync();
  // Use listDms with all consent states so we also see "unknown" DMs from new users
  const allDms: any[] = await (client.conversations as any).listDms(
    undefined, // opts
    undefined, // limit
    ["allowed", "unknown"], // consentStates — new users are "unknown"
  );

  const requests: JoinRequest[] = [];

  for (const convo of allDms) {
    try {
      await (convo as any).sync();
      const msgs: any[] = await (convo as any).messages({ limit: 20 });

      for (const msg of msgs) {
        let content: string;
        try { content = msg.content(); } catch { continue; }

        if (typeof content === "string" && content.startsWith(JOIN_REQUEST_PREFIX)) {
          const senderInboxId = (msg.senderInboxId as string) || "";
          const rest = content.slice(JOIN_REQUEST_PREFIX.length);
          const first = rest.split(":")[0] ?? "";
          const walletAddress = /^[a-f0-9]{64}$/i.test(first) ? undefined : first;
          if (senderInboxId) {
            requests.push({
              inboxId: senderInboxId,
              walletAddress,
              requestedAt: new Date(msg.sentNs / 1_000_000),
            });
          }
          break; // one request per DM convo is enough
        }
      }
    } catch {
      // skip unreadable convos
    }
  }

  return requests;
}

// ─── Genesis Chat Join Request DMs ─────────────────────────────────────────────
// Separate from JOIN_REQUEST above — Genesis Chat is a distinct group with a
// distinct gate (Saga/Seeker Genesis Token, not Saga Monke). Never reuses the
// Main Chat join path so a Genesis holder can never be added to Main Chat.

const GENESIS_JOIN_REQUEST_PREFIX = "GENESIS_JOIN_REQUEST:";

/**
 * Wallet requests Genesis Chat membership. Sends only the wallet address —
 * the bot independently re-derives Saga/Seeker Genesis Token ownership from
 * it rather than trusting a client-claimed token kind/mint.
 * Format: GENESIS_JOIN_REQUEST:<walletAddress>
 * Bot binds membership to the XMTP DM sender and re-checks that wallet.
 */
export async function sendGenesisJoinRequestDM(
  client: XmtpClient,
  adminInboxId: string,
  myInboxId: string,
  walletAddress: string,
  username?: string | null,
  botInboxId?: string | null,
): Promise<void> {
  const payload = `${GENESIS_JOIN_REQUEST_PREFIX}${walletAddress}`;

  let botSent = false;
  if (botInboxId && botInboxId !== myInboxId) {
    try {
      const botDm = await client.conversations.findOrCreateDm(botInboxId as any);
      await (botDm as any).send(payload);
      botSent = true;
    } catch (err) {
      if (__DEV__) console.warn("[XMTP] GENESIS_JOIN_REQUEST to bot failed:", err);
    }
  }

  if (adminInboxId) {
    try {
      const adminDm = await client.conversations.findOrCreateDm(adminInboxId as any);
      await (adminDm as any).send(payload);
    } catch (err) {
      if (__DEV__) console.warn("[XMTP] GENESIS_JOIN_REQUEST to admin failed:", err);
      if (!botSent) throw err;
    }
  }
}

// ─── Message Decoding ─────────────────────────────────────────────────────────

function buildEmptyReactions(): Record<ReactionEmoji, MessageReaction> {
  return Object.fromEntries(
    REACTIONS.map((emoji) => [
      emoji,
      { emoji, count: 0, reactedByMe: false, reactors: [] } as MessageReaction,
    ])
  ) as Record<ReactionEmoji, MessageReaction>;
}

/**
 * Parse raw XMTP v5 message content string.
 * Handles MSG:<username>:<inner> format and bare content for compat.
 */
function parseContent(raw: string): {
  username: string | undefined;
  inner: string;
} {
  if (raw.startsWith("MSG:")) {
    const afterPrefix = raw.slice(4); // remove "MSG:"
    const colonIdx = afterPrefix.indexOf(":");
    if (colonIdx !== -1) {
      return {
        username: afterPrefix.slice(0, colonIdx),
        inner: afterPrefix.slice(colonIdx + 1),
      };
    }
  }
  return { username: undefined, inner: raw };
}

function decodeStringMessage(raw: any, rawContent: string, myInboxId: string): ChatMessage | null {
  // System messages — handled separately, not displayed in chat.
  // Check both bare (`PREFIX:...`) and wrapped (`MSG:<name>:PREFIX:...`)
  // forms because the bot wraps every send with `MSG:AI Agent #9385:`.
  const innerPreview = rawContent.startsWith("MSG:")
    ? rawContent.slice(4).split(":").slice(1).join(":")
    : rawContent;
  const STRUCTURED_PREFIXES = [
    "REACT:", "STICKER_REACT:", "TYPING:", "PROFILE_UPDATE:", "PROFILE_SNAPSHOT:", "MY_INBOXES:",
    "LOCATION_SYNC:", "LOCATION_SYNC_REQUEST", "EVENT:", "EDIT:", "PRESENCE:", "LIVE_ROOM:", "VIDEO_ROOM:",
    "AVATAR_ROOM:", "SHOP_PURCHASE:", "GIFT_ITEM:", "THREAD:", "PIN:", "UNPIN:",
    "NFT_LIST:", "NFT_BID:", "NFT_ACCEPT:", "NFT_DELIST:", "NFT_OFFER:",
    "NFT_SWAP:", "NFT_COMPLETE:", "AUTOMONKE_STATUS:", "TRADE_CLOSED:",
    "TRADE_OPENED:", "PORTFOLIO_CARD:", "PORTFOLIO_RESPONSE:", "RSVP:", "READ:",
    "BANANA_GRANT:", "BANANA_BET_OPEN:", "BANANA_BET_SETTLED:", "HEALTH:", "DELETE:",
    "IMAGE_CAPTION_REQUEST:", "IMAGE_CAPTION_RESPONSE:", "POLL_OPEN:", "POLL_RESULT:",
    "STREAK_CAPTION_REQUEST:", "STREAK_CAPTION_RESPONSE:", "JOIN_REQUEST:",
    "BADGE_GRANT:", "COPY_TRADE_STATUS:", "GENESIS_JOIN_REQUEST:",
  ];
  for (const p of STRUCTURED_PREFIXES) {
    // LOCATION_SYNC_REQUEST is a bare token (optionally with trailing :payload)
    if (p === "LOCATION_SYNC_REQUEST") {
      if (
        rawContent === "LOCATION_SYNC_REQUEST" ||
        rawContent.startsWith("LOCATION_SYNC_REQUEST:") ||
        innerPreview === "LOCATION_SYNC_REQUEST" ||
        innerPreview.startsWith("LOCATION_SYNC_REQUEST:")
      ) {
        return null;
      }
      continue;
    }
    if (rawContent.startsWith(p) || innerPreview.startsWith(p)) return null;
  }

  // /shout <tweet-url> and /announce <message> are admin/dev-only Main Chat
  // broadcast commands (2026-09-04) — the raw command text should never
  // render as a chat bubble for anyone, sender included; only the bot's
  // resulting X-card / announcement message should show up. Same treatment
  // as STRUCTURED_PREFIXES above, just space- not colon-delimited so it
  // can't be expressed as a plain prefix in that list.
  const firstWord = (rawContent.split(/\s+/)[0] ?? "").toLowerCase();
  const innerFirstWord = (innerPreview.split(/\s+/)[0] ?? "").toLowerCase();
  if (
    firstWord === "/shout" || firstWord === "/announce" ||
    innerFirstWord === "/shout" || innerFirstWord === "/announce"
  ) {
    return null;
  }

  const { username, inner } = parseContent(rawContent);

  let content = inner;
  let replyTo: ChatMessage["replyTo"] | undefined;

  if (inner.startsWith("REPLYv2:")) {
    const withoutPrefix = inner.slice("REPLYv2:".length);
    const parts = withoutPrefix.split(":");
    const targetId      = parts[0] ?? "";
    const targetSender  = parts[1] ?? "";
    const targetUsername = parts[2] || undefined;
    const origB64       = parts[3] ?? "";
    const replyContent  = parts.slice(4).join(":");

    let originalContent = "";
    try {
      originalContent = Buffer.from(origB64, "base64").toString("utf8");
    } catch { /* leave blank if decode fails */ }

    replyTo = {
      id: targetId,
      senderAddress: targetSender,
      senderUsername: targetUsername,
      content: originalContent,
    };
    content = replyContent;

  } else if (inner.startsWith("REPLY:")) {
    const parts = inner.split(":");
    const [, targetId, targetSender, ...rest] = parts;
    const replyContent = rest.join(":");
    replyTo = {
      id: targetId,
      senderAddress: targetSender,
      senderUsername: undefined,
      content: "",
    };
    content = replyContent;
  }

  return {
    id: raw.id,
    senderAddress: raw.senderInboxId as string,
    senderUsername: username,
    content,
    sentAt: new Date(raw.sentNs / 1_000_000),
    reactions: buildEmptyReactions(),
    replyTo,
    status: "sent",
  };
}

export function decodeMessage(raw: any, myInboxId: string): ChatMessage | null {
  try {
    const rawContent: unknown = raw.content();

    // ── Native codecs (object content) ──────────────────────────────────
    if (rawContent && typeof rawContent === "object") {
      const obj = rawContent as Record<string, any>;

      // Native ReactionCodec / V2 → handled by applyReaction, never displayed
      if (obj.reaction || obj.reactionV2) return null;

      // Native ReplyCodec → decode the reply
      // On history reload, content shape can vary: { text: "..." } or just a string
      if (obj.reply) {
        const rc = obj.reply.content;
        const replyText: string =
          typeof rc === "string" ? rc
          : typeof rc?.text === "string" ? rc.text
          : typeof rc?.content === "string" ? rc.content
          : "";
        if (!replyText) return null;
        const { username, inner } = parseContent(replyText);
        return {
          id: raw.id,
          senderAddress: raw.senderInboxId as string,
          senderUsername: username,
          content: inner,
          sentAt: new Date(raw.sentNs / 1_000_000),
          reactions: buildEmptyReactions(),
          replyTo: {
            id: obj.reply.reference ?? "",
            senderAddress: "",
            content: "",
          },
          status: "sent",
        };
      }

      // Native RemoteAttachmentCodec → decode as ATTACHMENT: message
      if (obj.remoteAttachment) {
        const att = obj.remoteAttachment as RemoteAttachmentContent;
        const filename = att.filename ?? "file";
        // Encode as ATTACHMENT:<url>|<filename> for MessageBubble rendering
        return {
          id: raw.id,
          senderAddress: raw.senderInboxId as string,
          senderUsername: undefined,
          content: `ATTACHMENT:${att.url}|${filename}`,
          sentAt: new Date(raw.sentNs / 1_000_000),
          reactions: buildEmptyReactions(),
          status: "sent",
        };
      }

      // Object with .text field (future-proof for NativeMessageContent)
      if (typeof obj.text === "string") {
        const textContent = obj.text;
        if (!textContent) return null;
        // Fall through to string handling below
        return decodeStringMessage(raw, textContent, myInboxId);
      }

      return null;
    }

    if (!rawContent || typeof rawContent !== "string") return null;

    return decodeStringMessage(raw, rawContent, myInboxId);
  } catch {
    return null;
  }
}

/**
 * Fill in replyTo.content for native-codec replies by looking up the referenced message.
 * Call after batch-decoding messages so the referenced messages are available.
 */
export function resolveReplyTargets(messages: ChatMessage[]): ChatMessage[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  return messages.map((msg) => {
    if (!msg.replyTo?.id || msg.replyTo.content) return msg;
    const target = byId.get(msg.replyTo.id);
    if (!target) return msg;
    return {
      ...msg,
      replyTo: {
        ...msg.replyTo,
        senderAddress: target.senderAddress,
        senderUsername: target.senderUsername,
        content: target.content,
      },
    };
  });
}

export function applyReaction(
  messages: ChatMessage[],
  raw: any,
  myInboxId: string
): ChatMessage[] {
  let emoji: string;
  let targetId: string;
  const sender: string = raw.senderInboxId;

  try {
    const content = raw.content();

    if (typeof content === "string" && content.startsWith("REACT:")) {
      // Legacy string format
      const parts = content.split(":");
      emoji = parts[1];
      targetId = parts[2];
    } else if (content && typeof content === "object") {
      // Native ReactionCodec or V2
      const reaction = content.reaction ?? content.reactionV2 ?? content;
      if (!reaction.reference || !reaction.content) return messages;
      emoji = reaction.content;
      targetId = reaction.reference;
    } else {
      return messages;
    }
  } catch {
    return messages;
  }

  // Perf (2026-05-02): early bail when target isn't in the in-memory window.
  // Reactions can target ANY message (including ones older than the 300-msg
  // cap or simply not loaded yet). The previous .map() always allocated a
  // new top-level array even when no message changed → triggered FlashList
  // re-render for a no-op update. findIndex + slice keeps the same array
  // reference when the target is missing, so React.memo + selector identity
  // cleanly skip the render.
  const idx = messages.findIndex((m) => m.id === targetId);
  if (idx === -1) return messages;

  const msg = messages[idx];
  const reactions = { ...msg.reactions };
  const existing = reactions[emoji as ReactionEmoji] ?? {
    emoji: emoji as ReactionEmoji, count: 0, reactedByMe: false, reactors: [],
  };

  const alreadyReacted = existing.reactors.includes(sender);
  const newReactors = alreadyReacted
    ? existing.reactors.filter((r) => r !== sender)
    : [...existing.reactors, sender].slice(-50); // Cap at 50 reactors per emoji
  reactions[emoji as ReactionEmoji] = {
    ...existing,
    count: newReactors.length,
    reactedByMe:
      sender === myInboxId ? !existing.reactedByMe : existing.reactedByMe,
    reactors: newReactors,
  };

  const updated = messages.slice();
  updated[idx] = { ...msg, reactions };
  return updated;
}

const REACTION_RETRY_MS = 500;
const REACTION_MAX_RETRIES = 30;

/**
 * Retries applyReaction()/applyStickerReaction() a few times if the target
 * message isn't in the list YET. Both of those are pure functions that
 * silently return the SAME array reference when the target id isn't found
 * (a deliberate perf optimization for reactions on old/evicted messages,
 * see applyReaction's comment) — but that also means a reaction arriving in
 * a race against its OWN target message still being asynchronously
 * processed (profile enrichment, etc.) gets dropped forever with no retry,
 * reported 2026-07-16 as "reactions don't show at all, or not until the app
 * reopens" (reopening re-runs history load, where all messages are already
 * materialized before reactions apply, so the race can't happen there).
 * Detects a no-op via reference equality and retries briefly before giving
 * up — a genuinely out-of-window old message still fails, just a couple
 * seconds later instead of immediately.
 *
 * 2026-07-27: reported AGAIN, same shape, on both the published app and the
 * 3.0 dev branch — the original 2s window (5 * 400ms) wasn't actually long
 * enough for real-world conditions (slow network, message backlog on
 * reconnect, profile enrichment queued behind other work). Retrying is
 * cheap (a no-op array-reference check) so there's little cost to a much
 * more generous window — 30 * 500ms = 15s — before finally giving up on a
 * genuinely evicted/out-of-window target.
 */
export function applyWithRetry(
  applyFn: (messages: ChatMessage[]) => ChatMessage[],
  setMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void,
  attempt = 0,
): void {
  let matched = false;
  setMessages(prev => {
    const next = applyFn(prev);
    matched = next !== prev;
    return next;
  });
  if (!matched && attempt < REACTION_MAX_RETRIES) {
    setTimeout(() => applyWithRetry(applyFn, setMessages, attempt + 1), REACTION_RETRY_MS);
  }
}

/**
 * Apply an EDIT message to the message list.
 * Format: EDIT:<originalMessageId>:<senderUsername>:<newContent>
 */
export function applyEdit(
  messages: ChatMessage[],
  raw: any,
): ChatMessage[] {
  let content: string;
  try {
    content = raw.content();
  } catch {
    return messages;
  }

  if (!content?.startsWith("EDIT:")) return messages;

  // EDIT:<targetId>:<username>:<newContent>
  const withoutPrefix = content.slice("EDIT:".length);
  const parts = withoutPrefix.split(":");
  const targetId = parts[0] ?? "";
  // parts[1] = username (unused here)
  const newContent = parts.slice(2).join(":");
  const sender: string = raw.senderInboxId;

  // Perf: same early-bail pattern as applyReaction.
  const idx = messages.findIndex((m) => m.id === targetId);
  if (idx === -1) return messages;
  const msg = messages[idx];
  // Only the original sender can edit their own message
  if (msg.senderAddress !== sender) return messages;
  const updated = messages.slice();
  updated[idx] = { ...msg, editedContent: newContent, editedAt: new Date() };
  return updated;
}

// ─── Profile Update Parsing & Validation ──────────────────────────────────

export interface ParsedProfileUpdate {
  id: string;
  username?: string;
  bio?: string;
  xAccount?: string;
  walletAddress?: string;
  tipWallet?: string;
  location?: string;
  nftImage?: string | null;
  nftMint?: string;
  legendary: boolean;
  pushToken?: string;
  expoPushToken?: string;
  badges?: string[];
  shopStyles?: Record<string, string | number | boolean>;
  statusMessage?: string;
  bananaBalance?: number;
  shopOwned?: string[];
  pfpBindings?: Record<string, string[]>;
}

export interface ParsedTradeOpened {
  source: 'autonomonke';
  positionId: string;
  token: string;
  mint: string;
  entryPriceUsd: number;
  entrySolAmount: number;
  tokenAmount: number;
  stopPrice: number;
  stopPct?: number;
  target1?: number;
  target2?: number;
  taComposite?: number;
  openClawConfidence?: number;
  txHash?: string;
  ts: number;
  /** Hot wallet pubkey that opened the position. Render on trade cards. */
  hotWalletAddress?: string;
  baseMint?: string;
  baseSymbol?: 'SOL' | 'USDC' | 'SKR';
  /** Set when this position was opened by copy-trade mirroring, e.g.
   *  "Copied from Monke Trader #3". Takes header priority over autonomonke/manual. */
  copySourceLabel?: string;
}

export interface ParsedTradeClosed {
  source: 'manual' | 'autonomonke';
  token: string;
  mint: string;
  entrySolAmount: number;
  exitSolAmount: number;
  pnlSol: number;
  pnlPct: number;
  durationMs: number;
  ts: number;
  reason?: string;
  signature?: string;
  /** Hot wallet pubkey that executed the trade (post-2026-05-24 bot builds).
   *  Render on PnL cards instead of the login wallet — tokens live here. */
  hotWalletAddress?: string;
  // v2.38 multi-base trading — all optional, native-base PnL only.
  // When baseSymbol === 'SOL' (or missing) the legacy SOL view is correct.
  // For USDC/SKR positions, UI should prefer the *Base fields and label
  // amounts with baseSymbol. Trades round-trip in the chosen base —
  // there is no separate USD-normalized PnL.
  baseMint?: string;
  baseSymbol?: 'SOL' | 'USDC' | 'SKR';
  entryBaseAmount?: number;
  exitBaseAmount?: number;
  pnlBase?: number;
  /** Set when this trade was closed by copy-trade mirroring, e.g.
   *  "Copied from Monke Trader #3". Takes header priority over autonomonke/manual. */
  copySourceLabel?: string;
}

export function parseTradeClosed(raw: string): ParsedTradeClosed | null {
  if (!raw.startsWith("TRADE_CLOSED:")) return null;
  const jsonStr = raw.slice("TRADE_CLOSED:".length);
  if (jsonStr.length > 4_000) return null;

  let data: any;
  try { data = JSON.parse(jsonStr); } catch { return null; }
  if (!data || typeof data !== 'object') return null;

  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const strOrNull = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 && v.length < 200 ? v : null;

  const token = strOrNull(data.token);
  const mint = strOrNull(data.mint);
  const entrySolAmount = numOrNull(data.entrySolAmount);
  const exitSolAmount = numOrNull(data.exitSolAmount);
  const pnlPct = numOrNull(data.pnlPct);
  const durationMs = numOrNull(data.durationMs);
  const ts = numOrNull(data.ts);
  if (!token || !mint || entrySolAmount === null || exitSolAmount === null
      || pnlPct === null || durationMs === null || ts === null) return null;

  const pnlSol = numOrNull(data.pnlSol) ?? (exitSolAmount - entrySolAmount);
  const source = data.source === 'autonomonke' ? 'autonomonke' : 'manual';

  // v2.38 multi-base fields. Whitelist baseSymbol so a malformed payload
  // can't poison the UI rendering path. All fields optional — pre-v2.38
  // bot builds omit them and the parser still produces a valid trade.
  const baseSymRaw = typeof data.baseSymbol === 'string' ? data.baseSymbol.toUpperCase() : null;
  const baseSymbol: 'SOL' | 'USDC' | 'SKR' | undefined =
    baseSymRaw === 'SOL' || baseSymRaw === 'USDC' || baseSymRaw === 'SKR'
      ? baseSymRaw
      : undefined;

  return {
    source,
    token: token.slice(0, 32),
    mint: mint.slice(0, 80),
    entrySolAmount,
    exitSolAmount,
    pnlSol,
    pnlPct,
    durationMs: Math.max(0, durationMs),
    ts,
    reason: strOrNull(data.reason) ?? undefined,
    signature: strOrNull(data.signature) ?? undefined,
    hotWalletAddress: strOrNull(data.hotWalletAddress)?.slice(0, 80) ?? undefined,
    baseMint: strOrNull(data.baseMint)?.slice(0, 80) ?? undefined,
    baseSymbol,
    entryBaseAmount: numOrNull(data.entryBaseAmount) ?? undefined,
    exitBaseAmount: numOrNull(data.exitBaseAmount) ?? undefined,
    pnlBase: numOrNull(data.pnlBase) ?? undefined,
    copySourceLabel: strOrNull(data.copySourceLabel) ?? undefined,
  };
}

export interface ParsedAutomonkeStatus {
  enrolled: boolean;
  active: boolean;
  limitOrdersEnabled: boolean;
}

/**
 * Parse an AUTOMONKE_STATUS: structured DM — the bot's ground truth for
 * AutonoMonke enrollment, sent as a follow-up after every /autonomonke
 * reply. Fixes the app's local AsyncStorage flag (BotChannelScreen.tsx)
 * silently drifting to "OFF" on a fresh install/build even though bot-side
 * enrollment never changed (sender must be in BOT_INBOX_IDS at the call
 * site — same spoof guard as parseTradeClosed).
 */
export function parseAutomonkeStatus(raw: string): ParsedAutomonkeStatus | null {
  if (!raw.startsWith("AUTOMONKE_STATUS:")) return null;
  const jsonStr = raw.slice("AUTOMONKE_STATUS:".length);
  if (jsonStr.length > 500) return null;
  let data: any;
  try { data = JSON.parse(jsonStr); } catch { return null; }
  if (!data || typeof data !== "object") return null;
  return {
    enrolled: data.enrolled === true,
    active: data.active === true,
    limitOrdersEnabled: data.limitOrdersEnabled === true,
  };
}

export interface ParsedCopyTradeStatus {
  slots: Array<{ slot: 1 | 3; enabled: boolean; perTradeSOL: number }>;
  ts: number;
}

/**
 * Parse a COPY_TRADE_STATUS: structured DM — the bot's ground truth for
 * copy-trade slot bindings, sent after every /copy enable|disable and after
 * a weekly rebind. Allowlists slot/enabled/perTradeSOL only — the wallet
 * address is intentionally never sent by the bot and is never trusted here
 * even if present (sender must be in BOT_INBOX_IDS at the call site — same
 * spoof guard as parseTradeClosed).
 */
export function parseCopyTradeStatus(raw: string): ParsedCopyTradeStatus | null {
  if (!raw.startsWith("COPY_TRADE_STATUS:")) return null;
  const jsonStr = raw.slice("COPY_TRADE_STATUS:".length);
  if (jsonStr.length > 1_000) return null;
  let data: any;
  try { data = JSON.parse(jsonStr); } catch { return null; }
  if (!data || typeof data !== "object" || !Array.isArray(data.slots)) return null;

  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  const slots: Array<{ slot: 1 | 3; enabled: boolean; perTradeSOL: number }> = [];
  for (const entry of data.slots.slice(0, 4)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.slot !== 1 && entry.slot !== 3) continue;
    const perTradeSOL = numOrNull(entry.perTradeSOL);
    if (perTradeSOL === null) continue;
    slots.push({ slot: entry.slot, enabled: entry.enabled === true, perTradeSOL });
  }

  const ts = numOrNull(data.ts);
  if (ts === null) return null;

  return { slots, ts };
}

/**
 * Parse and validate a TRADE_OPENED: structured DM. Mirrors parseTradeClosed —
 * signed-style (sender must be in BOT_INBOX_IDS at the call site).
 */
export function parseTradeOpened(raw: string): ParsedTradeOpened | null {
  if (!raw.startsWith("TRADE_OPENED:")) return null;
  const jsonStr = raw.slice("TRADE_OPENED:".length);
  if (jsonStr.length > 4_000) return null;

  let data: any;
  try { data = JSON.parse(jsonStr); } catch { return null; }
  if (!data || typeof data !== 'object') return null;

  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const strOrNull = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 && v.length < 200 ? v : null;

  const positionId = strOrNull(data.positionId);
  const token = strOrNull(data.token);
  const mint = strOrNull(data.mint);
  const entryPriceUsd = numOrNull(data.entryPriceUsd);
  const entrySolAmount = numOrNull(data.entrySolAmount);
  const tokenAmount = numOrNull(data.tokenAmount);
  const stopPrice = numOrNull(data.stopPrice);
  const ts = numOrNull(data.ts);
  if (!positionId || !token || !mint || entryPriceUsd === null
      || entrySolAmount === null || tokenAmount === null
      || stopPrice === null || ts === null) return null;

  return {
    source: 'autonomonke',
    positionId: positionId.slice(0, 80),
    token: token.slice(0, 32),
    mint: mint.slice(0, 80),
    entryPriceUsd,
    entrySolAmount,
    tokenAmount,
    stopPrice,
    stopPct: numOrNull(data.stopPct) ?? undefined,
    target1: numOrNull(data.target1) ?? undefined,
    target2: numOrNull(data.target2) ?? undefined,
    taComposite: numOrNull(data.taComposite) ?? undefined,
    openClawConfidence: numOrNull(data.openClawConfidence) ?? undefined,
    txHash: strOrNull(data.txHash) ?? undefined,
    ts,
    hotWalletAddress: strOrNull(data.hotWalletAddress)?.slice(0, 80) ?? undefined,
    baseMint: strOrNull(data.baseMint)?.slice(0, 80) ?? undefined,
    baseSymbol: (() => {
      const raw = typeof data.baseSymbol === 'string' ? data.baseSymbol.toUpperCase() : null;
      return raw === 'SOL' || raw === 'USDC' || raw === 'SKR' ? raw : undefined;
    })(),
    copySourceLabel: strOrNull(data.copySourceLabel) ?? undefined,
  };
}

/**
 * Parse and validate a PORTFOLIO_CARD: structured DM (live AutonoMonke
 * position snapshot, sent one per open position when the user DMs /portfolio).
 * Spoof guard at the call site: sender must be in BOT_INBOX_IDS.
 */
export interface ParsedPortfolioCard {
  source: 'autonomonke';
  kind: 'live';
  positionId: string;
  token: string;
  mint: string;
  entryPriceUsd: number;
  currentPriceUsd: number;
  entrySolAmount: number;
  currentSolValue: number;
  pnlPct: number;
  pnlSol: number;
  stopPrice: number;
  target1?: number;
  target2?: number;
  t1Hit: boolean;
  t2Hit: boolean;
  highWaterMark: number;
  openedAt: number;
  durationMs: number;
  taComposite?: number;
  ts: number;
}

export function parsePortfolioCard(raw: string): ParsedPortfolioCard | null {
  if (!raw.startsWith("PORTFOLIO_CARD:")) return null;
  const jsonStr = raw.slice("PORTFOLIO_CARD:".length);
  if (jsonStr.length > 4_000) return null;
  let data: any;
  try { data = JSON.parse(jsonStr); } catch { return null; }
  if (!data || typeof data !== 'object') return null;

  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const strOrNull = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 && v.length < 200 ? v : null;

  const positionId = strOrNull(data.positionId);
  const token = strOrNull(data.token);
  const mint = strOrNull(data.mint);
  const entryPriceUsd = numOrNull(data.entryPriceUsd);
  const currentPriceUsd = numOrNull(data.currentPriceUsd);
  const entrySolAmount = numOrNull(data.entrySolAmount);
  const currentSolValue = numOrNull(data.currentSolValue);
  const pnlPct = numOrNull(data.pnlPct);
  const pnlSol = numOrNull(data.pnlSol);
  const stopPrice = numOrNull(data.stopPrice);
  const highWaterMark = numOrNull(data.highWaterMark);
  const openedAt = numOrNull(data.openedAt);
  const durationMs = numOrNull(data.durationMs);
  const ts = numOrNull(data.ts);

  if (!positionId || !token || !mint || entryPriceUsd === null
      || currentPriceUsd === null || entrySolAmount === null
      || currentSolValue === null || pnlPct === null || pnlSol === null
      || stopPrice === null || highWaterMark === null
      || openedAt === null || durationMs === null || ts === null) return null;

  return {
    source: 'autonomonke',
    kind: 'live',
    positionId: positionId.slice(0, 80),
    token: token.slice(0, 32),
    mint: mint.slice(0, 80),
    entryPriceUsd,
    currentPriceUsd,
    entrySolAmount,
    currentSolValue,
    pnlPct,
    pnlSol,
    stopPrice,
    target1: numOrNull(data.target1) ?? undefined,
    target2: numOrNull(data.target2) ?? undefined,
    t1Hit: data.t1Hit === true,
    t2Hit: data.t2Hit === true,
    highWaterMark,
    openedAt,
    durationMs: Math.max(0, durationMs),
    taComposite: numOrNull(data.taComposite) ?? undefined,
    ts,
  };
}

/**
 * Parse and validate a PORTFOLIO_RESPONSE: structured DM — single composite
 * payload from the bot containing wallet header + open positions (each with
 * a sparkline closes array) + recent closed summary. Replaces the older
 * "header text + N PORTFOLIO_CARD: messages" flow as of 2026-05-08.
 */
export interface ParsedPortfolioPosition {
  positionId: string;
  token: string;
  mint: string;
  entryPriceUsd: number;
  currentPriceUsd: number;
  /** Original cost basis (full SOL spent at entry). */
  entrySolAmount: number;
  /** Cost-basis of tokens still held after any partial sells. Sub-field of
   *  the bot's position-aware /portfolio payload (2026-05-14). Older bot
   *  builds omit this — app falls back to entrySolAmount when null. */
  remainingCostBasisSol?: number | null;
  /** Current SOL value of tokens still held. */
  currentSolValue: number;
  pnlPct: number;
  /** Lifetime net SOL P&L: realized partials + remaining bag MTM − entry. */
  pnlSol: number;
  /** Cumulative SOL realized from partial sales on this position. */
  realizedSolFromSells?: number | null;
  /** Fraction of original position still held (0-1). */
  fractionRemaining?: number | null;
  /** True when realized SOL has covered entry cost ("house money"). */
  houseMoney?: boolean;
  stopPrice: number;
  target1?: number;
  target2?: number;
  t1Hit: boolean;
  t2Hit: boolean;
  highWaterMark: number;
  openedAt: number;
  durationMs: number;
  taComposite?: number;
  sparkline: number[];
}

/** Closed trade row in a /portfolio response — enriched with full ClosedTrade
 *  fields so the app can render a tappable PnL card on row press. */
export interface ParsedRecentClosed {
  token: string;
  mint: string;
  pnlPct: number;
  pnlSol: number;
  entrySolAmount: number;
  exitSolAmount: number;
  durationMs: number;
  openedAt: number;
  closedAt: number;
  reason: string;
}

export interface ParsedPortfolioResponse {
  source: 'autonomonke';
  /** Login wallet — the user's identity key. NOT what holds tokens. */
  walletAddress: string;
  /** Hot wallet — the bot-managed keypair pubkey that actually holds tokens
   *  and executes trades. Render THIS on PnL/portfolio cards (the user cares
   *  about where their assets live). Older bot builds omit it → falls back
   *  to walletAddress so display gracefully degrades. */
  hotWalletAddress: string | null;
  walletBalanceSOL: number | null;
  realizedPnlPct: number;
  /** Absolute SOL realized across closed positions. Older bot builds omit this
   *  — render fallback to "" so display gracefully degrades. */
  realizedPnlSol: number | null;
  unrealizedPnlSol: number;
  totalTrades: number;
  closedCount: number;
  wins: number;
  losses: number;
  winRate: number;
  positions: ParsedPortfolioPosition[];
  recentClosed: ParsedRecentClosed[];
  ts: number;
}

export function parsePortfolioResponse(raw: string): ParsedPortfolioResponse | null {
  if (!raw.startsWith("PORTFOLIO_RESPONSE:")) return null;
  const jsonStr = raw.slice("PORTFOLIO_RESPONSE:".length);
  if (jsonStr.length > 64_000) return null;
  let data: any;
  try { data = JSON.parse(jsonStr); } catch { return null; }
  if (!data || typeof data !== 'object') return null;

  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const strOrNull = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 && v.length < 200 ? v : null;

  const walletAddress = strOrNull(data.walletAddress);
  const ts = numOrNull(data.ts);
  if (!walletAddress || ts === null) return null;

  const positions: ParsedPortfolioPosition[] = [];
  if (Array.isArray(data.positions)) {
    for (const p of data.positions) {
      const positionId = strOrNull(p?.positionId);
      const token = strOrNull(p?.token);
      const mint = strOrNull(p?.mint);
      const entryPriceUsd = numOrNull(p?.entryPriceUsd);
      const currentPriceUsd = numOrNull(p?.currentPriceUsd);
      const entrySolAmount = numOrNull(p?.entrySolAmount);
      const currentSolValue = numOrNull(p?.currentSolValue);
      const pnlPct = numOrNull(p?.pnlPct);
      const pnlSol = numOrNull(p?.pnlSol);
      const stopPrice = numOrNull(p?.stopPrice);
      const highWaterMark = numOrNull(p?.highWaterMark);
      const openedAt = numOrNull(p?.openedAt);
      const durationMs = numOrNull(p?.durationMs);
      if (!positionId || !token || !mint || entryPriceUsd === null
          || currentPriceUsd === null || entrySolAmount === null
          || currentSolValue === null || pnlPct === null || pnlSol === null
          || stopPrice === null || highWaterMark === null
          || openedAt === null || durationMs === null) continue;
      const rawSpark = Array.isArray(p?.sparkline) ? p.sparkline : [];
      const sparkline = rawSpark
        .filter((n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
        .slice(0, 60);
      positions.push({
        positionId: positionId.slice(0, 80),
        token: token.slice(0, 32),
        mint: mint.slice(0, 80),
        entryPriceUsd, currentPriceUsd,
        entrySolAmount, currentSolValue,
        remainingCostBasisSol: numOrNull(p?.remainingCostBasisSol),
        pnlPct, pnlSol,
        realizedSolFromSells: numOrNull(p?.realizedSolFromSells),
        fractionRemaining: numOrNull(p?.fractionRemaining),
        houseMoney: p?.houseMoney === true,
        stopPrice,
        target1: numOrNull(p?.target1) ?? undefined,
        target2: numOrNull(p?.target2) ?? undefined,
        t1Hit: p?.t1Hit === true,
        t2Hit: p?.t2Hit === true,
        highWaterMark,
        openedAt,
        durationMs: Math.max(0, durationMs),
        taComposite: numOrNull(p?.taComposite) ?? undefined,
        sparkline,
      });
    }
  }

  const recentClosed: ParsedRecentClosed[] = [];
  if (Array.isArray(data.recentClosed)) {
    for (const c of data.recentClosed) {
      const tok = strOrNull(c?.token);
      const pn = numOrNull(c?.pnlPct);
      if (!tok || pn === null) continue;
      const entrySol = numOrNull(c?.entrySolAmount) ?? 0;
      const exitSol = numOrNull(c?.exitSolAmount) ?? entrySol * (1 + pn / 100);
      const closedAt = numOrNull(c?.closedAt) ?? Date.now();
      recentClosed.push({
        token: tok.slice(0, 32),
        mint: strOrNull(c?.mint)?.slice(0, 80) ?? "",
        pnlPct: pn,
        pnlSol: numOrNull(c?.pnlSol) ?? exitSol - entrySol,
        entrySolAmount: entrySol,
        exitSolAmount: exitSol,
        durationMs: numOrNull(c?.durationMs) ?? 0,
        openedAt: numOrNull(c?.openedAt) ?? closedAt,
        closedAt,
        reason: strOrNull(c?.reason)?.slice(0, 64) ?? "closed",
      });
    }
  }

  return {
    source: 'autonomonke',
    walletAddress: walletAddress.slice(0, 80),
    hotWalletAddress: strOrNull(data.hotWalletAddress)?.slice(0, 80) ?? null,
    walletBalanceSOL: numOrNull(data.walletBalanceSOL),
    realizedPnlPct: numOrNull(data.realizedPnlPct) ?? 0,
    realizedPnlSol: numOrNull(data.realizedPnlSol),
    unrealizedPnlSol: numOrNull(data.unrealizedPnlSol) ?? 0,
    totalTrades: numOrNull(data.totalTrades) ?? 0,
    closedCount: numOrNull(data.closedCount) ?? 0,
    wins: numOrNull(data.wins) ?? 0,
    losses: numOrNull(data.losses) ?? 0,
    winRate: numOrNull(data.winRate) ?? 0,
    positions,
    recentClosed,
    ts,
  };
}

/**
 * Catch-up reconciliation for structured bot payloads (TRADE_CLOSED,
 * TRADE_OPENED, PORTFOLIO_RESPONSE, COPY_TRADE_STATUS,
 * STREAK_CAPTION_RESPONSE, AUTOMONKE_STATUS) found in a batch of raw XMTP
 * messages — same prefixes decodeMessage() silently drops via
 * STRUCTURED_PREFIXES (by design, they're never meant to render as chat
 * bubbles).
 *
 * Historically, these were ONLY ever applied to app state (trades store,
 * portfolio, copy-trade slots, automonke status) from inside a LIVE
 * `streamMessages`/`streamAllMessages` callback — useDm.ts and useXmtp.ts
 * each have their own inline copy of this same prefix-matching chain. That
 * meant any structured message that arrived while the app was killed,
 * backgrounded past the stream's lifetime, or simply not on that screen was
 * PERMANENTLY lost: decodeMessage() nulls it out of history, nothing else
 * ever reprocesses it. Confirmed on-device 2026-08-25 — a Seeker install's
 * bot DM correctly showed every `/portfolio` the user sent, but only the
 * very first reply (the one that happened to render while the screen was
 * live); every reply after that had simply vanished from history, with no
 * error anywhere.
 *
 * This function is the fix: call it against the raw message batch every
 * time DM/group history is (re)loaded — mount, reopen, or the AppState
 * foreground catch-up refresh — so anything missed by the live stream gets
 * reconciled into state from history instead. Iterates oldest→newest so
 * "latest wins" for the snapshot-style payloads (AUTOMONKE_STATUS,
 * COPY_TRADE_STATUS, PORTFOLIO_RESPONSE) — see addClosedTrade/addOpenTrade
 * in tradesStore.ts for the id-based dedup that makes this safe to call
 * repeatedly over overlapping history windows (e.g. every foreground
 * resume) without producing duplicate trade-list entries.
 *
 * Deliberately NOT timestamp-guarded against a live update that landed a
 * moment before this ran — the failure mode of "briefly re-applies a few-
 * seconds-stale snapshot" is far preferable to the permanent loss this
 * replaces, and the snapshot types (automonke/copy-trade/portfolio) are
 * idempotent sets, not additive, so the next real update corrects it anyway.
 */
export async function reconcileStructuredHistory(rawMessages: any[], myInboxId: string): Promise<void> {
  if (!rawMessages || rawMessages.length === 0) return;
  try {
    const [{ BOT_INBOX_IDS }, { useTradesStore }, { useAppStore }, { storeStreakCaptionResponse }] =
      await Promise.all([
        import('@/lib/constants'),
        import('@/store/tradesStore'),
        import('@/store/appStore'),
        import('@/lib/imageCaption'),
      ]);

    // Raw XMTP history is newest-first; process oldest-first so "latest
    // wins" naturally falls out of iteration order for snapshot payloads.
    const ordered = [...rawMessages].reverse();

    for (const raw of ordered) {
      try {
        const sender: string = raw.senderInboxId ?? '';
        if (sender === myInboxId || !BOT_INBOX_IDS.includes(sender)) continue;

        const rawContent = typeof raw.content === 'function' ? raw.content() : raw.content;
        if (typeof rawContent !== 'string') continue;
        const inner = rawContent.startsWith('MSG:')
          ? rawContent.slice(4).split(':').slice(1).join(':')
          : rawContent;

        if (inner.startsWith('TRADE_CLOSED:')) {
          const parsed = parseTradeClosed(inner);
          if (!parsed) continue;
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
            baseMint: parsed.baseMint,
            baseSymbol: parsed.baseSymbol,
            entryBaseAmount: parsed.entryBaseAmount,
            exitBaseAmount: parsed.exitBaseAmount,
            pnlBase: parsed.pnlBase,
            copySourceLabel: parsed.copySourceLabel,
          });
        } else if (inner.startsWith('TRADE_OPENED:')) {
          const parsed = parseTradeOpened(inner);
          if (!parsed) continue;
          useTradesStore.getState().addOpenTrade({
            id: parsed.positionId,
            source: parsed.source,
            token: parsed.token,
            mint: parsed.mint,
            entryPriceUsd: parsed.entryPriceUsd,
            entrySolAmount: parsed.entrySolAmount,
            tokenAmount: parsed.tokenAmount,
            stopPrice: parsed.stopPrice,
            stopPct: parsed.stopPct,
            target1: parsed.target1,
            target2: parsed.target2,
            taComposite: parsed.taComposite,
            openClawConfidence: parsed.openClawConfidence,
            txHash: parsed.txHash,
            openedAt: parsed.ts,
            baseSymbol: parsed.baseSymbol,
            copySourceLabel: parsed.copySourceLabel,
          });
        } else if (inner.startsWith('PORTFOLIO_RESPONSE:')) {
          const parsed = parsePortfolioResponse(inner);
          if (parsed) useTradesStore.getState().setPortfolioResponse(parsed);
        } else if (inner.startsWith('COPY_TRADE_STATUS:')) {
          const parsed = parseCopyTradeStatus(inner);
          if (!parsed) continue;
          for (const s of parsed.slots) {
            useAppStore.getState().setCopyTradeSlot(s.slot, {
              enabled: s.enabled,
              perTradeSOL: s.perTradeSOL,
              boundAt: parsed.ts,
            });
          }
        } else if (inner.startsWith('AUTOMONKE_STATUS:')) {
          const parsed = parseAutomonkeStatus(inner);
          if (!parsed) continue;
          useAppStore.getState().setAutomonkeStatus(parsed);
          try {
            const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
            await AsyncStorage.setItem('automonke_enrolled', parsed.enrolled ? '1' : '0');
            await AsyncStorage.setItem('autonomonke_limit_orders_v1', parsed.limitOrdersEnabled ? '1' : '0');
          } catch { /* non-critical */ }
        } else if (inner.startsWith('STREAK_CAPTION_RESPONSE:')) {
          const caption = inner.slice('STREAK_CAPTION_RESPONSE:'.length);
          if (caption) await storeStreakCaptionResponse(caption).catch(() => {});
        }
      } catch { /* skip this one message, keep reconciling the rest */ }
    }
  } catch { /* non-critical — worst case this pass is a no-op */ }
}

/**
 * Parse and validate a PROFILE_UPDATE: message payload.
 * Returns null if the JSON is malformed or missing required fields.
 * Sanitizes all string fields to prevent injection.
 */
export function parseProfileUpdate(raw: string): ParsedProfileUpdate | null {
  if (!raw.startsWith("PROFILE_UPDATE:")) return null;
  const jsonStr = raw.slice("PROFILE_UPDATE:".length);
  // Reject oversized payloads (DoS protection)
  if (jsonStr.length > 10_000) return null;

  let data: any;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  // Must be a plain object with a string `id`
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (typeof data.id !== "string" || !data.id) return null;

  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v ? v.slice(0, 500) : undefined;

  return {
    id: data.id,
    username: str(data.u),
    bio: str(data.b),
    xAccount: str(data.x),
    walletAddress: str(data.w),
    tipWallet: str(data.tw),
    location: str(data.loc),
    nftImage: typeof data.ni === "string" ? data.ni || null : null,
    nftMint: str(data.nm),
    legendary: !!data.lg,
    pushToken: str(data.pt),
    expoPushToken: str(data.ept),
    badges: Array.isArray(data.bd) ? data.bd.filter((b: unknown) => typeof b === "string").slice(0, 20) : undefined,
    shopStyles: data.ss && typeof data.ss === "object" && !Array.isArray(data.ss) ? data.ss : undefined,
    statusMessage: typeof data.sm === "string" ? data.sm.slice(0, 140) : undefined,
    bananaBalance: typeof data.bb === "number" ? data.bb : undefined,
    shopOwned: Array.isArray(data.so) ? data.so.filter((s: unknown) => typeof s === "string").slice(0, 50) : undefined,
    pfpBindings: data.pb && typeof data.pb === "object" && !Array.isArray(data.pb) ? data.pb : undefined,
  };
}

export {
  parseMyInboxes,
  parseProfileSnapshot,
  snapshotWalletAllowed,
  unwrapBotEnvelope,
  type ParsedMyInboxes,
  type ParsedProfileSnapshot,
} from "@/lib/profileSnapshot";

// ─── Generic dApp Group ───────────────────────────────────────────────────────

/**
 * Get or create an XMTP group for a specific dApp community.
 * Same open-membership policy as the main OnlyMonkes group.
 */
export async function getOrCreateDAppGroup(
  client: XmtpClient,
  groupId: string,
  groupName: string
): Promise<XmtpGroup> {
  if (groupId) {
    console.log(`[XMTP] getOrCreateDAppGroup: looking for "${groupName}" id=${groupId}`);
    await client.conversations.sync();
    let found = await client.conversations.findGroup(groupId as any);
    console.log(`[XMTP] getOrCreateDAppGroup: findGroup first attempt → ${found ? "FOUND" : "null"}`);

    if (!found) {
      // Second attempt: syncAllConversations with unknown consent (bot-added groups)
      try { await client.conversations.syncAllConversations(["allowed", "unknown"] as any); } catch { /* ignore */ }
      found = await client.conversations.findGroup(groupId as any);
      console.log(`[XMTP] getOrCreateDAppGroup: findGroup after syncAll → ${found ? "FOUND" : "null"}`);
    }

    if (!found) {
      // Third attempt: list all groups including unknown consent state
      try {
        const allGroups = await client.conversations.listGroups(
          undefined, undefined, ["allowed", "unknown"] as any,
        );
        console.log(`[XMTP] getOrCreateDAppGroup: listGroups returned ${allGroups.length} groups`);
        for (const g of allGroups) {
          const gId = (g as any).id;
          const gName = (g as any).name;
          console.log(`[XMTP]   group: id=${gId} name="${gName}"`);
          if (gId === groupId) {
            found = g as any;
            break;
          }
        }
      } catch (e) {
        console.warn(`[XMTP] getOrCreateDAppGroup: listGroups failed:`, e);
      }
    }

    if (found) return found as unknown as XmtpGroup;

    // Do NOT create a new group — the bot channel must already exist.
    // Throwing lets the UI show an error with a Retry button.
    throw new Error(`Bot channel "${groupName}" not found. You may not be a member yet — ask the admin to add you.`);
  }

  throw new Error(`Bot channel "${groupName}" has no group ID. Ask the admin to add you.`);
}

// ─── Sending ──────────────────────────────────────────────────────────────────

export async function sendMessage(
  group: XmtpGroup,
  content: string,
  username?: string | null
): Promise<void> {
  const packed = username ? `MSG:${username}:${content}` : content;
  await (group as any).send(packed);
}

export async function sendReply(
  group: XmtpGroup,
  targetMessage: ChatMessage,
  replyContent: string,
  username?: string | null
): Promise<void> {
  // Native ReplyCodec — references the target message ID and wraps the reply text
  // as a standard MSG:<username>:<content> so decodeMessage() can extract the sender.
  // Backward compat: decodeMessage() still parses legacy REPLYv2: strings from history.
  const packed = username ? `MSG:${username}:${replyContent}` : replyContent;
  await (group as any).send({
    reply: {
      reference: targetMessage.id,
      content: { text: packed },
    },
  });
}

export async function sendReaction(
  group: XmtpGroup,
  emoji: ReactionEmoji,
  targetMessageId: string
): Promise<void> {
  // Native ReactionCodec
  await (group as any).send({
    reaction: {
      reference: targetMessageId,
      action: "added",
      schema: "unicode",
      content: emoji,
    },
  });
}

/**
 * Send an edit for a previously sent message.
 * Format: EDIT:<originalMessageId>:<newContent>
 */
export async function sendEdit(
  group: XmtpGroup,
  originalMessageId: string,
  newContent: string,
  username?: string | null,
): Promise<void> {
  const packed = `EDIT:${originalMessageId}:${username ?? ""}:${newContent}`;
  await (group as any).send(packed);
}

export async function sendProfileUpdate(
  group: XmtpGroup,
  inboxId: string,
  username?: string | null,
  bio?: string | null,
  xAccount?: string | null,
  walletAddress?: string | null,
  tipWallet?: string | null,
  nftImage?: string | null,
  nftMint?: string | null,
  legendary?: boolean,
  pushToken?: string | null,
  notifPrefs?: {
    all: boolean; mentions: boolean; bot: boolean; dm: boolean; live: boolean;
    mutedChannels?: { trades: boolean };
    mutedSports?: string[];
  } | null,
  expoPushToken?: string | null,
  location?: string | null,
  badges?: string[] | null,
  shopStyles?: Record<string, string | number | boolean> | null,
  bananaBalance?: number | null,
  shopOwned?: string[] | null,
  pfpBindings?: Record<string, string[]> | null,
  marketplaceHistory?: unknown[] | null,
): Promise<void> {
  // Cap mh to last 25 entries to keep payload below the 10KB parser limit
  const mh = Array.isArray(marketplaceHistory) ? marketplaceHistory.slice(0, 25) : null;
  const payload = JSON.stringify({
    id: inboxId,
    u: username ?? "",
    b: bio ?? "",
    x: xAccount ?? "",
    w: walletAddress ?? "",
    tw: tipWallet ?? "",
    loc: location ?? "",
    ni: nftImage ?? "",
    nm: nftMint ?? "",
    lg: legendary ? 1 : 0,
    pt: pushToken ?? "",
    np: notifPrefs ? {
      all: notifPrefs.all, mentions: notifPrefs.mentions, bot: notifPrefs.bot,
      dm: notifPrefs.dm, live: notifPrefs.live,
      mc: notifPrefs.mutedChannels ?? null,
      ms: notifPrefs.mutedSports ?? null,
    } : null,
    ept: expoPushToken ?? "",
    bd: badges ?? [],
    ss: shopStyles ?? null,
    sm: "", // statusMessage — set by the caller if user has a status
    bb: bananaBalance ?? 0,
    so: shopOwned ?? [],
    pb: pfpBindings ?? null,
    mh: mh && mh.length > 0 ? mh : null,
  });
  await (group as any).send(`PROFILE_UPDATE:${payload}`);
}

export async function sendEventMessage(
  group: XmtpGroup,
  eventJson: string
): Promise<void> {
  await (group as any).send(`EVENT:${eventJson}`);
}

// ─── Live Room signaling ───────────────────────────────────────────────────────

export async function sendLiveRoomMessage(
  group: XmtpGroup,
  roomJson: string,
): Promise<void> {
  await (group as any).send(`LIVE_ROOM:${roomJson}`);
}

export async function sendVideoRoomMessage(
  group: XmtpGroup,
  roomJson: string,
): Promise<void> {
  await (group as any).send(`VIDEO_ROOM:${roomJson}`);
}

export async function sendAvatarRoomMessage(
  group: XmtpGroup,
  roomJson: string,
): Promise<void> {
  await (group as any).send(`AVATAR_ROOM:${roomJson}`);
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

/**
 * Broadcast a short-lived typing signal to the group.
 * Format: TYPING:<inboxId>:<username>
 * Filtered out by decodeMessage — never stored as a chat message.
 */
export async function sendTypingIndicator(
  group: XmtpGroup,
  inboxId: string,
  username?: string | null
): Promise<void> {
  await (group as any).send(`TYPING:${inboxId}:${username ?? ""}`);
}

// ─── Direct Messages ──────────────────────────────────────────────────────────

export interface DmThread {
  peerInboxId: string;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
}

/**
 * List all DM conversations for the current user, sorted newest-first.
 * Skips group conversations and join-request DMs (JOIN_REQUEST: prefix).
 */
export async function listDmThreads(client: XmtpClient): Promise<DmThread[]> {
  await client.conversations.sync();
  // listDms() returns only Dm objects; peerInboxId is an async method in SDK v5
  const allDms: any[] = await (client.conversations as any).listDms();
  const threads: DmThread[] = [];

  for (const convo of allDms) {
    let peerInboxId: string;
    try {
      peerInboxId = await (convo as any).peerInboxId();
    } catch { continue; }
    if (!peerInboxId) continue;

    try {
      await (convo as any).sync();
      // Fetch up to 20 recent messages for unread counting
      const msgs: any[] = await (convo as any).messages({ limit: 20 });
      const last = msgs[0];
      let lastMessage: string | null = null;
      let lastMessageAt: Date | null = null;
      let isJoinRequest = false;

      if (last) {
        try {
          const raw: unknown = last.content();
          if (typeof raw === 'string') {
            if (raw.startsWith('MSG:')) {
              const parts = raw.split(':');
              lastMessage = parts.slice(2).join(':');
            } else if (raw.startsWith('JOIN_REQUEST:')) {
              isJoinRequest = true;
            } else if (raw.startsWith('READ:') || raw.startsWith('TYPING:') || raw.startsWith('PROFILE_UPDATE:') || raw.startsWith('GIFT_ITEM:')) {
              // System/protocol messages — skip as preview, look for the previous real message
              for (let i = 1; i < Math.min(msgs.length, 10); i++) {
                try {
                  const prev: unknown = msgs[i].content();
                  if (typeof prev !== 'string') continue;
                  if (prev.startsWith('READ:') || prev.startsWith('TYPING:') || prev.startsWith('PROFILE_UPDATE:') || prev.startsWith('GIFT_ITEM:')) continue;
                  if (prev.startsWith('MSG:')) {
                    const p = prev.split(':');
                    lastMessage = p.slice(2).join(':');
                  } else {
                    lastMessage = prev;
                  }
                  break;
                } catch { /* skip */ }
              }
            } else {
              lastMessage = raw;
            }
          }
        } catch { /* skip */ }
        lastMessageAt = last.sentNs
          ? new Date(Number(last.sentNs) / 1_000_000)
          : null;
      }

      if (isJoinRequest) continue;

      // Count unread messages from peer since last read
      const lastRead = await getLastReadTimestamp(`dm_${peerInboxId}`);
      let unreadCount = 0;
      if (lastRead > 0) {
        for (const m of msgs) {
          try {
            const sentMs = Number(m.sentNs) / 1_000_000;
            if (sentMs <= lastRead) break; // msgs are newest-first, stop once we pass last-read
            const sender = m.senderInboxId ?? '';
            if (sender !== client.inboxId) unreadCount++;
          } catch { /* skip */ }
        }
      } else {
        // Never opened this DM — count all peer messages
        for (const m of msgs) {
          try {
            const sender = m.senderInboxId ?? '';
            if (sender !== client.inboxId) unreadCount++;
          } catch { /* skip */ }
        }
      }

      threads.push({ peerInboxId, lastMessage, lastMessageAt, unreadCount });
    } catch {
      threads.push({ peerInboxId, lastMessage: null, lastMessageAt: null, unreadCount: 0 });
    }
  }

  return threads.sort((a, b) => {
    if (!a.lastMessageAt && !b.lastMessageAt) return 0;
    if (!a.lastMessageAt) return 1;
    if (!b.lastMessageAt) return -1;
    return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
  });
}

export async function openOrCreateDm(client: XmtpClient, peerInboxId: string): Promise<any> {
  return client.conversations.findOrCreateDm(peerInboxId as any);
}

// ─── Group DMs ──────────────────────────────────────────────────────────────

export interface GroupDmThread {
  groupId: string;
  memberInboxIds: string[];
  groupName: string | null;
  lastMessage: string | null;
  lastMessageAt: Date | null;
}

/**
 * Create a new group DM with multiple members.
 * Returns the XMTP group conversation object.
 */
export async function createGroupDm(
  client: XmtpClient,
  memberInboxIds: string[],
  groupName?: string,
): Promise<any> {
  const group = await client.conversations.newGroup(memberInboxIds, {
    permissionLevel: "all_members",
    name: groupName ?? undefined,
  });
  return group;
}

/**
 * List group DM conversations (excludes app-managed groups).
 * Returns newest-first.
 */
export async function listGroupDmThreads(client: XmtpClient): Promise<GroupDmThread[]> {
  await client.conversations.sync();
  const allGroups: any[] = await client.conversations.listGroups(
    undefined, undefined, ["allowed", "unknown"] as any,
  );
  const threads: GroupDmThread[] = [];

  // Known app group names to exclude
  const APP_GROUP_NAMES = [
    'OnlyMonkes Global Chat',
    'MonkeSales', 'MonkeAlerts', 'MonkeBets', 'MonkeAI',
  ];

  for (const group of allGroups) {
    try {
      const name: string | null = (group as any).name ?? null;
      if (name && APP_GROUP_NAMES.some(n => name.includes(n))) continue;

      const members: string[] = await (group as any).memberInboxIds();
      // Skip large groups (app groups); group DMs are small
      if (members.length > 10) continue;
      if (members.length < 2) continue;

      await (group as any).sync();
      const msgs: any[] = await (group as any).messages({ limit: 5 });
      let lastMessage: string | null = null;
      let lastMessageAt: Date | null = null;

      if (msgs[0]) {
        try {
          const raw = msgs[0].content();
          if (typeof raw === 'string') {
            if (raw.startsWith('MSG:')) {
              lastMessage = raw.split(':').slice(2).join(':');
            } else {
              lastMessage = raw;
            }
          }
          lastMessageAt = msgs[0].sentNs
            ? new Date(Number(msgs[0].sentNs) / 1_000_000)
            : null;
        } catch { /* skip */ }
      }

      threads.push({
        groupId: (group as any).id,
        memberInboxIds: members,
        groupName: name,
        lastMessage,
        lastMessageAt,
      });
    } catch { continue; }
  }

  return threads.sort((a, b) => {
    if (!a.lastMessageAt && !b.lastMessageAt) return 0;
    if (!a.lastMessageAt) return 1;
    if (!b.lastMessageAt) return -1;
    return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
  });
}

/**
 * Open an existing group DM by its group ID.
 */
export async function openGroupDm(client: XmtpClient, groupId: string): Promise<any> {
  await client.conversations.sync();
  const allGroups: any[] = await client.conversations.listGroups(
    undefined, undefined, ["allowed", "unknown"] as any,
  );
  for (const g of allGroups) {
    if ((g as any).id === groupId) return g;
  }
  throw new Error('Group DM not found');
}

export async function loadDmMessages(dm: any, myInboxId: string): Promise<ChatMessage[]> {
  await dm.sync();
  await dm.sync(); // second pass ensures bot replies committed before fetching
  const raw: any[] = await dm.messages({ limit: 200 });
  // Catch-up pass for TRADE_CLOSED/PORTFOLIO_RESPONSE/etc. — see
  // reconcileStructuredHistory's doc comment. Runs on every call site
  // (mount and the AppState foreground refresh), not just once.
  await reconcileStructuredHistory(raw, myInboxId);
  const decoded = raw.map(r => decodeMessage(r, myInboxId)).filter(Boolean) as ChatMessage[];
  return decoded.reverse(); // XMTP returns newest-first; reverse to oldest-first for FlatList
}

/**
 * Scan raw DM history for the latest READ: receipt from the peer.
 * Returns the message ID the peer has read up to, or null.
 */
export async function getLastPeerReadReceipt(dm: any, myInboxId: string): Promise<string | null> {
  try {
    const raw: any[] = await dm.messages({ limit: 200 });
    // raw is newest-first; find the first (most recent) READ: from peer
    for (const r of raw) {
      const sender = r.senderInboxId ?? '';
      if (sender === myInboxId) continue;
      const content = typeof r.content === 'function' ? r.content() : r.content;
      if (typeof content === 'string' && content.startsWith('READ:')) {
        return content.slice(5); // the message ID they read up to
      }
    }
  } catch { /* non-critical */ }
  return null;
}

export async function sendDmMessage(dm: any, content: string, username?: string | null): Promise<void> {
  const payload = username ? `MSG:${username}:${content}` : content;
  await dm.send(payload);
}

/**
 * Send a read receipt to the peer in a DM.
 * Format: READ:<lastReadMessageId>
 * The peer marks all own messages up to this ID as read.
 */
export async function sendReadReceipt(dm: any, lastReadMessageId: string): Promise<void> {
  try {
    await dm.send(`READ:${lastReadMessageId}`);
  } catch { /* non-critical — never block UI for read receipts */ }
}

// ─── Sticker Reactions ────────────────────────────────────────────────────────

// ─── Remote Attachments (E2E encrypted file sharing) ─────────────────────────

/**
 * Send a file as a RemoteAttachment via the native XMTP codec.
 * The file must already be uploaded to an HTTPS URL.
 * Encryption metadata is generated by the SDK.
 */
export async function sendRemoteAttachment(
  group: XmtpGroup,
  url: string,
  filename: string,
  contentLength: number,
): Promise<void> {
  const content: RemoteAttachmentContent = {
    scheme: "https://",
    url,
    filename,
    contentLength: String(contentLength),
    // The SDK handles encryption fields (secret, salt, nonce, contentDigest)
    // when using the native codec's encode path
    secret: "",
    salt: "",
    nonce: "",
    contentDigest: "",
  };
  await (group as any).send({ remoteAttachment: content });
}

/**
 * Send a sticker reaction attached to a specific message.
 * Format: STICKER_REACT:<url>:<targetMessageId>
 */
export async function sendStickerReaction(
  group: XmtpGroup,
  url: string,
  targetMessageId: string
): Promise<void> {
  await (group as any).send(`STICKER_REACT:${url}:${targetMessageId}`);
}

/**
 * Apply (or toggle off) a sticker reaction on the target message.
 * Parses STICKER_REACT:<url>:<targetId> and mutates the stickerReactions array.
 */
export function applyStickerReaction(
  messages: ChatMessage[],
  raw: any,
  myInboxId: string
): ChatMessage[] {
  let content: string;
  try {
    content = raw.content();
  } catch {
    return messages;
  }

  if (!content?.startsWith("STICKER_REACT:")) return messages;

  // Format: STICKER_REACT:<url>:<targetId>
  // url may contain ":" (https://...) so split only on the LAST ":" to get targetId
  const withoutPrefix = content.slice("STICKER_REACT:".length);
  const lastColon = withoutPrefix.lastIndexOf(":");
  if (lastColon === -1) return messages;

  const url = withoutPrefix.slice(0, lastColon);
  const targetId = withoutPrefix.slice(lastColon + 1);
  const sender: string = raw.senderInboxId;

  // Perf: same early-bail pattern as applyReaction.
  const idx = messages.findIndex((m) => m.id === targetId);
  if (idx === -1) return messages;

  const msg = messages[idx];
  const existing = (msg.stickerReactions ?? []).find((s) => s.url === url);
  let stickerReactions: StickerReaction[];

  if (!existing) {
    // First reaction with this sticker
    stickerReactions = [
      ...(msg.stickerReactions ?? []),
      {
        url,
        count: 1,
        reactedByMe: sender === myInboxId,
        reactors: [sender],
      },
    ];
  } else {
    const alreadyReacted = existing.reactors.includes(sender);
    stickerReactions = (msg.stickerReactions ?? []).map((s) => {
      if (s.url !== url) return s;
      return {
        ...s,
        count: alreadyReacted ? s.count - 1 : s.count + 1,
        reactedByMe:
          sender === myInboxId ? !s.reactedByMe : s.reactedByMe,
        reactors: alreadyReacted
          ? s.reactors.filter((r) => r !== sender)
          : [...s.reactors, sender],
      };
    }).filter((s) => s.count > 0);
  }

  const updated = messages.slice();
  updated[idx] = { ...msg, stickerReactions };
  return updated;
}
