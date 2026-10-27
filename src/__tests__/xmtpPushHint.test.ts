import { isXmtpHint } from "@/lib/xmtpPushHint";

describe("isXmtpHint", () => {
  const hint = { topic: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8g", sequence_id: "9007199254740993" };

  it("accepts the backend payload at any nesting expo-notifications uses", () => {
    expect(isXmtpHint(hint)).toBe(true);
    expect(isXmtpHint({ data: hint })).toBe(true);
    expect(isXmtpHint({ notification: { request: { content: { data: hint } } } })).toBe(true);
    expect(isXmtpHint({ data: { body: JSON.stringify(hint) } })).toBe(true);
  });

  it("ignores the bot relay's own pushes and junk", () => {
    expect(isXmtpHint({ data: { type: "om_bot_v8", title: "GM" } })).toBe(false);
    expect(isXmtpHint({ topic: "x" })).toBe(false);
    expect(isXmtpHint(null)).toBe(false);
    expect(isXmtpHint("topic")).toBe(false);
  });
});
