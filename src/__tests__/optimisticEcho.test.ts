import { dropOptimisticEchoes, hasRealEcho } from "../lib/optimisticEcho";
import type { ChatMessage } from "../types";

const msg = (id: string, content: string, at: number, sender = "me"): ChatMessage =>
  ({ id, senderAddress: sender, content, sentAt: new Date(at), reactions: {} } as ChatMessage);

describe("optimistic echo (Genesis double message)", () => {
  const t = 1_800_000_000_000;
  const local = msg("optimistic-1", "GMobile", t);

  it("the real message replaces the local copy", () => {
    const real = msg("abc", "GMobile", t + 800);
    expect(dropOptimisticEchoes([msg("x", "older", t - 9000, "other"), local], [real]).map((m) => m.id)).toEqual(["x"]);
  });

  it("keeps the local copy for different text, sender or a stale match", () => {
    expect(dropOptimisticEchoes([local], [msg("a", "other text", t)])).toHaveLength(1);
    expect(dropOptimisticEchoes([local], [msg("b", "GMobile", t, "someone")])).toHaveLength(1);
    expect(dropOptimisticEchoes([local], [msg("c", "GMobile", t + 10 * 60 * 1000)])).toHaveLength(1);
  });

  it("skips adding the local copy when the echo came first", () => {
    expect(hasRealEcho([msg("abc", "GMobile", t - 300)], local)).toBe(true);
    expect(hasRealEcho([], local)).toBe(false);
  });
});
