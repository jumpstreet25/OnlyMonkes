import { webcrypto } from "crypto";

const HOLDER = "So11111111111111111111111111111111111111112";
jest.mock("../src/webAuth", () => ({
  holderWalletFromRequest: jest.fn(async (req: Request) => (req.headers.get("Authorization") === "Bearer web" ? HOLDER : null)),
  holderClaimsFromToken: jest.fn(async (_env: unknown, token: string) => (token === "good" ? { wallet: HOLDER, tier: "monke" } : null)),
}));
jest.mock("../src/livekitAuth", () => ({
  walletFromDeviceProof: jest.fn(async (_env: unknown, proof: any, msg: (n: string) => string) =>
    proof.sig === "ok" && msg("n1") === "OnlyMonkes Upload\nnonce:n1" ? { wallet: HOLDER, tier: "sagaMonke" } : { error: "bad", status: 401 }),
}));

import { handleWebMedia, mediaKind, refreshMediaUsage, MEDIA_MAX_BYTES } from "../src/webMedia";
import { jupBuildParams } from "../src/jupProxy";

if (!(globalThis as any).crypto?.getRandomValues) (globalThis as any).crypto = webcrypto;

function kv() {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) };
}
function bucket(sizes: number[] = []) {
  const puts: { key: string; opts: any }[] = [];
  return { puts, put: async (key: string, _v: unknown, opts: any) => void puts.push({ key, opts }), list: async () => ({ objects: sizes.map((size) => ({ size })), truncated: false }) };
}
const env = (over: any = {}) => ({ DEVICE_INTEGRITY: kv(), FRAME_ALERTS: kv(), MEDIA: bucket(), GIPHY_API_KEY: "k", WEB_APP_ORIGINS: "https://onlymonkes.app", XMTP_JWT_PRIVATE_KEY: "x", ...over });

function upload(headers: Record<string, string>, file: File) {
  const form = new FormData();
  form.append("file", file);
  return new Request("https://onlymonkes.app/api/upload", { method: "POST", headers, body: form });
}
const proof = (p: object) => Buffer.from(JSON.stringify(p)).toString("base64");

describe("uploads to our R2", () => {
  it("phone hardware-key proof stores a video on media.onlymonkes.app", async () => {
    const e = env();
    const res = await handleWebMedia("/api/upload", upload({ "X-OM-Proof": proof({ kind: "device", wallet: HOLDER, devicePubKey: "k", nonce: "n1", sig: "ok" }) }, new File([new Uint8Array(100)], "v.mp4", { type: "video/mp4" })), e as any);
    expect(res.status).toBe(200);
    const { url } = await res.json();
    expect(url).toMatch(/^https:\/\/media\.onlymonkes\.app\/u\/\d{4}-\d{2}\/[0-9a-f]{32}\.mp4$/);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(e.MEDIA.puts[0].opts.httpMetadata.contentType).toBe("video/mp4");
    expect(url).not.toContain(HOLDER);
  });

  it("phone holder token works, a bad proof doesn't", async () => {
    const ok = await handleWebMedia("/api/upload", upload({ "X-OM-Proof": proof({ kind: "holder", token: "good" }) }, new File(["x"], "a.png", { type: "image/png" })), env() as any);
    expect(ok.status).toBe(200);
    const bad = await handleWebMedia("/api/upload", upload({ "X-OM-Proof": proof({ kind: "device", wallet: HOLDER, nonce: "n1", sig: "no" }) }, new File(["x"], "a.png", { type: "image/png" })), env() as any);
    expect(bad.status).toBe(401);
  });

  it("web needs an allowed origin; other sites are refused", async () => {
    const ok = await handleWebMedia("/api/upload", upload({ Authorization: "Bearer web", Origin: "https://onlymonkes.app" }, new File(["x"], "a.jpg", { type: "image/jpeg" })), env() as any);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("https://onlymonkes.app");
    const evil = await handleWebMedia("/api/upload", upload({ Authorization: "Bearer web", Origin: "https://evil.example" }, new File(["x"], "a.jpg", { type: "image/jpeg" })), env() as any);
    expect(evil.status).toBe(403);
  });

  it("unknown types download, never render (no HTML on our domain)", () => {
    const k = mediaKind("text/html", "../../x <script>.html");
    expect(k.contentType).toBe("application/octet-stream");
    expect(k.disposition).toBe('attachment; filename="x__script_.html"');
    expect(mediaKind("image/svg+xml", "a.svg").contentType).toBe("application/octet-stream");
    expect(mediaKind("IMAGE/JPEG; charset=x", "a").contentType).toBe("image/jpeg");
  });

  it("refuses oversize images and pauses when the bucket is full", async () => {
    const big = await handleWebMedia("/api/upload", upload({ "X-OM-Proof": proof({ kind: "holder", token: "good" }) }, new File([new Uint8Array(11 * 1024 * 1024)], "a.jpg", { type: "image/jpeg" })), env() as any);
    expect(big.status).toBe(413);
    const e = env({ MEDIA: bucket([MEDIA_MAX_BYTES]) });
    await refreshMediaUsage(e as any);
    const full = await handleWebMedia("/api/upload", upload({ "X-OM-Proof": proof({ kind: "holder", token: "good" }) }, new File(["x"], "a.jpg", { type: "image/jpeg" })), e as any);
    expect(full.status).toBe(503);
  });

  it("daily cap per wallet", async () => {
    const e = env();
    e.DEVICE_INTEGRITY.m.set(`upl:${HOLDER}:${new Date().toISOString().slice(0, 10)}`, "60");
    const res = await handleWebMedia("/api/upload", upload({ "X-OM-Proof": proof({ kind: "holder", token: "good" }) }, new File(["x"], "a.jpg", { type: "image/jpeg" })), e as any);
    expect(res.status).toBe(429);
  });
});

describe("GIF search from the phone", () => {
  it("phone (no Origin) is served; a foreign browser origin isn't", async () => {
    (globalThis as any).caches = { default: { match: async () => undefined, put: async () => {} } };
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const phone = await handleWebMedia("/api/giphy/gifs/search", new Request("https://onlymonkes.app/api/giphy/gifs/search?q=monke"), env() as any);
    expect(phone.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain("api_key=k");
    const evil = await handleWebMedia("/api/giphy/gifs/search", new Request("https://onlymonkes.app/api/giphy/gifs/search?q=monke", { headers: { Origin: "https://evil.example" } }), env() as any);
    expect(evil.status).toBe(403);
    fetchMock.mockRestore();
  });
});

describe("Jupiter build proxy", () => {
  const good = { inputMint: HOLDER, outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", taker: HOLDER, amount: "1000000", slippageBps: "50", wrapAndUnwrapSol: "true", prioritizationFeeLamports: "auto" };
  it("passes only Jupiter's build params", () => {
    const out = jupBuildParams(new URLSearchParams({ ...good, api_key: "steal", evil: "1" }));
    expect(typeof out).not.toBe("string");
    expect(Object.fromEntries(out as URLSearchParams)).toEqual(good);
  });
  it("refuses bad mints, amounts and slippage", () => {
    expect(jupBuildParams(new URLSearchParams({ ...good, inputMint: "x" }))).toBe("bad inputMint");
    expect(jupBuildParams(new URLSearchParams({ ...good, amount: "-1" }))).toBe("bad amount");
    expect(jupBuildParams(new URLSearchParams({ ...good, slippageBps: "9999" }))).toBe("bad slippageBps");
  });
});

describe("Jupiter proxy routes", () => {
  const { handleJupProxy, isJupProxyPath, jupExecuteBody } = require("../src/jupProxy");
  it("only the four Jupiter paths", () => {
    expect(["build", "quote", "order", "execute"].every((k) => isJupProxyPath(`/api/jup/${k}`))).toBe(true);
    expect(isJupProxyPath("/api/jup/tokens")).toBe(false);
  });
  it("execute passes only signedTransaction + requestId", () => {
    expect(JSON.parse(jupExecuteBody({ signedTransaction: "AQID", requestId: "r-1", extra: 1 }))).toEqual({ signedTransaction: "AQID", requestId: "r-1" });
    expect(jupExecuteBody({ signedTransaction: "<x>", requestId: "r" })).toBe("");
  });
  it("adds our key upstream and never echoes it", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"outAmount":"1"}', { status: 200 }));
    const res = await handleJupProxy(new Request(`https://onlymonkes.app/api/jup/quote?inputMint=${HOLDER}&outputMint=${HOLDER}&amount=1000`), { JUP_API_KEY: "secret" }, {}, "/api/jup/quote");
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe(`https://api.jup.ag/swap/v2/quote?inputMint=${HOLDER}&outputMint=${HOLDER}&amount=1000&slippageBps=50`);
    expect(init.headers["x-api-key"]).toBe("secret");
    expect(await res.text()).not.toContain("secret");
    fetchMock.mockRestore();
  });
  it("rate limited per IP", async () => {
    const res = await handleJupProxy(new Request("https://onlymonkes.app/api/jup/quote"), { WEB_RPC_LIMITER: { limit: async () => ({ success: false }) } }, {}, "/api/jup/quote");
    expect(res.status).toBe(429);
  });
});
