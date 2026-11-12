import { webcrypto } from "crypto";
import { createHash } from "crypto";

jest.mock("../src/index", () => ({}));
jest.mock("../src/webAuth", () => ({
  holderClaimsFromToken: jest.fn(async (_env: unknown, token: string) => (token === "good" ? { wallet: HOLDER, tier: "monke" } : token === "other" ? { wallet: OTHER, tier: "monke" } : null)),
}));
jest.mock("../src/livekitAuth", () => ({ walletFromDeviceProof: jest.fn(async () => ({ error: "bad proof", status: 401 })) }));
jest.mock("../src/referrals", () => ({ cleanName: (s: unknown) => String(s ?? "").replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 16) }));
jest.mock("../src/shareCard", () => ({ monkeImageForNumber: (n: number) => (Number.isInteger(n) && n >= 1 && n <= 9999 ? "x" : null) }));

import { __test, ghostOk, handleRacer, runProblem, RACER_VERSION, DAILY_BANANAS } from "../src/racer";
import { publicLimitName } from "../src/publicLimits";

if (!globalThis.crypto?.subtle) (globalThis as any).crypto = webcrypto;

const HOLDER = "7tLrUKmkcBRVmwXtiRo8cTj6Mw2TGhFxyeNmKaU9mqZx";
const OTHER = "BzyaYyd7ew7SRqC1P9Q6z61ebfYmdXRFU6UfKjHzcQ2o";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function kv() {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); } };
}
const T = Date.UTC(2026, 10, 11, 15);
const ghostFor = (ms: number) => Array.from({ length: Math.round((ms / 1000) * 40) }, (_, i) => [i * 0.5, -i * 0.25, 0.1]);
const run = (over: Record<string, unknown> = {}) => {
  const ms = (over.ms as number) ?? 90_000;
  return { proof: { kind: "holder", token: "good" }, v: RACER_VERSION, course: "2026-11-11", ms, laps: [ms / 3, ms / 3, ms - 2 * (ms / 3)], n: 8982, pay: true, ...over };
};
const on = () => ({ COMMUNITY_DATA: kv(), RACER_BOARD: "on" }) as any;
const body = async (r: Response) => r.json() as Promise<any>;

describe("runProblem", () => {
  test("refuses impossible or wrong-day races", () => {
    expect(runProblem(run(), T)).toBeNull();
    expect(runProblem(run({ v: 0 }), T)).toBe("old game version");
    expect(runProblem(run({ course: "demo" }), T)).toBe("only the daily track counts");
    expect(runProblem(run({ course: "2026-11-09" }), T)).toBe("not today's track");
    expect(runProblem(run({ course: "2026-11-10" }), Date.UTC(2026, 10, 11, 1))).toBeNull();
    expect(runProblem(run({ ms: 27_000 }), T)).toBe("faster than possible");
    expect(runProblem(run({ laps: [30_000, 30_000] }), T)).toBe("bad laps");
    expect(runProblem(run({ laps: [30_000, 30_000, 31_000] }), T)).toBe("laps don't add up");
  });
  test("ghost shape", () => {
    expect(ghostOk(ghostFor(90_000), 90_000)).toBe(true);
    expect(ghostOk(ghostFor(60_000), 90_000)).toBe(false);
    expect(ghostOk([[1, 2]], 25)).toBe(false);
    expect(ghostOk("x", 90_000)).toBe(false);
  });
});

describe("submit", () => {
  test("off: nobody; testers: only listed wallets", async () => {
    expect((await __test.submit({ COMMUNITY_DATA: kv() } as any, run(), T)).status).toBe(404);
    const env: any = { COMMUNITY_DATA: kv(), RACER_BOARD: "testers", RACER_TESTERS: sha(HOLDER) };
    expect((await __test.submit(env, run(), T)).status).toBe(200);
    expect((await __test.submit(env, run({ proof: { kind: "holder", token: "other" } }), T)).status).toBe(404);
  });
  test("no proof, bad proof", async () => {
    expect((await __test.submit(on(), run({ proof: undefined }), T)).status).toBe(401);
    expect((await __test.submit(on(), run({ proof: { kind: "holder", token: "bad" } }), T)).status).toBe(401);
  });
  test("bananas once per day when asked; best, rank, leader ghost", async () => {
    const env = on();
    let r = await body(await __test.submit(env, run({ pay: false, ghost: ghostFor(90_000) }), T));
    expect(r).toMatchObject({ paid: 0, rank: 1 });
    r = await body(await __test.submit(env, run({ ms: 80_000 }), T + 11_000));
    expect(r).toMatchObject({ paid: DAILY_BANANAS, best: 80_000, improved: true, rank: 1 });
    r = await body(await __test.submit(env, run({ ms: 95_000 }), T + 22_000));
    expect(r).toMatchObject({ paid: 0, best: 80_000, improved: false });
    expect((await __test.submit(env, run(), T + 25_000)).status).toBe(429);
    // a faster holder with a ghost takes #1 and the leader ghost
    r = await body(await __test.submit(env, run({ proof: { kind: "holder", token: "other" }, ms: 75_000, n: 1, ghost: ghostFor(75_000) }), T + 40_000));
    expect(r).toMatchObject({ rank: 1, paid: DAILY_BANANAS });
    expect(r.top.map((x: any) => x.t)).toEqual([75_000, 80_000]);
    expect(JSON.stringify(r)).not.toContain(HOLDER);
    const g = await handleRacer(new Request("https://x/api/racer/ghost?day=2026-11-11"), env, "/api/racer/ghost");
    const gj = await body(g);
    expect(gj).toMatchObject({ day: "2026-11-11", name: "Monke #1", t: 75_000 });
    expect(gj.ghost.length).toBe(3000);
    // board and ghost are kept per game version (each version has its own track); bananas are not
    expect([...env.COMMUNITY_DATA.m.keys()].filter((k: string) => k.startsWith("racer:top:"))).toEqual([`racer:top:v${RACER_VERSION}:2026-11-11`]);
    expect(env.COMMUNITY_DATA.m.has(`racer:ghost:v${RACER_VERSION}:2026-11-11`)).toBe(true);
    expect([...env.COMMUNITY_DATA.m.keys()].some((k: string) => /^racer:paid:2026-11-11:/.test(k))).toBe(true);
    expect(gj.id).toBeUndefined();
  });
  test("board hidden until on; ghost hidden when off", async () => {
    const req = new Request("https://x/api/racer/board?day=2026-11-11");
    expect((await handleRacer(req, { COMMUNITY_DATA: kv(), RACER_BOARD: "testers" } as any, "/api/racer/board")).status).toBe(404);
    expect((await handleRacer(req, on(), "/api/racer/board")).status).toBe(200);
    expect((await handleRacer(new Request("https://x/api/racer/ghost"), { COMMUNITY_DATA: kv() } as any, "/api/racer/ghost")).status).toBe(404);
  });
  test("ghost route is rate limited", () => expect(publicLimitName("/api/racer/ghost")).toBe("racerghost"));
});
