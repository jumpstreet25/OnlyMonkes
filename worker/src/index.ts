/**
 * Cloudflare Worker — LiveKit Token Server
 *
 * Generates LiveKit access tokens server-side so the API secret
 * never ships in the APK.
 *
 * Secrets (set via `wrangler secret put`):
 *   LK_API_KEY    — LiveKit API key
 *   LK_API_SECRET — LiveKit API secret
 */

interface Env {
  LK_API_KEY: string;
  LK_API_SECRET: string;
}

interface TokenRequest {
  roomName: string;
  identity: string;
  name?: string;
  canPublish?: boolean;
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
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = encodeSegment({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeSegment({
    sub: identity,
    name,
    iss: apiKey,
    iat: now,
    nbf: now - 60,
    exp: now + 6 * 3600,
    video: {
      roomCreate: false,
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

    if (!body.roomName || !body.identity) {
      return Response.json({ error: 'Missing roomName or identity' }, { status: 400 });
    }

    const token = await createToken(
      env.LK_API_KEY,
      env.LK_API_SECRET,
      body.roomName,
      body.identity,
      body.name || body.identity,
      body.canPublish ?? true,
    );

    return Response.json({ token }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  },
} satisfies ExportedHandler<Env>;
