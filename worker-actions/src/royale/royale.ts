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
 *
 * Bananas (BANANAS in match.js): the hall credits what each holder earned when a
 * match ends, at most BANANAS.DAILY_MAX per UTC day, into this object's storage
 * under a hash of the wallet, and tells the player { t: "paid", bananas, capped }.
 * The phone app collects them (bananas live on the phone; the web only mirrors):
 *   POST /api/royale/collect { proof } → { bananas }   (everything owed, once)
 */
import type { Env } from "../index";
import { holderFromToken } from "../webAuth";
import { walletFromDeviceProof } from "../livekitAuth";
import { Hall, type Sock } from "./hall";
import { BANANAS, ROYALE_VERSION } from "./match.js";
import { sha256Hex } from "../cryptoVerify";

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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const enc = new TextEncoder();
const bananaKey = async (wallet: string) => `b:${(await sha256Hex(enc.encode(`om-royale:${wallet}`))).slice(0, 40)}`;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
type Ledger = { owed: number; day: string; today: number };
/** Per-socket state that survives hibernation (serializeAttachment). */
type Att = { state: "hello" | "checking" | "in"; wallet?: string; n?: number };

/** POST /api/royale/collect: the phone collects the bananas its holder earned. */
export async function handleRoyaleCollect(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  if (env.WEB_RPC_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!(await env.WEB_RPC_LIMITER.limit({ key: `royale-collect:${ip}` })).success) return json({ error: "Too many requests" }, 429);
  }
  let body: any = null;
  try { body = await request.json(); } catch { /* below */ }
  const who = await holderFromProof(env, body?.proof);
  if ("error" in who) return json({ error: who.error }, 401);
  const stub = env.ROYALE.get(env.ROYALE.idFromName("hall"));
  return stub.fetch(new Request("https://royale/collect", { method: "POST", body: JSON.stringify({ key: await bananaKey(who.wallet) }) }));
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
  private hall = new Hall(undefined, (sock, wallet, bananas) => { void this.credit(sock, wallet, bananas); });
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = Date.now();

  private socks = new Map<WebSocket, Sock>();
  private rate = new Map<WebSocket, { count: number; start: number }>();
  private helloTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>();

  constructor(private ctx: DurableObjectState, private env: Env) {
    // Woken from hibernation: players whose sockets stayed open (on the end card) come back,
    // out of any match. A socket that never finished its hello can't be here (see fetch).
    for (const ws of ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Att | null;
      if (a?.state === "in" && a.wallet && a.n) this.hall.adopt(this.sockFor(ws), a.wallet, a.n);
      else this.sockFor(ws).close(4002, "no hello");
    }
  }

  // Storage reads and writes hold this object's input gate, so a credit and a
  // collect for the same wallet never interleave.
  private async credit(sock: Sock, wallet: string, earned: number): Promise<void> {
    try {
      const key = await bananaKey(wallet), day = utcDay(Date.now());
      const l = ((await this.ctx.storage.get<Ledger>(key)) ?? { owed: 0, day, today: 0 });
      if (l.day !== day) { l.day = day; l.today = 0; }
      const bananas = Math.max(0, Math.min(earned, BANANAS.DAILY_MAX - l.today));
      if (bananas) { l.today += bananas; l.owed += bananas; await this.ctx.storage.put(key, l); }
      sock.send(JSON.stringify({ t: "paid", bananas, capped: bananas < earned, today: l.today, max: BANANAS.DAILY_MAX }));
    } catch { /* the player is gone; what was credited stays owed */ }
  }

  private async collect(request: Request): Promise<Response> {
    const { key } = (await request.json()) as { key: string };
    const l = await this.ctx.storage.get<Ledger>(key);
    if (!l?.owed) return json({ bananas: 0 });
    // Mark first, pay after: a lost reply costs bananas, a retry never doubles them.
    const bananas = l.owed;
    l.owed = 0;
    await this.ctx.storage.put(key, l);
    return json({ bananas });
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/collect") return this.collect(request);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    // Hibernatable: between matches (nobody queued or playing) the object can sleep with
    // the sockets still open, and idle time costs nothing. The pending hello timer keeps it
    // awake until the hello is checked, so only "in" sockets ever outlive a hibernation.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ state: "hello" } satisfies Att);
    this.helloTimers.set(server, setTimeout(() => {
      if ((server.deserializeAttachment() as Att | null)?.state !== "in") this.sockFor(server).close(4002, "no hello");
    }, HELLO_MS));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const sock = this.sockFor(ws), now = Date.now();
    const r = this.rate.get(ws) ?? { count: 0, start: now };
    if (now - r.start > 1000) { r.start = now; r.count = 0; }
    this.rate.set(ws, r);
    if (++r.count > MAX_MSGS_PER_S || typeof data !== "string" || data.length > MAX_MSG_BYTES) { sock.close(4003, "too much"); return; }
    let msg: any;
    try { msg = JSON.parse(data); } catch { return; }
    const att = ws.deserializeAttachment() as Att | null;
    if (att?.state === "hello") {
      if (msg?.t !== "hello") return;
      if (msg.v !== ROYALE_VERSION) { sock.send(JSON.stringify({ t: "err", msg: "Reload the game for the new version", reload: true })); sock.close(4004, "version"); return; }
      ws.serializeAttachment({ state: "checking" } satisfies Att);
      const who = await holderFromProof(this.env, msg.proof);
      if ("error" in who) { sock.send(JSON.stringify({ t: "err", msg: who.error })); sock.close(4005, "not a holder"); return; }
      const n = await monkeFor(this.env, who.wallet, parseInt(msg.n, 10));
      if (n == null) { sock.send(JSON.stringify({ t: "err", msg: "No Saga Monke found in this wallet" })); sock.close(4005, "no monke"); return; }
      this.clearHello(ws);
      // Kept server-side by Cloudflare with the socket; never sent to any client.
      ws.serializeAttachment({ state: "in", wallet: who.wallet, n } satisfies Att);
      sock.send(JSON.stringify({ t: "welcome", n }));
      this.hall.join(sock, who.wallet, n);
      this.run();
      return;
    }
    if (att?.state !== "in") return;
    if (msg?.t === "in") this.hall.input(sock, msg);
    else if (msg?.t === "again") { this.hall.again(sock); this.run(); }
  }

  async webSocketClose(ws: WebSocket): Promise<void> { this.gone(ws); }
  async webSocketError(ws: WebSocket): Promise<void> { this.gone(ws); }

  private clearHello(ws: WebSocket): void {
    const t = this.helloTimers.get(ws);
    if (t !== undefined) clearTimeout(t);
    this.helloTimers.delete(ws);
  }

  private gone(ws: WebSocket): void {
    this.clearHello(ws);
    this.rate.delete(ws);
    const sock = this.socks.get(ws);
    if (sock) this.hall.leave(sock);
    this.socks.delete(ws);
  }

  private sockFor(ws: WebSocket): Sock {
    let sock = this.socks.get(ws);
    if (!sock) {
      sock = { send: (d) => { try { ws.send(d); } catch { /* closed */ } }, close: (c, r) => { try { ws.close(c, r); } catch { /* already */ } } };
      this.socks.set(ws, sock);
    }
    return sock;
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
