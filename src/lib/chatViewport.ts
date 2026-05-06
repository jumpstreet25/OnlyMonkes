/**
 * chatViewport.ts — Module-level shared values exposing chat-screen layout
 * state to background world layers (BananaGroveWorld, etc).
 *
 * `latestBubbleHeightSV` is the measured height of the BOTTOMMOST (newest)
 * message bubble in main chat. ChatMessageList sets it via MessageBubble's
 * onLayout when isLatest is true; world layers read it on a render-loop tick
 * to decide when their accumulating pile should fade + reset (so the pile
 * never visually overlaps the latest message bubble).
 *
 * Default 60px = a reasonable single-line bubble. Stays at last-known value
 * after the user navigates away from chat — fine for our purposes.
 */

import { makeMutable, type SharedValue } from "react-native-reanimated";

export const latestBubbleHeightSV: SharedValue<number> = makeMutable(60);

/** JS-thread setter — safe to call from non-worklet code. */
export function setLatestBubbleHeight(h: number): void {
  if (Number.isFinite(h) && h > 0 && h < 2000) {
    latestBubbleHeightSV.value = h;
  }
}
