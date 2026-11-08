jest.mock("../src/webAuth", () => ({ holderFromToken: jest.fn() }));
jest.mock("../src/livekitAuth", () => ({ walletFromDeviceProof: jest.fn() }));
import { RoyaleHall } from "../src/royale/royale";

function fakeCtx() {
  const m = new Map<string, unknown>();
  return { m, storage: { get: async (k: string) => m.get(k), put: async (k: string, v: unknown) => { m.set(k, structuredClone(v)); } } };
}
const sock = () => { const msgs: any[] = []; return { msgs, send: (d: string) => msgs.push(JSON.parse(d)), close() {} }; };
const collect = async (h: any, key: string) => (await (await h.collect(new Request("https://royale/collect", { method: "POST", body: JSON.stringify({ key }) }))).json()).bananas;

describe("Jungle Royale banana ledger", () => {
  afterEach(() => jest.useRealTimers());

  it("caps at 100 a UTC day, resets the next day, collects once", async () => {
    jest.useFakeTimers({ now: Date.UTC(2026, 10, 8, 23, 0), doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    const ctx = fakeCtx(), h: any = new RoyaleHall(ctx as any, {} as any), s = sock();
    for (const n of [40, 40, 40]) await h.credit(s, "walletA", n);
    expect(s.msgs.map((m) => m.bananas)).toEqual([40, 40, 20]);
    expect(s.msgs[2]).toMatchObject({ capped: true, today: 100, max: 100 });
    await h.credit(s, "walletA", 10);
    expect(s.msgs[3]).toMatchObject({ bananas: 0, capped: true });
    await h.credit(s, "walletB", 30); // another wallet has its own cap

    const [keyA, keyB] = [...ctx.m.keys()];
    expect(keyA).toMatch(/^b:[0-9a-f]{40}$/);
    expect(JSON.stringify([...ctx.m.entries()])).not.toContain("wallet");
    expect(await collect(h, keyA)).toBe(100);
    expect(await collect(h, keyA)).toBe(0);
    expect(await collect(h, keyB)).toBe(30);

    jest.setSystemTime(Date.UTC(2026, 10, 9, 0, 5));
    await h.credit(s, "walletA", 25);
    expect(s.msgs.at(-1)).toMatchObject({ bananas: 25, capped: false, today: 25 });
    expect(await collect(h, keyA)).toBe(25);
  });
});
