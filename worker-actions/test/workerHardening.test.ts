import { webcrypto } from "crypto";

jest.mock("../src/index", () => ({ fetchOwnedMonke: jest.fn() }));
jest.mock("../src/genesisVerify", () => ({ verifyGenesisTokenOwnership: jest.fn() }));
jest.mock("../src/webAuth", () => ({
  holderWalletFromToken: jest.fn(async (_env: unknown, token: string) => (token === "good" ? HOLDER : null)),
  holderWalletFromRequest: jest.fn(async (req: Request) => (req.headers.get("Authorization") === "Bearer good" ? HOLDER : null)),
}));

import { handleLivekitAuthorize, identityWalletMatch } from "../src/livekitAuth";
import { publicLimitName, publicRateLimited } from "../src/publicLimits";
import { handleWebRpc } from "../src/webRpc";

if (!globalThis.crypto?.subtle) (globalThis as any).crypto = webcrypto;

const HOLDER = "7tLrUKmkcBRVmwXtiRo8cTj6Mw2TGhFxyeNmKaU9mqZx";
const BOT = "998001a498174b8a194110ee792b10f97de4965665eaf0d088ed2c71bdf62363";
const MY_INBOX = "a".repeat(64);
const VICTIM_INBOX = "b".repeat(64);
const ROOM = "om-1730000000000-abc";

/** Bot /web-profile stand-in: MY_INBOX named HOLDER, VICTIM_INBOX named someone else. */
let botCalls: Array<Record<string, unknown>> = [];
let botDown = false;
const realFetch = global.fetch;
beforeEach(() => {
  botCalls = [];
  botDown = false;
  global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith("/web-profile")) {
      if (botDown) throw new Error("tunnel down");
      const body = JSON.parse(init?.body ?? "{}");
      botCalls.push(body);
      const claimed: Record<string, string> = { [MY_INBOX]: HOLDER, [VICTIM_INBOX]: "VictimWa11etVictimWa11etVictimWa11et1111" };
      const c = claimed[body.inboxId];
      return new Response(JSON.stringify({ walletMatch: c ? c === body.checkWallet : null }));
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }));
  }) as unknown as typeof fetch;
});
afterAll(() => { global.fetch = realFetch; });

const env: any = { BOT_PROFILE_URL: "https://bot.example", BOT_HTTP_SECRET: "s" };
const authorize = (identity: string, proof: unknown = { kind: "holder", token: "good" }) =>
  handleLivekitAuthorize(
    new Request("https://internal.onlymonkes/api/livekit/authorize", { method: "POST", body: JSON.stringify({ roomName: ROOM, identity, proof }) }),
    env,
  );

describe("LiveKit identity is tied to the proven wallet (audit H1)", () => {
  it("mints for my own inbox", async () => {
    expect((await authorize(MY_INBOX)).status).toBe(200);
    expect(botCalls[0]).toEqual({ inboxId: MY_INBOX, checkWallet: HOLDER });
  });

  it("refuses another member's inbox", async () => {
    const r = await authorize(VICTIM_INBOX);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "identity belongs to another wallet" });
  });

  it("checks a ~phone companion against its owner's inbox", async () => {
    expect((await authorize(`${VICTIM_INBOX}~phone`)).status).toBe(403);
    expect((await authorize(`${MY_INBOX}~phone`)).status).toBe(200);
  });

  it("never gives a holder the bot's identity", async () => {
    expect((await authorize(BOT)).status).toBe(403);
    expect((await authorize(`${BOT}~probe`)).status).toBe(403);
    expect(botCalls).toHaveLength(0);
  });

  it("still mints when the bot can't answer (logged as unchecked)", async () => {
    botDown = true;
    expect((await authorize(MY_INBOX)).status).toBe(200);
    expect(await identityWalletMatch(env, VICTIM_INBOX, HOLDER)).toBeNull();
  });

  it("mints for an inbox that never named a wallet", async () => {
    expect((await authorize("c".repeat(64))).status).toBe(200);
  });

  it("an expired holder token is still refused first", async () => {
    expect((await authorize(MY_INBOX, { kind: "holder", token: "old" })).status).toBe(401);
  });
});

function limiter(allow: (key: string) => boolean) {
  const keys: string[] = [];
  return { keys, limit: async ({ key }: { key: string }) => { keys.push(key); return { success: allow(key) }; } };
}
const req = (path: string, ip = "1.2.3.4", headers: Record<string, string> = {}) =>
  new Request(`https://onlymonkes.app${path}`, { method: "POST", headers: { "CF-Connecting-IP": ip, ...headers } });

describe("public route limits (audit H3/H4)", () => {
  it("covers the routes that spend Helius or KV, and nothing else", () => {
    expect(publicLimitName("/api/verify")).toBe("verify");
    expect(publicLimitName("/monke/abc")).toBe("monke");
    expect(publicLimitName("/monke/abc/image")).toBe("monke");
    expect(publicLimitName("/api/device-integrity/challenge")).toBe("dichallenge");
    expect(publicLimitName("/api/community/events/e1/rsvps")).toBe("rsvps");
    expect(publicLimitName("/api/device-integrity/issue")).toBeNull();
    expect(publicLimitName("/welcome")).toBeNull();
  });

  it("limits per IP, per route", async () => {
    const ip = limiter((k) => k !== "verify:9.9.9.9");
    const e = { PUBLIC_IP_LIMITER: ip };
    expect(await publicRateLimited(req("/api/verify", "9.9.9.9"), "/api/verify", e)).toBe(true);
    expect(await publicRateLimited(req("/api/verify", "1.1.1.1"), "/api/verify", e)).toBe(false);
    expect(await publicRateLimited(req("/claim", "9.9.9.9"), "/claim", e)).toBe(false);
  });

  it("stops an IP-rotating flood at the global ceiling", async () => {
    const e = { PUBLIC_IP_LIMITER: limiter(() => true), PUBLIC_GLOBAL_LIMITER: limiter((k) => k !== "g:dichallenge") };
    expect(await publicRateLimited(req("/api/device-integrity/challenge", "5.5.5.5"), "/api/device-integrity/challenge", e)).toBe(true);
  });

  it("never blocks without bindings or on other paths", async () => {
    expect(await publicRateLimited(req("/api/verify"), "/api/verify", {})).toBe(false);
    const e = { PUBLIC_IP_LIMITER: limiter(() => false) };
    expect(await publicRateLimited(req("/welcome"), "/welcome", e)).toBe(false);
  });
});

describe("web RPC proxy takes the sign-in token (audit H2)", () => {
  const rpcEnv = (over: Record<string, unknown> = {}): any => ({
    HELIUS_API_KEY: "k", WEB_APP_ORIGINS: "https://onlymonkes.app", ...over,
  });
  const rpc = (e: any, auth?: string) =>
    handleWebRpc(
      new Request("https://onlymonkes.app/api/rpc", {
        method: "POST",
        headers: { Origin: "https://onlymonkes.app", "CF-Connecting-IP": "1.2.3.4", ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [HOLDER] }),
      }),
      e,
    );

  it("works without a token until the flag is on", async () => {
    expect((await rpc(rpcEnv())).status).toBe(200);
  });

  it("with WEB_RPC_REQUIRE_AUTH=1, refuses calls without a valid token", async () => {
    expect((await rpc(rpcEnv({ WEB_RPC_REQUIRE_AUTH: "1" }))).status).toBe(401);
    expect((await rpc(rpcEnv({ WEB_RPC_REQUIRE_AUTH: "1" }), "Bearer forged")).status).toBe(401);
    expect((await rpc(rpcEnv({ WEB_RPC_REQUIRE_AUTH: "1" }), "Bearer good")).status).toBe(200);
  });

  it("limits a signed-in caller per wallet, others per IP", async () => {
    const l = limiter(() => true);
    await rpc(rpcEnv({ WEB_RPC_LIMITER: l }), "Bearer good");
    await rpc(rpcEnv({ WEB_RPC_LIMITER: l }));
    expect(l.keys).toEqual([`rpc:w:${HOLDER}`, "rpc:1.2.3.4"]);
  });

  it("stops at the global ceiling", async () => {
    expect((await rpc(rpcEnv({ RPC_GLOBAL_LIMITER: limiter(() => false) }))).status).toBe(429);
  });

  it("a forged Origin alone no longer reaches Helius once the flag is on", async () => {
    expect((await rpc(rpcEnv({ WEB_RPC_REQUIRE_AUTH: "1" }))).status).toBe(401);
  });
});
