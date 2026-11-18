jest.mock("../src/webAuth", () => ({ holderFromToken: jest.fn(async (_e: unknown, t: string) => (t === "good" ? { wallet: "walletA", tier: "monke" } : null)) }));
jest.mock("../src/livekitAuth", () => ({ walletFromDeviceProof: jest.fn() }));
import { RoyaleHall } from "../src/royale/royale";
import { ROYALE_VERSION } from "../src/royale/match.js";

class FakeWs {
  sent: any[] = []; closed: number | null = null; private att: unknown = null;
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close(c?: number) { this.closed = c ?? 1000; }
  serializeAttachment(a: unknown) { this.att = structuredClone(a); }
  deserializeAttachment() { return this.att; }
}
const env: any = { MONKELEDGER: { fetch: async () => new Response("", { status: 503 }) } };
const ctx = (sockets: FakeWs[]) => ({ getWebSockets: () => sockets, storage: { get: async () => undefined, put: async () => {} } });

describe("Jungle Royale hall hibernation", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("a holder on the end card survives a hibernation and can rematch", async () => {
    const ws = new FakeWs();
    ws.serializeAttachment({ state: "hello" });
    const h1: any = new RoyaleHall(ctx([ws]) as any, env);
    expect(ws.closed).toBe(4002); // a socket still in hello at wake-up can't be trusted
    const ws2 = new FakeWs();
    ws2.serializeAttachment({ state: "hello" });
    await h1.webSocketMessage(ws2, JSON.stringify({ t: "hello", v: ROYALE_VERSION, n: 8982, proof: { kind: "holder", token: "good" } }));
    expect(ws2.sent[0]).toEqual({ t: "welcome", n: 8982 });
    expect(ws2.deserializeAttachment()).toEqual({ state: "in", wallet: "walletA", n: 8982 });
    h1.gone = () => {}; // the old instance is discarded, not closed

    // Woken: a new instance rebuilt from the sockets Cloudflare kept open.
    const h2: any = new RoyaleHall(ctx([ws2]) as any, env);
    expect(h2.hall.playerCount).toBe(1);
    ws2.sent.length = 0;
    await h2.webSocketMessage(ws2, JSON.stringify({ t: "again" }));
    expect(ws2.sent[0]).toMatchObject({ t: "wait", holders: 1 });
    expect(JSON.stringify(ws2.sent)).not.toContain("walletA");
    clearInterval(h2.timer);
  });

  it("refuses a bad proof and old versions", async () => {
    const h: any = new RoyaleHall(ctx([]) as any, env);
    const a = new FakeWs(); a.serializeAttachment({ state: "hello" });
    await h.webSocketMessage(a, JSON.stringify({ t: "hello", v: ROYALE_VERSION, n: 1, proof: { kind: "holder", token: "bad" } }));
    expect(a.closed).toBe(4005);
    const b = new FakeWs(); b.serializeAttachment({ state: "hello" });
    await h.webSocketMessage(b, JSON.stringify({ t: "hello", v: 0, n: 1 }));
    expect(b.closed).toBe(4004);
  });
});
