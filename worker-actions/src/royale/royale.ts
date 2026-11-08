/**
 * Jungle Royale match server (MonkeCaves versus, holders only).
 *
 *   GET /api/royale/play   (WebSocket upgrade, from our own origins)
 *
 * One Durable Object ("hall") runs the lobby and every match (hall.ts; the
 * match rules are match.js, a copy of the page's caves-royale.js). The first
 * message must be { t: "hello", v, n, proof } within 10 s:
 *  - proof { kind: "holder", token }: the web app's holder sign-in token (tier monke)
 *  - proof { kind: "device", wallet, devicePubKey, nonce, sig }: the phone app's
 *    Device Integrity key signing royaleProofMessage(nonce) (tier sagaMonke)
 * Saga Monke holders only (a Genesis Token alone doesn't seat you). The monke
 * you play as must be one the wallet holds (MonkeLedger), else its first one.
 * Wallets never leave this file: players show as their monke number.
 */
import type { Env } from "../index";
import { holderFromToken } from "../webAuth";
import { walletFromDeviceProof } from "../livekitAuth";
import { Hall, type Sock } from "./hall";
import { ROYALE_VERSION } from "./match.js";

export const royaleProofMessage = (nonce: string) => `OnlyMonkes Jungle Royale\nnonce:${nonce}`;

const TICK_MS = 50;
const HELLO_MS = 10_000;
const MAX_MSG_BYTES = 2048;
const MAX_MSGS_PER_S = 40;

function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  const list = (env.WEB_APP_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  return !!origin && list.includes(origin);
}

export async function handleRoyale(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
  if (!originAllowed(request, env)) return new Response("Forbidden", { status: 403 });
  if (env.WEB_RPC_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.WEB_RPC_LIMITER.limit({ key: `royale:${ip}` });
    if (!success) return new Response("Too many requests", { status: 429 });
  }
  const stub = env.ROYALE.get(env.ROYALE.idFromName("hall"));
  return stub.fetch(new Request("https://royale/play", { headers: { Upgrade: "websocket" } }));
}

/** Holder wallet + tier from a hello proof, or why not. */
async function holderFromProof(env: Env, proof: any): Promise<{ wallet: string } | { error: string }> {
  if (proof?.kind === "holder") {
    const h = await holderFromToken(env as any, typeof proof.token === "string" ? proof.token : "");
    if (!h) return { error: "sign in again" };
    if (h.tier !== "monke") return { error: "Jungle Royale is for Saga Monke holders" };
    return { wallet: h.wallet };
  }
  if (proof?.kind === "device") {
    const r = await walletFromDeviceProof(env, proof, royaleProofMessage);
    if ("error" in r) return { error: r.error };
    if (r.tier !== "sagaMonke") return { error: "Jungle Royale is for Saga Monke holders" };
    return { wallet: r.wallet };
  }
  return { error: "holders only" };
}

/** The monke number to play as: the asked one if this wallet holds it, else its first. */
async function monkeFor(env: Env, wallet: string, asked: number): Promise<number | null> {
  try {
    const res = await env.MONKELEDGER.fetch(`https://monkeledger.internal/wallet/${wallet}`);
    if (!res.ok) return Number.isInteger(asked) ? asked : null;
    const { assets } = (await res.json()) as { assets?: string[] };
    let first: number | null = null;
    for (const mint of (assets ?? []).slice(0, 8)) {
      const meta = await env.MONKELEDGER.fetch(`https://monkeledger.internal/metadata/${mint}`);
      if (!meta.ok) continue;
      const n = parseInt(/#(\d+)/.exec(((await meta.json()) as { name?: string }).name ?? "")?.[1] ?? "", 10);
      if (!Number.isInteger(n)) continue;
      if (n === asked) return n;
      first ??= n;
    }
    return first;
  } catch {
    // Ledger down: the holder check already passed and the look is cosmetic.
    return Number.isInteger(asked) ? asked : null;
  }
}

export class RoyaleHall {
  private hall = new Hall();
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = Date.now();

  constructor(private ctx: DurableObjectState, private env: Env) {}

  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    const sock: Sock = { send: (d) => server.send(d), close: (c, r) => { try { server.close(c, r); } catch { /* already */ } } };
    let state: "hello" | "checking" | "in" = "hello";
    let count = 0, windowStart = Date.now();
    const helloTimer = setTimeout(() => { if (state !== "in") sock.close(4002, "no hello"); }, HELLO_MS);

    server.addEventListener("message", async (e) => {
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; count = 0; }
      if (++count > MAX_MSGS_PER_S || typeof e.data !== "string" || e.data.length > MAX_MSG_BYTES) { sock.close(4003, "too much"); return; }
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (state === "hello") {
        if (msg?.t !== "hello") return;
        if (msg.v !== ROYALE_VERSION) { sock.send(JSON.stringify({ t: "err", msg: "Reload the game for the new version", reload: true })); sock.close(4004, "version"); return; }
        state = "checking";
        const who = await holderFromProof(this.env, msg.proof);
        if ("error" in who) { sock.send(JSON.stringify({ t: "err", msg: who.error })); sock.close(4005, "not a holder"); return; }
        const n = await monkeFor(this.env, who.wallet, parseInt(msg.n, 10));
        if (n == null) { sock.send(JSON.stringify({ t: "err", msg: "No Saga Monke found in this wallet" })); sock.close(4005, "no monke"); return; }
        clearTimeout(helloTimer);
        state = "in";
        sock.send(JSON.stringify({ t: "welcome", n }));
        this.hall.join(sock, who.wallet, n);
        this.run();
        return;
      }
      if (state !== "in") return;
      if (msg?.t === "in") this.hall.input(sock, msg);
      else if (msg?.t === "again") { this.hall.again(sock); this.run(); }
    });
    const gone = () => { clearTimeout(helloTimer); this.hall.leave(sock); };
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client });
  }

  // The game loop runs only while someone is waiting or playing.
  private run(): void {
    if (this.timer) return;
    this.last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      // A late timer catches up in ≤50 ms steps (a shot never skips past a monke).
      let dt = Math.min(0.15, (now - this.last) / 1000);
      this.last = now;
      while (dt > 0.001) { const step = Math.min(0.05, dt); this.hall.tick(step); dt -= step; }
      if (!this.hall.busy) { clearInterval(this.timer!); this.timer = null; }
    }, TICK_MS);
  }
}
