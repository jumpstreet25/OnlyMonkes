/**
 * Phone as the website's camera (2026-10-24). The 3D Monke viewer on a
 * computer without a webcam shows a QR; any phone opens /viewer/cam from it,
 * tracks the face in its own browser (MediaPipe) and streams only the face
 * numbers here. This relay passes them to the viewer.
 *
 *   GET /api/cam/<room>?role=camera|viewer   (WebSocket upgrade)
 *
 * Frames are AES-GCM sealed on the phone with a key that only travels in the
 * QR's #fragment, so this worker relays ciphertext it can't read. One Durable
 * Object per room (a random 128-bit id); a room holds one camera (a newer one
 * replaces it, e.g. after a reconnect) and up to 3 viewers, and closes after
 * 2 hours. Video never leaves the phone.
 */

type RateLimiter = { limit: (opts: { key: string }) => Promise<{ success: boolean }> };

export interface PhoneCamEnv {
  PHONE_CAM: DurableObjectNamespace;
  WEB_APP_ORIGINS?: string;
  WEB_RPC_LIMITER?: RateLimiter;
}

const ROOM_ID = /^[A-Za-z0-9_-]{22}$/;
const MAX_FRAME_BYTES = 256;
const MAX_VIEWERS = 3;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

function originAllowed(request: Request, env: PhoneCamEnv): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const list = (env.WEB_APP_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  return list.includes(origin);
}

export async function handlePhoneCam(path: string, request: Request, env: PhoneCamEnv): Promise<Response> {
  const room = path.slice("/api/cam/".length);
  const role = new URL(request.url).searchParams.get("role");
  if (!ROOM_ID.test(room) || (role !== "camera" && role !== "viewer")) {
    return new Response("Not found", { status: 404 });
  }
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket", { status: 426 });
  }
  if (!originAllowed(request, env)) return new Response("Forbidden", { status: 403 });
  if (env.WEB_RPC_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.WEB_RPC_LIMITER.limit({ key: `cam:${ip}` });
    if (!success) return new Response("Too many requests", { status: 429 });
  }
  const stub = env.PHONE_CAM.get(env.PHONE_CAM.idFromName(room));
  return stub.fetch(new Request(`https://cam/${role}`, { headers: { Upgrade: "websocket" } }));
}

export class PhoneCamRoom {
  constructor(private ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const role = new URL(request.url).pathname === "/camera" ? "camera" : "viewer";
    if (role === "camera") {
      for (const old of this.ctx.getWebSockets("camera")) old.close(4000, "replaced");
    } else if (this.ctx.getWebSockets("viewer").length >= MAX_VIEWERS) {
      return new Response("Room full", { status: 409 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [role]);
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    }
    this.announce();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (this.ctx.getTags(ws)[0] !== "camera") return;
    if (typeof message === "string" || message.byteLength > MAX_FRAME_BYTES) return;
    for (const viewer of this.ctx.getWebSockets("viewer")) {
      try { viewer.send(message); } catch { /* closing */ }
    }
  }

  webSocketClose(ws: WebSocket): void {
    try { ws.close(1000, "bye"); } catch { /* already closed */ }
    this.announce(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.announce(ws);
  }

  async alarm(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(4001, "expired"); } catch { /* already closed */ }
    }
    await this.ctx.storage.deleteAll();
  }

  /** Tells everyone in the room who else is here (text frames are status only). */
  private announce(leaving?: WebSocket): void {
    const open = this.ctx.getWebSockets().filter((ws) => ws !== leaving);
    const status = JSON.stringify({
      t: "status",
      camera: open.some((ws) => this.ctx.getTags(ws)[0] === "camera"),
      viewers: open.filter((ws) => this.ctx.getTags(ws)[0] === "viewer").length,
    });
    for (const ws of open) {
      try { ws.send(status); } catch { /* closing */ }
    }
  }
}
