/**
 * offlineQueue.ts
 *
 * Persistent offline message queue backed by AsyncStorage.
 * Messages that fail to send while offline are queued here and
 * auto-flushed when the network comes back (triggered by backgroundSync).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const AK_QUEUE = "offline_msg_queue_v1";
const MAX_QUEUE_SIZE = 50;
const MAX_RETRIES = 3;

export interface QueuedMessage {
  id: string;         // matches the optimistic message id in chatStore
  content: string;
  replyTo?: { id: string; content: string; senderAddress: string; senderUsername?: string };
  queuedAt: number;
  retryCount: number;
}

let _flushing = false;

async function loadQueue(): Promise<QueuedMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(AK_QUEUE);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveQueue(queue: QueuedMessage[]): Promise<void> {
  await AsyncStorage.setItem(AK_QUEUE, JSON.stringify(queue));
}

export async function enqueueMessage(msg: QueuedMessage): Promise<void> {
  const queue = await loadQueue();
  queue.push(msg);
  // Trim oldest if over limit
  while (queue.length > MAX_QUEUE_SIZE) queue.shift();
  await saveQueue(queue);
  console.log(`[OfflineQueue] Enqueued message (${queue.length} in queue)`);
}

export async function dequeueMessage(id: string): Promise<void> {
  const queue = await loadQueue();
  await saveQueue(queue.filter(m => m.id !== id));
}

export async function getQueuedMessages(): Promise<QueuedMessage[]> {
  return loadQueue();
}

export async function getQueueSize(): Promise<number> {
  return (await loadQueue()).length;
}

/**
 * Flush the offline queue by attempting to send each message.
 * Called automatically when network comes back online.
 *
 * @param sendFn  — function to send a plain text message via XMTP
 * @param replyFn — function to send a reply via XMTP
 * @param updateStatus — chatStore.updateMessageStatus
 */
export async function flushOfflineQueue(
  sendFn: (text: string) => Promise<void>,
  replyFn: (replyTo: QueuedMessage["replyTo"], text: string) => Promise<void>,
  updateStatus: (id: string, status: "sending" | "sent" | "failed") => void,
): Promise<void> {
  if (_flushing) return;
  _flushing = true;

  try {
    const queue = await loadQueue();
    if (queue.length === 0) return;

    console.log(`[OfflineQueue] Flushing ${queue.length} queued message(s)`);
    const remaining: QueuedMessage[] = [];

    for (const msg of queue) {
      try {
        updateStatus(msg.id, "sending");
        if (msg.replyTo) {
          await replyFn(msg.replyTo, msg.content);
        } else {
          await sendFn(msg.content);
        }
        updateStatus(msg.id, "sent");
        console.log(`[OfflineQueue] Sent queued message ${msg.id}`);
      } catch {
        msg.retryCount++;
        if (msg.retryCount >= MAX_RETRIES) {
          updateStatus(msg.id, "failed");
          console.log(`[OfflineQueue] Gave up on ${msg.id} after ${MAX_RETRIES} retries`);
        } else {
          remaining.push(msg);
        }
      }
    }

    await saveQueue(remaining);
  } finally {
    _flushing = false;
  }
}
