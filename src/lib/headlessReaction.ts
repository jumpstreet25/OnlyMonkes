/**
 * headlessReaction.ts
 *
 * True background reaction-from-notification: tapping a reaction action
 * button on a chat-message notification (see DirectNotifModule.kt's
 * showWithReactions()) never opens any UI. Android instead starts
 * ReactionHeadlessTaskService (native), which runs this file as a React
 * Native Headless JS Task — a JS execution context with no Activity/UI.
 *
 * HeadlessJsTaskService (React Native core) automatically REUSES the app's
 * existing JS context if the process is already alive in the background,
 * or spins up a fresh headless-only context if the process was fully
 * killed. Either way there is only ever one JS VM touching the XMTP local
 * database — no risk of a foreground app instance and a separate headless
 * instance racing each other on the same SQLite file.
 *
 * Must complete quickly (Android expects headless tasks to finish in
 * seconds, not tens of seconds) — this does the minimum needed to send one
 * reaction: resume session → resume XMTP client → find the conversation →
 * send → done. No UI, no navigation, no unrelated XMTP sync work.
 */

import { AppRegistry } from "react-native";

export const HEADLESS_REACTION_TASK_NAME = "OnlyMonkesReaction";

interface ReactionTaskData {
  messageId?: string;
  conversationId?: string;
  emoji?: string;
}

async function headlessReactionTask(data: ReactionTaskData): Promise<void> {
  const { messageId, conversationId, emoji } = data ?? {};
  if (!messageId || !conversationId || !emoji) {
    console.warn("[headlessReaction] missing required fields, aborting:", data);
    return;
  }

  try {
    const { loadSession } = await import("@/lib/session");
    const { bindXmtpToWallet, initXmtpClient } = await import("@/lib/xmtp");
    const { getXmtpClient } = await import("@/hooks/useXmtp");

    // Reuse an already-live client if the app happens to be running in the
    // background — avoids a redundant resume + session sync round trip.
    let client = getXmtpClient();
    if (!client) {
      const wallet = await loadSession();
      if (!wallet?.address) {
        console.warn("[headlessReaction] no saved session — cannot resume XMTP without UI");
        return;
      }
      bindXmtpToWallet(wallet.address);
      client = await initXmtpClient();
    }

    const conversation = await client.conversations.findConversation(conversationId as any);
    if (!conversation) {
      console.warn("[headlessReaction] conversation not found:", conversationId);
      return;
    }

    await (conversation as any).send({
      reaction: {
        reference: messageId,
        action: "added",
        schema: "unicode",
        content: emoji,
      },
    });
  } catch (err) {
    // Headless tasks have no UI to surface an error to — best effort, log
    // and let it drop. The user can still react normally from inside the
    // app if this silently failed (network blip, expired session, etc.).
    console.warn("[headlessReaction] failed:", (err as Error)?.message ?? err);
  }
}

AppRegistry.registerHeadlessTask(HEADLESS_REACTION_TASK_NAME, () => headlessReactionTask);
