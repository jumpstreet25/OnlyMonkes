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
import type { ChatMessage, MessageReaction, ReactionEmoji } from "@/types";
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
    await client.conversations.sync();
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
 * Tester sends a DM to the admin's inboxId to request group membership.
 * Format: JOIN_REQUEST:<myInboxId>:<username>
 */
export async function sendJoinRequestDM(
  client: XmtpClient,
  adminInboxId: string,
  myInboxId: string,
  username?: string | null
): Promise<void> {
  const dm = await (client.conversations as any).newDm(adminInboxId);
  const payload = `${JOIN_REQUEST_PREFIX}${myInboxId}:${username ?? ""}`;
  await (dm as any).send(payload);
}

/**
 * Admin calls this to scan all DMs and collect pending join requests.
 */
export async function fetchJoinRequests(client: XmtpClient): Promise<JoinRequest[]> {
  await client.conversations.sync();
  const allConvos: any[] = await (client.conversations as any).list();

  const requests: JoinRequest[] = [];

  for (const convo of allConvos) {
    // Skip groups — only process DM conversations.
    if (typeof (convo as any).isGroup !== "undefined" && (convo as any).isGroup) continue;
    if (typeof (convo as any).peerInboxId === "undefined") continue;

    try {
      await (convo as any).sync();
      const msgs: any[] = await (convo as any).messages({ limit: 20 });

      for (const msg of msgs) {
        let content: string;
        try { content = msg.content(); } catch { continue; }

        if (typeof content === "string" && content.startsWith(JOIN_REQUEST_PREFIX)) {
          const rest = content.slice(JOIN_REQUEST_PREFIX.length);
          const colonIdx = rest.indexOf(":");
          const inboxId  = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
          const username = colonIdx === -1 ? undefined : rest.slice(colonIdx + 1) || undefined;

          if (inboxId) {
            requests.push({ inboxId, username, requestedAt: new Date(msg.sentNs / 1_000_000) });
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
    if (rawContent.startsWith("PROFILE_UPDATE:")) return null;
    if (rawContent.startsWith("EVENT:")) return null;

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

export async function sendProfileUpdate(
  group: XmtpGroup,
  inboxId: string,
  username?: string | null,
  bio?: string | null,
  xAccount?: string | null,
  walletAddress?: string | null,
  tipWallet?: string | null,
  nftImage?: string | null
): Promise<void> {
  const payload = JSON.stringify({
    id: inboxId,
    u: username ?? "",
    b: bio ?? "",
    x: xAccount ?? "",
    w: walletAddress ?? "",
    tw: tipWallet ?? "",
    ni: nftImage ?? "",
  });
  await (group as any).send(`PROFILE_UPDATE:${payload}`);
}

export async function sendEventMessage(
  group: XmtpGroup,
  eventJson: string
): Promise<void> {
  await (group as any).send(`EVENT:${eventJson}`);
}
