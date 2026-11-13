/** @jest-environment node */
jest.mock("@cf-wasm/photon/workerd", () => ({ PhotonImage: {} }), { virtual: true });
import { fmtTenths, handleShareCard, isShareCardPath } from "../src/shareCard";

const cache = new Map<string, Response>();
(globalThis as any).caches = { default: { match: async (r: Request) => cache.get(r.url)?.clone(), put: async (r: Request, res: Response) => void cache.set(r.url, res) } };
const ctx = { waitUntil: (_p: Promise<unknown>) => {} };
const get = (path: string) => handleShareCard(path, new Request(`https://onlymonkes.app${path}`), ctx);

describe("MonkeCaves clear share card", () => {
  test("paths: digits and a grade letter only", () => {
    expect(isShareCardPath("/monke/2431/cave/2/A/1613")).toBe(true);
    expect(isShareCardPath("/monke/2431/cave/2/A/1613/card.png")).toBe(true);
    expect(isShareCardPath("/monke/2431/cave/2/Z/1613")).toBe(false);
    expect(isShareCardPath("/monke/2431/cave/2/A/<script>")).toBe(false);
    expect(isShareCardPath("/monke/2431/cave/10/A/1613")).toBe(false);
  });
  test("times", () => {
    expect(fmtTenths(1613)).toBe("2:41.3");
    expect(fmtTenths(605)).toBe("1:00.5");
  });
  test("page carries the title and the card for link previews", async () => {
    const res = await get("/monke/2431/cave/2/A/1613");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Monke #2431 cleared PAPER HANDS ALLEY in 2:41.3 · grade A");
    expect(html).toContain('content="https://onlymonkes.app/monke/2431/cave/2/A/1613/card.png"');
  });
  test("refuses impossible times and burned monkes", async () => {
    expect((await get("/monke/2431/cave/2/A/50")).status).toBe(404);
    expect((await get("/monke/411/cave/1/S/900")).status).toBe(404);
  });
  test("card is a 1200×630 PNG (placeholder art when Arweave is unreachable)", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("no", { status: 503 })) as any;
    try {
      const res = await get("/monke/2431/cave/1/S/900/card.png");
      expect(res.headers.get("Content-Type")).toBe("image/png");
      const b = new Uint8Array(await res.arrayBuffer());
      expect([...b.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
      const dv = new DataView(b.buffer, b.byteOffset);
      expect([dv.getUint32(16), dv.getUint32(20)]).toEqual([1200, 630]);
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    } finally { globalThis.fetch = realFetch; }
  });
});
