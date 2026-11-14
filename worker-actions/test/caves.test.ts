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
    expect(runProblem(run({ cave: 6 }))).toBe("unknown cave");
    expect(runProblem(run({ timeMs: 2_000 }))).toBe("faster than possible");
    expect(runProblem(run({ timeMs: 39_000 }))).toBe("faster than possible");
    expect(runProblem(run({ timeMs: NaN }))).toBe("bad time");
    expect(runProblem(run({ kills: -1 }))).toBe("bad kills");
    expect(runProblem(run({ kills: 121 }))).toBe("bad kills");
  });
  test("v3 rebuilt cave 2: new floor, old v2 runs only for cave 1", () => {
    expect(runProblem(run({ cave: 2, timeMs: 61_000 }))).toBe("faster than possible");
    expect(runProblem(run({ cave: 2, timeMs: 90_000, kills: 66 }))).toBeNull();
    expect(runProblem(run({ v: 2, cave: 2, timeMs: 90_000 }))).toBe("old game version");
    expect(runProblem(run({ v: 2, cave: 1 }))).toBeNull();
    expect(runProblem(run({ v: 2, cave: 3, timeMs: 30_000 }))).toBe("old game version");
  });
  test("v4 adds Data Center as cave 3; v3 runs only for caves 1 and 2", () => {
    expect(runProblem(run({ cave: 3, timeMs: 47_000 }))).toBe("faster than possible");
    expect(runProblem(run({ cave: 3, timeMs: 200_000, kills: 90 }))).toBeNull();
    expect(runProblem(run({ v: 3, cave: 1 }))).toBeNull();
    expect(runProblem(run({ v: 3, cave: 2, timeMs: 90_000 }))).toBeNull();
    expect(runProblem(run({ v: 3, cave: 3, timeMs: 30_000 }))).toBe("old game version");
    expect(runProblem(run({ v: 3, cave: 4, timeMs: 30_000 }))).toBe("old game version");
  });
  test("v5 adds Walled Garden as cave 4; Big Tech HQ is cave 5; v4 runs only for caves 1–3", () => {
    expect(runProblem(run({ cave: 4, timeMs: 91_000 }))).toBe("faster than possible");
    expect(runProblem(run({ cave: 4, timeMs: 300_000, kills: 77 }))).toBeNull();
    expect(runProblem(run({ cave: 5, timeMs: 30_000 }))).toBeNull();
    expect(runProblem(run({ v: 4, cave: 3, timeMs: 200_000 }))).toBeNull();
    expect(runProblem(run({ v: 4, cave: 4, timeMs: 300_000 }))).toBe("old game version");
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
  test("rebuilt cave 2 starts a fresh board: old-map times don't show", async () => {
    const env: any = { COMMUNITY_DATA: kv(), CAVES_BOARD: "on" };
    const week = isoWeek(T);
    env.COMMUNITY_DATA.m.set(`caves:top:${week}:c2`, JSON.stringify([{ id: "old", t: 14_000, n: 1, name: "old map", at: T }]));
    expect(await (await __test.submit(env, run({ cave: 2, timeMs: 95_000 }), T)).json()).toMatchObject({ improved: true, rank: 1 });
    expect((await board(env, week))[2]).toEqual([{ name: "Jump.skr", n: 8982, t: 95_000 }]);
  });
});

describe("campaign: progress + bananas", () => {
  const proof = { kind: "holder", token: "good" };
  test("a clear saves progress, pays once per cave per day, 100 a day, and the phone collects once", async () => {
    const env: any = { COMMUNITY_DATA: kv(), CAVES_BOARD: "on" };
    expect(await (await __test.progress(env, { proof }, T)).json()).toEqual({ max: 0, today: 0, cap: 100 });
    // A cave 3 clear (only reachable through 1 and 2 before progress was saved) unlocks up to 3.
    expect(await (await __test.submit(env, run({ cave: 3, timeMs: 200_000 }), T)).json()).toMatchObject({ max: 3, bananas: 45, today: 45 });
    expect(await (await __test.submit(env, run({ cave: 3, timeMs: 190_000 }), T + 20_000)).json()).toMatchObject({ max: 3, bananas: 0, today: 45 });
    expect(await (await __test.submit(env, run({ cave: 1 }), T + 40_000)).json()).toMatchObject({ max: 3, bananas: 25, today: 70 });
    expect(await (await __test.submit(env, run({ cave: 2, timeMs: 90_000 }), T + 60_000)).json()).toMatchObject({ bananas: 30, today: 100 });
    expect(await (await __test.progress(env, { proof }, T + 61_000)).json()).toEqual({ max: 3, today: 100, cap: 100 });
    expect(await (await __test.collect(env, { proof }, T + 70_000)).json()).toEqual({ bananas: 100 });
    expect(await (await __test.collect(env, { proof }, T + 90_000)).json()).toEqual({ bananas: 0 });
    // Next UTC day pays again.
    const next = T + 86_400_000;
    expect(await (await __test.submit(env, run({ cave: 1 }), next)).json()).toMatchObject({ bananas: 25, today: 25 });
    expect(await (await __test.collect(env, { proof }, next + 20_000)).json()).toEqual({ bananas: 25 });
  });
  test("progress and collect need a proof", async () => {
    const env: any = { COMMUNITY_DATA: kv() };
    expect((await __test.progress(env, {}, T)).status).toBe(401);
    expect((await __test.collect(env, { proof: { kind: "holder", token: "bad" } }, T)).status).toBe(401);
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
