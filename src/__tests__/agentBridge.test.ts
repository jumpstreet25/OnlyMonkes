import {
  botHealthEvent, holdersChangeEvent, probeBot, relayEvent, salesDailyEvent, scrubPrivate, sentryEvent,
  type AgentBridgeEnv,
} from "../../worker-actions/src/agentBridge";
import { bearerOk } from "../../worker-actions/src/botAuth";

const ENV: AgentBridgeEnv = { GROK_RELAY_URL: "https://relay.example/hook", GROK_RELAY_KEY: "k3y" };
const realFetch = global.fetch;
const res = (status: number) => ({ ok: status >= 200 && status < 300, status }) as Response;
let t = 1_000_000_000;
const tick = () => (t += 120_000); // a fresh rate-limit window per test

afterEach(() => { global.fetch = realFetch; });

describe("relayEvent", () => {
  test("no-op (false, no fetch) without both secrets or with a non-https URL", async () => {
    const f = jest.fn();
    global.fetch = f as never;
    expect(await relayEvent({}, { type: "bot_health", data: {} }, tick())).toBe(false);
    expect(await relayEvent({ GROK_RELAY_URL: ENV.GROK_RELAY_URL }, { type: "bot_health", data: {} }, tick())).toBe(false);
    expect(await relayEvent({ ...ENV, GROK_RELAY_URL: "http://plain" }, { type: "bot_health", data: {} }, tick())).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  test("POSTs a Bearer-authed JSON body, priority false by default", async () => {
    const f = jest.fn().mockResolvedValue(res(200));
    global.fetch = f as never;
    expect(await relayEvent(ENV, { type: "holders_change", data: { holders: 900, delta: 3 } }, tick())).toBe(true);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(ENV.GROK_RELAY_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer k3y");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ source: "onlymonkes-actions", type: "holders_change", priority: false, data: { holders: 900, delta: 3 } });
  });

  test("retries once on 5xx / 429 / network error, not on other 4xx", async () => {
    let f = jest.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200));
    global.fetch = f as never;
    expect(await relayEvent(ENV, { type: "sentry_error", data: {} }, tick())).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);

    f = jest.fn().mockRejectedValue(new Error("boom"));
    global.fetch = f as never;
    expect(await relayEvent(ENV, { type: "sentry_error", data: {} }, tick())).toBe(false);
    expect(f).toHaveBeenCalledTimes(2);

    f = jest.fn().mockResolvedValue(res(400));
    global.fetch = f as never;
    expect(await relayEvent(ENV, { type: "sentry_error", data: {} }, tick())).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test("sends with a short abort timeout", async () => {
    const f = jest.fn().mockResolvedValue(res(200));
    global.fetch = f as never;
    await relayEvent(ENV, { type: "sales_daily", data: {} }, tick());
    expect(f.mock.calls[0][1].signal).toBeDefined();
  });

  test("rate limited per type per minute (local fallback)", async () => {
    const f = jest.fn().mockResolvedValue(res(200));
    global.fetch = f as never;
    const now = tick();
    const results = [];
    for (let i = 0; i < 12; i++) results.push(await relayEvent(ENV, { type: "bot_health", data: {} }, now));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(await relayEvent(ENV, { type: "sales_daily", data: {} }, now)).toBe(true);
  });

  test("uses the rate-limit binding when present", async () => {
    const f = jest.fn().mockResolvedValue(res(200));
    global.fetch = f as never;
    const limiter = { limit: jest.fn().mockResolvedValue({ success: false }) };
    expect(await relayEvent({ ...ENV, AGENT_RELAY_LIMITER: limiter }, { type: "bot_health", data: {} }, tick())).toBe(false);
    expect(limiter.limit).toHaveBeenCalledWith({ key: "agent:bot_health" });
    expect(f).not.toHaveBeenCalled();
  });

  test("never throws, even if the limiter throws", async () => {
    const limiter = { limit: jest.fn().mockRejectedValue(new Error("x")) };
    await expect(relayEvent({ ...ENV, AGENT_RELAY_LIMITER: limiter }, { type: "bot_health", data: {} }, tick())).resolves.toBe(false);
  });
});

describe("scrubPrivate (no DMs, no wallet-private data)", () => {
  test("drops private keys and redacts addresses / inbox IDs anywhere", () => {
    const out = scrubPrivate({
      title: "Error in 7tLrUKmkcBRVmwXtiRo8cTj6Mw2TGhFxyeNmKaU9mqZx flow",
      buyer: "x", walletAddress: "x", inboxId: "x", message: "dm text", content: "dm text",
      nested: [{ who: "90d75402d5aa7b01d2c74b2a1f5e3c6d8e9f0a1b2c3d4e5f60718293a4b5c6d7", n: 1 }],
      count: 3,
    }) as Record<string, unknown>;
    expect(out).toEqual({ title: "Error in [redacted] flow", nested: [{ who: "[redacted]", n: 1 }], count: 3 });
  });
});

describe("event builders", () => {
  test("sentry: allowlisted fields only, fatal is urgent", () => {
    const ev = sentryEvent({ action: "triggered", data: { issue: { title: "SIGSEGV", level: "fatal", shortId: "ONLYMONKES-V", count: "50", userCount: 4, user: { id: "u" }, tags: [["wallet", "x"]], project: { slug: "onlymonkes" } } } })!;
    expect(ev.priority).toBe(true);
    expect(ev.data).toMatchObject({ title: "SIGSEGV", level: "fatal", shortId: "ONLYMONKES-V", count: 50, userCount: 4, project: "onlymonkes" });
    expect(Object.keys(ev.data)).not.toEqual(expect.arrayContaining(["user", "tags"]));
    expect(sentryEvent({ action: "x" })).toBeNull();
    expect(sentryEvent({ data: { issue: { title: "w", level: "warning" } } })!.priority).toBe(false);
  });

  test("sales daily: counts the last 24h, no buyers/sellers", () => {
    const now = Date.UTC(2026, 9, 28);
    const ev = salesDailyEvent({ holders: 950, holdersDelta: 2, floorSol: 0.61, floorChg24h: -1.2, volume24hSol: 4.2, recentSales: [{ priceSol: 0.6, ts: now - 3_600_000 }, { priceSol: 0.7, ts: now - 7_200_000 }, { priceSol: 9, ts: now - 2 * 86_400_000 }] }, now);
    expect(ev).toEqual({ type: "sales_daily", data: { floorSol: 0.61, floorChg24hPct: -1.2, volume24hSol: 4.2, sales24h: 2, avgSaleSol: 0.65, holders: 950 } });
  });

  test("holders change only when the count moved", () => {
    const base = { holders: 950, floorSol: null, floorChg24h: null, volume24hSol: null, recentSales: [] };
    expect(holdersChangeEvent({ ...base, holdersDelta: 0 })).toBeNull();
    expect(holdersChangeEvent({ ...base, holdersDelta: null })).toBeNull();
    expect(holdersChangeEvent({ ...base, holdersDelta: -3 })).toEqual({ type: "holders_change", data: { holders: 950, delta: -3 } });
  });

  test("bot health: down is urgent, recovery is not", () => {
    expect(botHealthEvent(false, "HTTP 530", "2026-10-28T20:00:00Z").priority).toBe(true);
    expect(botHealthEvent(true, "401 as expected", "2026-10-28T20:00:00Z").priority).toBe(false);
  });
});

describe("probeBot", () => {
  test("401 means up; anything else or a throw means down", async () => {
    global.fetch = jest.fn().mockResolvedValue(res(401)) as never;
    expect((await probeBot("https://bot.example/")).up).toBe(true);
    global.fetch = jest.fn().mockResolvedValue(res(530)) as never;
    expect(await probeBot("https://bot.example")).toEqual({ up: false, detail: "HTTP 530" });
    global.fetch = jest.fn().mockRejectedValue(new Error("x")) as never;
    expect((await probeBot("https://bot.example")).up).toBe(false);
  });
  test("never sends a secret", async () => {
    const f = jest.fn().mockResolvedValue(res(401));
    global.fetch = f as never;
    await probeBot("https://bot.example");
    expect(f.mock.calls[0][1].headers).toBeUndefined();
  });
});

describe("bearerOk (BOT_HTTP_SECRET required)", () => {
  test("unset secret rejects everything, including 'Bearer undefined'", () => {
    expect(bearerOk("Bearer undefined", undefined)).toBe(false);
    expect(bearerOk("Bearer ", "")).toBe(false);
  });
  test("exact match only", () => {
    expect(bearerOk("Bearer s3cret", "s3cret")).toBe(true);
    expect(bearerOk("Bearer s3cre", "s3cret")).toBe(false);
    expect(bearerOk("Bearer s3cretX", "s3cret")).toBe(false);
    expect(bearerOk(null, "s3cret")).toBe(false);
  });
});
