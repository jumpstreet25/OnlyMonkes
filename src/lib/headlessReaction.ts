/**
 * headlessReaction.ts
 *
 * Zero-UI send from a notification action (🍌/👍 react or MessagingStyle Reply).
 * ReactionActionReceiver starts ReactionHeadlessTaskService, which runs this
 * Headless JS task. Reuses the live XMTP client when the process is already
 * up; otherwise resumes session + client. No UI, no extra sync.
 */

import { AppRegistry } from "react-native";

export const HEADLESS_REACTION_TASK_NAME = "OnlyMonkesReaction";

interface NotifActionTaskData {
  kind?: "react" | "reply";
  messageId?: string;
  conversationId?: string;
  emoji?: string;
  replyText?: string;
}

async function resumeClient(): Promise<any | null> {
  const { loadSession } = await import("@/lib/session");
  const { bindXmtpToWallet, initXmtpClient } = await import("@/lib/xmtp");
  const { getXmtpClient } = await import("@/hooks/useXmtp");

  let client = getXmtpClient();
  if (client) return client;

  const wallet = await loadSession();
  if (!wallet?.address) {
    console.warn("[headlessNotif] no saved session — cannot resume XMTP without UI");
    return null;
  }
  bindXmtpToWallet(wallet.address);
  return initXmtpClient();
}

async function resolveUsername(): Promise<string | null> {
  try {
    const { useAppStore } = await import("@/store/appStore");
    const fromStore = useAppStore.getState().username;
    if (fromStore) return fromStore;
  } catch { /* store may not be ready in a cold headless VM */ }
  try {
    const SecureStore = await import("expo-secure-store");
    return await SecureStore.getItemAsync("profile_username");
  } catch {
    return null;
  }
}

async function headlessNotifActionTask(data: NotifActionTaskData): Promise<void> {
  const kind = data?.kind === "reply" ? "reply" : "react";
  const { messageId, conversationId, emoji, replyText } = data ?? {};
  if (!conversationId) {
    console.warn("[headlessNotif] missing conversationId, aborting");
    return;
  }
  if (kind === "react" && (!messageId || !emoji)) {
    console.warn("[headlessNotif] react missing fields, aborting");
    return;
  }
  if (kind === "reply" && !replyText?.trim()) {
    console.warn("[headlessNotif] reply missing text, aborting");
    return;
  }

  try {
    const client = await resumeClient();
    if (!client) return;

    const conversation = await client.conversations.findConversation(conversationId as any);
    if (!conversation) {
      console.warn("[headlessNotif] conversation not found");
      return;
    }

    if (kind === "react") {
      await (conversation as any).send({
        reaction: {
          reference: messageId,
          action: "added",
          schema: "unicode",
          content: emoji,
        },
      });
      return;
    }

    const text = replyText!.trim().slice(0, 500);
    const username = await resolveUsername();
    const packed = username ? `MSG:${username}:${text}` : text;
    if (messageId) {
      await (conversation as any).send({
        reply: {
          reference: messageId,
          content: { text: packed },
        },
      });
    } else {
      await (conversation as any).send(packed);
    }
  } catch (err) {
    console.warn("[headlessNotif] failed:", (err as Error)?.message ?? err);
  }
}

AppRegistry.registerHeadlessTask(HEADLESS_REACTION_TASK_NAME, () => headlessNotifActionTask);
