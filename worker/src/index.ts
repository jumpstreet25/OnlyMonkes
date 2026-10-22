/**
 * Cloudflare Worker — LiveKit Token Server
 *
 * Generates LiveKit access tokens server-side so the API secret
 * never ships in the APK.
 *
 * Secrets (set via `wrangler secret put`):
 *   LK_API_KEY    — LiveKit API key
 *   LK_API_SECRET — LiveKit API secret
 *
 * Holders only (2026-10-22): every request carries a `proof` that the actions
 * worker checks over the ACTIONS service binding (worker-actions/src/
 * livekitAuth.ts) — the web app's holder sign-in token, or the phone's
 * Device-Integrity hardware key signing this room + identity. The verified
 * wallet goes into the token's metadata. ALLOW_UNVERIFIED="1" keeps old
 * proof-less clients working while the OTA rolls out; set it to "0" after.
 */

interface Env {
  LK_API_KEY: string;
  LK_API_SECRET: string;
  ACTIONS: { fetch: (input: Request | string, init?: RequestInit) => Promise<Response> };
  ALLOW_UNVERIFIED?: string;
}

const ROOM = /^omv?-\d{10,14}-[A-Za-z0-9]{1,8}$/;
const TOKEN_TTL_S = 2 * 3600;

type ExportedHandler<E = unknown> = {
  fetch: (request: Request, env: E) => Promise<Response>;
};

interface TokenRequest {
  roomName: string;
  identity: string;
  name?: string;
  canPublish?: boolean;
  proof?: unknown;
}

// ─── JWT helpers (Web Crypto API — runs natively on CF Workers) ──────────────

function b64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function encodeSegment(obj: object): string {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function createToken(
  apiKey: string,
  apiSecret: string,
  roomName: string,
  identity: string,
  name: string,
  canPublish: boolean,
  metadata: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = encodeSegment({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeSegment({
    sub: identity,
    name,
    iss: apiKey,
    iat: now,
    nbf: now - 60,
    exp: now + TOKEN_TTL_S,
    metadata,
    video: {
      // Hosts must create rooms; canPublish true ≈ publisher/host path.
      // LiveKit rejects first join when roomCreate is false and room is empty.
      roomCreate: canPublish === true,
      roomJoin: true,
      room: roomName,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    },
  });

  const input = `${header}.${payload}`;

  // HMAC-SHA256 via Web Crypto API
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));

  return `${input}.${b64url(sig)}`;
}

// ─── Worker handler ──────────────────────────────────────────────────────────

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    if (!env.LK_API_KEY || !env.LK_API_SECRET) {
      return Response.json({ error: 'LiveKit credentials not configured' }, { status: 500 });
    }

    let body: TokenRequest;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const name = typeof body.name === 'string' && body.name ? body.name.slice(0, 40) : '';
    if (typeof body.roomName !== 'string' || !ROOM.test(body.roomName) || typeof body.identity !== 'string' || !body.identity || body.identity.length > 128) {
      return Response.json({ error: 'Invalid roomName or identity' }, { status: 400, headers: CORS });
    }

    let wallet = '';
    if (body.proof) {
      const res = await env.ACTIONS.fetch('https://internal.onlymonkes/api/livekit/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: body.roomName, identity: body.identity, proof: body.proof }),
      });
      const auth = (await res.json().catch(() => ({}))) as { ok?: boolean; wallet?: string; error?: string };
      if (res.ok && auth.ok && auth.wallet) {
        wallet = auth.wallet;
        console.log(`[token] verified room=${body.roomName}`);
      } else if (env.ALLOW_UNVERIFIED === '1') {
        console.log(`[token] proof rejected (${auth.error ?? res.status}), allowed during rollout room=${body.roomName}`);
      } else {
        return Response.json({ error: auth.error ?? 'Not authorized' }, { status: res.status === 200 ? 403 : res.status, headers: CORS });
      }
    } else if (env.ALLOW_UNVERIFIED === '1') {
      console.log(`[token] unverified request room=${body.roomName}`);
    } else {
      return Response.json({ error: 'Holders only — update the app' }, { status: 401, headers: CORS });
    }

    const token = await createToken(
      env.LK_API_KEY,
      env.LK_API_SECRET,
      body.roomName,
      body.identity,
      name || body.identity,
      body.canPublish ?? true,
      JSON.stringify(wallet ? { wallet } : { unverified: true }),
    );

    return Response.json({ token, verified: !!wallet }, { headers: CORS });
  },
} satisfies ExportedHandler<Env>;
