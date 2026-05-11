/**
 * XMTP Messaging Service — v5 (MLS protocol)
 *
 * Message format:
 *   Regular:  MSG:<username>:<content>
 *   Reply:    Native ReplyCodec { reply: { reference, content: { text } } } (legacy: REPLYv2: string still decoded)
 *   Reaction: Native ReactionCodec { reaction: { reference, action, schema, content } } (legacy: REACT: string still decoded)
 *
 * Uses createRandom() — no Ethereum signer needed (Solana compatible).
 * XMTP identity is persisted in SecureStore across sessions.
 */

import { Client, Group, PublicIdentity, ReactionCodec, ReactionV2Codec, ReplyCodec, RemoteAttachmentCodec } from "@xmtp/react-native-sdk";
import type { ReactionContent, ReplyContent, RemoteAttachmentContent } from "@xmtp/react-native-sdk";

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

/** Bind the XMTP identity to a specific wallet address. Call before initXmtpClient(). */
export function bindXmtpToWallet(walletAddress: string): void {
  _boundWalletAddress = walletAddress;
}

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

export async function initXmtpClient(): Promise<Client> {
  const dbEncryptionKey = await getOrCreateEncryptionKey();
  const opts = { env: "production" as const, dbEncryptionKey, codecs: NATIVE_CODECS };

  // Try wallet-scoped identity first
  const storedInboxId = await SecureStore.getItemAsync(skKey(SK_INBOX_ID_PREFIX))
    || await SecureStore.getItemAsync(SK_INBOX_ID_LEGACY);
  const storedIdentifier = await SecureStore.getItemAsync(skKey(SK_IDENTITY_ID_PREFIX))
    || await SecureStore.getItemAsync(SK_IDENTITY_ID_LEGACY);
  const storedKind = await SecureStore.getItemAsync(skKey(SK_IDENTITY_KIND_PREFIX))
    || await SecureStore.getItemAsync(SK_IDENTITY_KIND_LEGACY);

  if (storedInboxId && storedIdentifier && storedKind) {
    try {
      const identity = new PublicIdentity(
        storedIdentifier,
        storedKind as "ETHEREUM" | "PASSKEY"
      );
      const client = await Client.build(identity, opts, storedInboxId as any);
      // Migrate legacy keys to wallet-scoped if needed
      if (_boundWalletAddress) {
        await SecureStore.setItemAsync(skKey(SK_INBOX_ID_PREFIX), client.inboxId);
        await SecureStore.setItemAsync(skKey(SK_IDENTITY_ID_PREFIX), client.publicIdentity.identifier);
        await SecureStore.setItemAsync(skKey(SK_IDENTITY_KIND_PREFIX), client.publicIdentity.kind);
      }
      // History sync is manual as of @xmtp/react-native-sdk v5.7. Pull records
      // from other active devices on this inbox. Fire-and-forget — do not block init.
      (client as any).sendSyncRequest?.().catch(() => { /* no other device, network, etc. */ });
      return client;
    } catch {
      // Corrupt state — fall through to create a fresh identity
    }
  }

  const client = await Client.createRandom(opts);

  // Store wallet-scoped (survives reinstall if SecureStore persists, or restore from backup)
  const inboxKey = skKey(SK_INBOX_ID_PREFIX);
  const idKey = skKey(SK_IDENTITY_ID_PREFIX);
  const kindKey = skKey(SK_IDENTITY_KIND_PREFIX);
  await SecureStore.setItemAsync(inboxKey, client.inboxId);
  await SecureStore.setItemAsync(idKey, client.publicIdentity.identifier);
  await SecureStore.setItemAsync(kindKey, client.publicIdentity.kind);
  // Also store in legacy keys for backward compat
  await SecureStore.setItemAsync(SK_INBOX_ID_LEGACY, client.inboxId);
  await SecureStore.setItemAsync(SK_IDENTITY_ID_LEGACY, client.publicIdentity.identifier);
  await SecureStore.setItemAsync(SK_IDENTITY_KIND_LEGACY, client.publicIdentity.kind);

  return client;
}

// ─── Client Prefetch ─────────────────────────────────────────────────────────
// Fire-and-forget during ConnectScreen fast path so the client is already booted
// by the time ChatScreen mounts.

let _prefetchPromise: Promise<Client> | null = null;

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
 * groupId: fetched from remote config (GitHub). Empty string = no group yet.
 * Returns the group if found/created, or null if the user isn't a member yet.
 * Returns { group: null, isNewAdmin: true } when this client just created the group.
 */
export async function getOrCreateGlobalChat(
  client: XmtpClient,
  groupId: string
): Promise<{ group: XmtpGroup | null; isNewAdmin: boolean }> {
  if (groupId) {
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
    } catch { /* ignore */ }

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

  // No group ID in remote config — this is the first admin run. Create the group.
  const group = await client.conversations.newGroup([], {
    permissionLevel: "all_members",
    name: "OnlyMonkes Global Chat",
  });

  console.warn(
    `[XMTP] Global group created. ID:\n${(group as any).id}`
  );

  return { group: group as unknown as XmtpGroup, isNewAdmin: true };
}

export async function addMemberToGroup(
  group: XmtpGroup,
  inboxId: string
): Promise<void> {
  await (group as any).addMembers([inboxId]);
}

// ─── Join Request DMs ─────────────────────────────────────────────────────────

const JOIN_REQUEST_PREFIX = "JOIN_REQUEST:";

/**
 * Tester sends a DM to the admin's inboxId (and optionally the bot) to request group membership.
 * Format: JOIN_REQUEST:<myInboxId>:<username>:<nftMint>
 * nftMint is included so the admin can verify NFT ownership without needing the wallet address.
 * Sending to the bot allows it to auto-approve and notify the admin even when the admin app is closed.
 */
export async function sendJoinRequestDM(
  client: XmtpClient,
  adminInboxId: string,
  myInboxId: string,
  username?: string | null,
  nftMint?: string | null,
  botInboxId?: string | null,
): Promise<void> {
  const payload = `${JOIN_REQUEST_PREFIX}${myInboxId}:${username ?? ""}:${nftMint ?? ""}`;

  // Send to admin (so their panel still works when app is open)
  const adminDm = await client.conversations.findOrCreateDm(adminInboxId as any);
  await (adminDm as any).send(payload);

  // Also send to bot so it can auto-approve + notify admin via DM
  if (botInboxId && botInboxId !== adminInboxId && botInboxId !== myInboxId) {
    try {
      const botDm = await client.conversations.findOrCreateDm(botInboxId as any);
      await (botDm as any).send(payload);
    } catch { /* non-critical — admin DM already sent */ }
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
          // Format: JOIN_REQUEST:<inboxId>:<username>:<nftMint>
          const parts = content.slice(JOIN_REQUEST_PREFIX.length).split(":");
          const inboxId  = parts[0] ?? "";
          const username = parts[1] || undefined;
          const nftMint  = parts[2] || undefined;

          if (inboxId) {
            requests.push({ inboxId, username, nftMint, requestedAt: new Date(msg.sentNs / 1_000_000) });
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
    "REACT:", "STICKER_REACT:", "TYPING:", "PROFILE_UPDATE:", "PROFILE_SNAPSHOT:",
    "LOCATION_SYNC:", "EVENT:", "EDIT:", "PRESENCE:", "LIVE_ROOM:", "VIDEO_ROOM:",
    "AVATAR_ROOM:", "SHOP_PURCHASE:", "GIFT_ITEM:", "THREAD:", "PIN:", "UNPIN:",
    "NFT_LIST:", "NFT_BID:", "NFT_ACCEPT:", "NFT_DELIST:", "NFT_OFFER:",
    "NFT_SWAP:", "NFT_COMPLETE:", "AUTOMONKE_STATUS:", "TRADE_CLOSED:",
    "TRADE_OPENED:", "PORTFOLIO_CARD:", "PORTFOLIO_RESPONSE:", "RSVP:", "READ:",
    "BANANA_GRANT:",
  ];
  for (const p of STRUCTURED_PREFIXES) {
    if (rawContent.startsWith(p) || innerPreview.startsWith(p)) return null;
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
  };
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
  walletAddress: string;
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
        pnlPct, pnlSol,
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

// ─── PROFILE_SNAPSHOT (cross-device reclaim payload from the bot) ───────────

export interface ParsedProfileSnapshot {
  wallet: string;
  bananaBalance?: number;
  shopOwned?: string[];
  pfpBindings?: Record<string, string[]>;
  username?: string;
  legendary?: boolean;
  badges?: string[];
  marketplaceHistory?: unknown[];
  updatedAt?: number;
}

/**
 * Parse a PROFILE_SNAPSHOT: payload returned by the bot after a successful
 * /reclaim handshake. Returns null on malformed input or missing wallet field.
 */
export function parseProfileSnapshot(raw: string): ParsedProfileSnapshot | null {
  if (!raw.startsWith("PROFILE_SNAPSHOT:")) return null;
  const jsonStr = raw.slice("PROFILE_SNAPSHOT:".length);
  if (jsonStr.length > 200_000) return null;

  let data: any;
  try { data = JSON.parse(jsonStr); } catch { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (typeof data.wallet !== "string" || !data.wallet) return null;

  return {
    wallet: data.wallet,
    bananaBalance: typeof data.bb === "number" ? data.bb : undefined,
    shopOwned: Array.isArray(data.so) ? data.so.filter((s: unknown) => typeof s === "string") : undefined,
    pfpBindings: data.pb && typeof data.pb === "object" && !Array.isArray(data.pb) ? data.pb : undefined,
    username: typeof data.u === "string" ? data.u : undefined,
    legendary: data.lg === 1 || data.lg === true,
    badges: Array.isArray(data.bd) ? data.bd.filter((b: unknown) => typeof b === "string") : undefined,
    marketplaceHistory: Array.isArray(data.mh) ? data.mh : undefined,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : undefined,
  };
}

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

  const group = await client.conversations.newGroup([], {
    permissionLevel: "all_members",
    name: groupName,
  });

  console.warn(
    `[XMTP] New dApp group "${groupName}" created. Update DAPPS[].groupId to:\n'${(group as any).id}'`
  );

  return group as unknown as XmtpGroup;
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
    mutedChannels?: { bets: boolean; trades: boolean; sales: boolean; predictions: boolean };
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
