import type { ChatMessage } from "@/types";

/**
 * Group screens (Genesis) show a sent message right away under an `optimistic-` id, because the
 * old SDK's stream didn't always echo our own sends. SDK 8 does echo them, so the real message
 * then showed up next to the local copy (3.1 test, 2026-11-19: "it sent a double message").
 * The real message replaces the local copy: same sender + same text within a few minutes.
 */
export const OPTIMISTIC_PREFIX = "optimistic-";
const ECHO_WINDOW_MS = 5 * 60 * 1000;

const isEcho = (local: ChatMessage, real: ChatMessage) =>
  !real.id.startsWith(OPTIMISTIC_PREFIX) &&
  real.senderAddress === local.senderAddress &&
  real.content === local.content &&
  Math.abs(real.sentAt.getTime() - local.sentAt.getTime()) < ECHO_WINDOW_MS;

/** `prev` without the local copies that one of `incoming` is the real version of. */
export function dropOptimisticEchoes(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0 || !prev.some((m) => m.id.startsWith(OPTIMISTIC_PREFIX))) return prev;
  return prev.filter((m) => !m.id.startsWith(OPTIMISTIC_PREFIX) || !incoming.some((r) => isEcho(m, r)));
}

/** True when the real message for this local copy already arrived (the echo beat the send's return). */
export function hasRealEcho(prev: ChatMessage[], local: ChatMessage): boolean {
  return prev.some((r) => isEcho(local, r));
}
