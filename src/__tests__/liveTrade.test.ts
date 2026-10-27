import { parseLiveTrade } from "@/lib/liveTrade";

const fcm = { type: "om_live_trade", id: "p1", sym: "QI", state: "open", pnl: "4.5", price: "1.045", entry: "1", stop: "0.9", t1: "1.2", t2: "1.5", t1Hit: "false", t2Hit: "true", ts: "1" };

describe("parseLiveTrade", () => {
  it("reads the bot's string-valued FCM data at any nesting", () => {
    for (const p of [fcm, { data: fcm }, { notification: { request: { content: { data: fcm } } } }, { data: { body: JSON.stringify(fcm) } }]) {
      const t = parseLiveTrade(p)!;
      expect(t.pnl).toBe(4.5);
      expect(t.t2Hit).toBe(true);
      expect(t.t1Hit).toBe(false);
    }
  });
  it("ignores XMTP hints and broken payloads", () => {
    expect(parseLiveTrade({ topic: "x", sequence_id: "1" })).toBeNull();
    expect(parseLiveTrade({ ...fcm, price: "abc" })).toBeNull();
    expect(parseLiveTrade({ ...fcm, state: "closed", price: "" })?.state).toBe("closed");
  });
});
