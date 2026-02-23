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
import { GLOBAL_GROUP_ID, REACTIONS } from "./constants";
import * as SecureStore from "expo-secure-store";

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

export async function getOrCreateGlobalChat(
  client: XmtpClient
): Promise<XmtpGroup> {
  // Only sync when we have a known group ID — avoids slow network call on first run
  if (GLOBAL_GROUP_ID) {
    await client.conversations.sync();
    const found = await client.conversations.findGroup(GLOBAL_GROUP_ID as any);
    if (found) return found as unknown as XmtpGroup;
  }

  // Use newGroup (simpler, more reliable than newGroupCustomPermissions)
  const group = await client.conversations.newGroup([], {
    permissionLevel: "all_members",
    name: "OnlyMonkes Global Chat",
  });

  console.warn(
    `[XMTP] New group created. Set in constants.ts:\nexport const GLOBAL_GROUP_ID = '${(group as any).id}';`
  );

  return group as unknown as XmtpGroup;
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

    // Reactions are handled separately
    if (rawContent.startsWith("REACT:")) return null;

    const { username, inner } = parseContent(rawContent);

    let content = inner;
    let replyTo: ChatMessage["replyTo"] | undefined;

    if (inner.startsWith("REPLY:")) {
      // Format: REPLY:<targetId>:<targetSender>:<replyContent>
      const parts = inner.split(":");
      const [, targetId, targetSender, ...rest] = parts;
      const replyContent = rest.join(":");
      // replyContent may itself be MSG:<username>:<text>
      const parsed = parseContent(replyContent);
      replyTo = {
        id: targetId,
        senderAddress: targetSender,
        senderUsername: parsed.username,
        content: parsed.inner,
      };
      content = parsed.inner; // show the actual reply text as the message content
      // The message's own content is the reply text (already parsed above)
      // but we need the content field to be the actual reply text, not the REPLY: wrapper
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
  const inner = `REPLY:${targetMessage.id}:${targetMessage.senderAddress}:${replyContent}`;
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
