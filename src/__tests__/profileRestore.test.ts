import { unwrapBotEnvelope, parseProfileSnapshot, snapshotWalletAllowed } from "../lib/profileSnapshot";

describe("profile auto-restore", () => {
  it("unwraps the bot MSG envelope", () => {
    expect(unwrapBotEnvelope("PROFILE_SNAPSHOT:{}")).toBe("PROFILE_SNAPSHOT:{}");
    expect(unwrapBotEnvelope("MSG:AI Agent #9385:PROFILE_SNAPSHOT:{\"wallet\":\"W\"}")).toBe(
      "PROFILE_SNAPSHOT:{\"wallet\":\"W\"}",
    );
  });

  it("parses wrapped PROFILE_SNAPSHOT payloads", () => {
    const parsed = parseProfileSnapshot(
      'MSG:AI Agent #9385:PROFILE_SNAPSHOT:{"wallet":"Abc","bb":42,"so":["bubble_gold_glow"]}',
    );
    expect(parsed).toEqual(
      expect.objectContaining({
        wallet: "Abc",
        bananaBalance: 42,
        shopOwned: ["bubble_gold_glow"],
      }),
    );
  });

  it("parses bio and location, capped, blank as missing", () => {
    const p = parseProfileSnapshot(`PROFILE_SNAPSHOT:${JSON.stringify({ wallet: "W", b: "gm", loc: "x".repeat(80) })}`);
    expect(p?.bio).toBe("gm");
    expect(p?.location).toHaveLength(50);
    const blank = parseProfileSnapshot('PROFILE_SNAPSHOT:{"wallet":"W","b":"  ","loc":""}');
    expect(blank?.bio).toBeUndefined();
    expect(blank?.location).toBeUndefined();
  });

  it("rejects a snapshot for a different connected wallet", () => {
    expect(snapshotWalletAllowed("WalletA", "WalletA")).toBe(true);
    expect(snapshotWalletAllowed("WalletA", null)).toBe(true);
    expect(snapshotWalletAllowed("WalletA", "WalletB")).toBe(false);
    expect(snapshotWalletAllowed("", "WalletA")).toBe(false);
  });
});
