/**
 * XMTP Messaging Service — v5 (MLS protocol)
 *
 * Message format:
 *   Regular:  MSG:<username>:<content>
 *   Reply:    MSG:<username>:REPLY:<targetId>:<targetSender>:<content>
 *   Reaction: REACT:🍌:<targetMessageId>
 *
 * Uses createRandom() — no Ethereum signer needed (Solana compatible).
 * XMTP identity is persisted in SecureStore across sessions.
 */

import { Client, Group, PublicIdentity } from "@xmtp/react-native-sdk";
import type { ChatMessage, MessageReaction, ReactionEmoji, StickerReaction } from "@/types";
import { REACTIONS } from "./constants";
import * as SecureStore from "expo-secure-store";
import type { JoinRequest } from "@/store/appStore";

export type XmtpClient = Client;
export type XmtpGroup = Group;

// ─── SecureStore keys ────────────────────────────────────────────────────────

const SK_ENC_KEY = "xmtp_v5_enc_key";
const SK_INBOX_ID = "xmtp_v5_inbox_id";
const SK_IDENTITY_ID = "xmtp_v5_identity_id";
const SK_IDENTITY_KIND = "xmtp_v5_identity_kind";

async function getOrCreateEncryptionKey(): Promise<Uint8Array> {
  const stored = await SecureStore.getItemAsync(SK_ENC_KEY);
  if (stored) return Buffer.from(stored, "base64");

  const key = crypto.getRandomValues(new Uint8Array(32));
  await SecureStore.setItemAsync(SK_ENC_KEY, Buffer.from(key).toString("base64"));
  return key;
}

// ─── Client Init ─────────────────────────────────────────────────────────────

export async function initXmtpClient(): Promise<Client> {
  const dbEncryptionKey = await getOrCreateEncryptionKey();
  const opts = { env: "production" as const, dbEncryptionKey };

  const storedInboxId = await SecureStore.getItemAsync(SK_INBOX_ID);
  const storedIdentifier = await SecureStore.getItemAsync(SK_IDENTITY_ID);
  const storedKind = await SecureStore.getItemAsync(SK_IDENTITY_KIND);

  if (storedInboxId && storedIdentifier && storedKind) {
    try {
      const identity = new PublicIdentity(
        storedIdentifier,
        storedKind as "ETHEREUM" | "PASSKEY"
      );
      return await Client.build(identity, opts, storedInboxId as any);
    } catch {
      // Corrupt state — fall through to create a fresh identity
    }
  }

  const client = await Client.createRandom(opts);

  await SecureStore.setItemAsync(SK_INBOX_ID, client.inboxId);
  await SecureStore.setItemAsync(SK_IDENTITY_ID, client.publicIdentity.identifier);
  await SecureStore.setItemAsync(SK_IDENTITY_KIND, client.publicIdentity.kind);

  return client;
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
    await client.conversations.sync();
    // Also sync all conversations to pick up group invites from epoch updates
    try { await client.conversations.syncAllConversations(); } catch { /* ignore */ }
    const found = await client.conversations.findGroup(groupId as any);
    if (found) return { group: found as unknown as XmtpGroup, isNewAdmin: false };
    // Group ID set but user is not yet a member — must be added by admin.
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

export function decodeMessage(raw: any, myInboxId: string): ChatMessage | null {
  try {
    const rawContent: unknown = raw.content();
    if (!rawContent || typeof rawContent !== "string") return null;

    // System messages — handled separately, not displayed in chat
    if (rawContent.startsWith("REACT:")) return null;
    if (rawContent.startsWith("STICKER_REACT:")) return null;
    if (rawContent.startsWith("TYPING:")) return null;
    if (rawContent.startsWith("PROFILE_UPDATE:")) return null;
    if (rawContent.startsWith("EVENT:")) return null;
    if (rawContent.startsWith("EDIT:")) return null;

    const { username, inner } = parseContent(rawContent);

    let content = inner;
    let replyTo: ChatMessage["replyTo"] | undefined;

    if (inner.startsWith("REPLYv2:")) {
      // Format: REPLYv2:<targetId>:<targetSender>:<targetUsername>:<origBase64>:<replyContent>
      // Base64 has no ":" so the first 5 fields are safe to split; replyContent
      // is reassembled with join(":") to preserve any colons the user typed.
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
        content: originalContent,   // ← the quoted original text
      };
      content = replyContent;       // ← the new reply text

    } else if (inner.startsWith("REPLY:")) {
      // Legacy format (messages sent before REPLYv2). Original content was not
      // stored, so replyTo.content will be empty — better than showing wrong text.
      const parts = inner.split(":");
      const [, targetId, targetSender, ...rest] = parts;
      const replyContent = rest.join(":");
      replyTo = {
        id: targetId,
        senderAddress: targetSender,
        senderUsername: undefined,
        content: "",  // original content was never stored in legacy format
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
  } catch {
    return null;
  }
}

export function applyReaction(
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

  if (!content?.startsWith("REACT:")) return messages;

  const [, emoji, targetId] = content.split(":");
  const sender: string = raw.senderInboxId;

  return messages.map((msg) => {
    if (msg.id !== targetId) return msg;

    const reactions = { ...msg.reactions };
    const existing = reactions[emoji as ReactionEmoji];
    if (!existing) return msg;

    const alreadyReacted = existing.reactors.includes(sender);
    reactions[emoji as ReactionEmoji] = {
      ...existing,
      count: alreadyReacted ? existing.count - 1 : existing.count + 1,
      reactedByMe:
        sender === myInboxId ? !existing.reactedByMe : existing.reactedByMe,
      reactors: alreadyReacted
        ? existing.reactors.filter((r) => r !== sender)
        : [...existing.reactors, sender],
    };

    return { ...msg, reactions };
  });
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

  return messages.map((msg) => {
    if (msg.id !== targetId) return msg;
    // Only the original sender can edit their own message
    if (msg.senderAddress !== sender) return msg;
    return { ...msg, editedContent: newContent, editedAt: new Date() };
  });
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
    await client.conversations.sync();
    const found = await client.conversations.findGroup(groupId as any);
    if (found) return found as unknown as XmtpGroup;
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
  // REPLYv2 format embeds the original message's content (base64) and sender
  // username so the quoted preview is always correct after decoding.
  // Base64 never contains ":" so splitting on ":" is safe for all fields except
  // replyContent itself, which is reassembled with rest.join(":").
  const origB64 = Buffer.from(targetMessage.content).toString("base64");
  const origUsername = targetMessage.senderUsername ?? "";
  const inner = `REPLYv2:${targetMessage.id}:${targetMessage.senderAddress}:${origUsername}:${origB64}:${replyContent}`;
  const packed = username ? `MSG:${username}:${inner}` : inner;
  await (group as any).send(packed);
}

export async function sendReaction(
  group: XmtpGroup,
  emoji: ReactionEmoji,
  targetMessageId: string
): Promise<void> {
  const packed = `REACT:${emoji}:${targetMessageId}`;
  await (group as any).send(packed);
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
  legendary?: boolean,
  pushToken?: string | null,
  notifPrefs?: {
    all: boolean; mentions: boolean; bot: boolean; dm: boolean; live: boolean;
    mutedChannels?: { bets: boolean; trades: boolean; sales: boolean; predictions: boolean };
    mutedSports?: string[];
  } | null,
  expoPushToken?: string | null,
): Promise<void> {
  const payload = JSON.stringify({
    id: inboxId,
    u: username ?? "",
    b: bio ?? "",
    x: xAccount ?? "",
    w: walletAddress ?? "",
    tw: tipWallet ?? "",
    ni: nftImage ?? "",
    lg: legendary ? 1 : 0,
    pt: pushToken ?? "",
    np: notifPrefs ? {
      all: notifPrefs.all, mentions: notifPrefs.mentions, bot: notifPrefs.bot,
      dm: notifPrefs.dm, live: notifPrefs.live,
      mc: notifPrefs.mutedChannels ?? null,
      ms: notifPrefs.mutedSports ?? null,
    } : null,
    ept: expoPushToken ?? "",
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
      const msgs: any[] = await (convo as any).messages({ limit: 1 });
      const last = msgs[0];
      let lastMessage: string | null = null;
      let lastMessageAt: Date | null = null;

      if (last) {
        try {
          const raw: string = last.content();
          // Parse MSG:<username>:<content> → show just the content part
          if (typeof raw === 'string') {
            if (raw.startsWith('MSG:')) {
              const parts = raw.split(':');
              lastMessage = parts.slice(2).join(':');
            } else if (raw.startsWith('JOIN_REQUEST:')) {
              continue; // skip join-request DMs from the inbox list
            } else {
              lastMessage = raw;
            }
          }
        } catch { /* skip */ }
        lastMessageAt = last.sentNs
          ? new Date(Number(last.sentNs) / 1_000_000)
          : null;
      }

      threads.push({ peerInboxId, lastMessage, lastMessageAt });
    } catch {
      threads.push({ peerInboxId, lastMessage: null, lastMessageAt: null });
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

export async function loadDmMessages(dm: any, myInboxId: string): Promise<ChatMessage[]> {
  await dm.sync();
  await dm.sync(); // second pass ensures bot replies committed before fetching
  const raw: any[] = await dm.messages({ limit: 200 });
  return raw.map(r => decodeMessage(r, myInboxId)).filter(Boolean) as ChatMessage[];
}

export async function sendDmMessage(dm: any, content: string, username?: string | null): Promise<void> {
  const payload = username ? `MSG:${username}:${content}` : content;
  await dm.send(payload);
}

// ─── Sticker Reactions ────────────────────────────────────────────────────────

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

  return messages.map((msg) => {
    if (msg.id !== targetId) return msg;

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

    return { ...msg, stickerReactions };
  });
}
