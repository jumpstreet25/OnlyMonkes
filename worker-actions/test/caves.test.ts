import { webcrypto } from "crypto";
import { createHash } from "crypto";

jest.mock("../src/index", () => ({}));
jest.mock("../src/webAuth", () => ({
  holderClaimsFromToken: jest.fn(async (_env: unknown, token: string) => (token === "good" ? { wallet: HOLDER, tier: "monke" } : token === "other" ? { wallet: OTHER, tier: "monke" } : null)),
}));
jest.mock("../src/livekitAuth", () => ({ walletFromDeviceProof: jest.fn(async () => ({ error: "bad proof", status: 401 })) }));
jest.mock("../src/referrals", () => ({ cleanName: (s: unknown) => String(s ?? "").replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 16) }));
jest.mock("../src/shareCard", () => ({ monkeImageForNumber: (n: number) => (Number.isInteger(n) && n >= 1 && n <= 9999 ? "x" : null) }));

import { __test, board, handleCaves, isoWeek, runProblem, CAVES_VERSION } from "../src/caves";

if (!globalThis.crypto?.subtle) (globalThis as any).crypto = webcrypto;

const HOLDER = "7tLrUKmkcBRVmwXtiRo8cTj6Mw2TGhFxyeNmKaU9mqZx";
const OTHER = "BzyaYyd7ew7SRqC1P9Q6z61ebfYmdXRFU6UfKjHzcQ2o";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function kv() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => { m.set(k, v); },
    list: async ({ prefix }: { prefix: string }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}
const run = (over: Record<string, unknown> = {}) => ({ proof: { kind: "holder", token: "good" }, v: CAVES_VERSION, cave: 1, timeMs: 60_000, n: 8982, name: "Jump.skr", ...over });
const T = Date.UTC(2026, 10, 7, 15);

describe("runProblem", () => {
  test("refuses impossible runs", () => {
    expect(runProblem(run())).toBeNull();
    expect(runProblem(run({ v: 0 }))).toBe("old game version");
    expect(runProblem(run({ cave: 4 }))).toBe("unknown cave");
    expect(runProblem(run({ timeMs: 2_000 }))).toBe("faster than possible");
    expect(runProblem(run({ timeMs: 39_000 }))).toBe("faster than possible");
    expect(runProblem(run({ timeMs: NaN }))).toBe("bad time");
    expect(runProblem(run({ kills: -1 }))).toBe("bad kills");
  });
});

describe("isoWeek", () => {
  test("ISO weeks", () => {
    expect(isoWeek(Date.UTC(2026, 10, 7))).toBe("2026-W45");
    expect(isoWeek(Date.UTC(2027, 0, 1))).toBe("2026-W53");
    expect(isoWeek(Date.UTC(2026, 0, 1))).toBe("2026-W01");
  });
});

describe("submit", () => {
  test("off: nobody can post", async () => {
    const env: any = { COMMUNITY_DATA: kv() };
    expect((await __test.submit(env, run(), T)).status).toBe(404);
  });
  test("testers: only listed wallets", async () => {
    const env: any = { COMMUNITY_DATA: kv(), CAVES_BOARD: "testers", CAVES_TESTERS: sha(HOLDER) };
    expect((await __test.submit(env, run(), T)).status).toBe(200);
    expect((await __test.submit(env, run({ proof: { kind: "holder", token: "other" } }), T)).status).toBe(404);
  });
  test("needs a proof", async () => {
    const env: any = { COMMUNITY_DATA: kv(), CAVES_BOARD: "on" };
    expect((await __test.submit(env, run({ proof: null }), T)).status).toBe(401);
    expect((await __test.submit(env, run({ proof: { kind: "holder", token: "bad" } }), T)).status).toBe(401);
  });
  test("keeps the best time, rate-limits, ranks the board", async () => {
    const env: any = { COMMUNITY_DATA: kv(), CAVES_BOARD: "on" };
    expect(await (await __test.submit(env, run(), T)).json()).toMatchObject({ improved: true, best: 60_000, rank: 1 });
    expect((await __test.submit(env, run({ timeMs: 50_000 }), T + 1_000)).status).toBe(429);
    expect(await (await __test.submit(env, run({ timeMs: 70_000 }), T + 20_000)).json()).toMatchObject({ improved: false, best: 60_000 });
    expect(await (await __test.submit(env, run({ timeMs: 50_000 }), T + 40_000)).json()).toMatchObject({ improved: true, best: 50_000, rank: 1 });
    const other = await (await __test.submit(env, run({ proof: { kind: "holder", token: "other" }, timeMs: 55_000, n: 99999, name: "<b>x</b>" }), T)).json();
    expect(other).toMatchObject({ rank: 2, top: [{ name: "Jump.skr", n: 8982, t: 50_000 }, { name: "bxb", n: null, t: 55_000 }] });
    const b = await board(env, isoWeek(T));
    expect(b[1]).toEqual([{ name: "Jump.skr", n: 8982, t: 50_000 }, { name: "bxb", n: null, t: 55_000 }]);
    expect(b[2]).toEqual([]);
    expect([...env.COMMUNITY_DATA.m.keys()].join()).not.toContain(HOLDER);
    expect(JSON.stringify(other)).not.toContain('"id"');
  });
});

describe("GET /api/caves/board", () => {
  const get = (env: any) => handleCaves(new Request("https://x/api/caves/board"), env, "/api/caves/board");
  test("hidden while off or testers-only, public when on", async () => {
    expect((await get({ COMMUNITY_DATA: kv() })).status).toBe(404);
    expect((await get({ COMMUNITY_DATA: kv(), CAVES_BOARD: "testers" })).status).toBe(404);
    const env: any = { COMMUNITY_DATA: kv(), CAVES_BOARD: "on" };
    await __test.submit(env, run(), Date.now());
    const res = await get(env);
    expect(res.status).toBe(200);
    expect((await res.json()).caves[1]).toEqual([{ name: "Jump.skr", n: 8982, t: 60_000 }]);
  });
});
