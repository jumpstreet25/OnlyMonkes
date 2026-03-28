/**
 * livekit.ts
 *
 * LiveKit helpers — token generation via Firebase Cloud Function.
 * The API secret never ships in the APK; tokens are minted server-side.
 *
 * Env vars (via .env → app.config.ts extras):
 *   LIVEKIT_URL         — wss://your-project.livekit.cloud
 *   LIVEKIT_TOKEN_URL   — Firebase Cloud Function URL for getLivekitToken
 */

import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra as Record<string, string>) ?? {};

export const LK_URL       = extra.livekitUrl      || '';
const LK_TOKEN_URL        = extra.livekitTokenUrl  || 'https://onlymonkes-livekit-token.jumpstreet25.workers.dev';

export function livekitConfigured(): boolean {
  return !!(LK_URL && LK_TOKEN_URL);
}

// ─── Token generation (server-side via Firebase Cloud Function) ──────────────

/**
 * Request a LiveKit access token from the Firebase Cloud Function.
 * The API secret stays server-side — only the signed JWT comes back.
 */
export async function createLivekitToken(
  roomName: string,
  participantIdentity: string,
  participantName: string,
  canPublish = true,
): Promise<string> {
  if (!LK_TOKEN_URL) {
    throw new Error('LIVEKIT_TOKEN_URL not configured. Deploy the Firebase Cloud Function and add the URL to .env');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  const res = await fetch(LK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomName,
      identity: participantIdentity,
      name: participantName,
      canPublish,
    }),
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Token server error (${res.status}): ${body}`);
  }

  const { token } = await res.json();
  if (!token) throw new Error('Token server returned empty token');
  return token;
}

// ─── Room naming ───────────────────────────────────────────────────────────────

export function createRoomName(hostInboxId: string): string {
  const ts    = Date.now();
  const short = hostInboxId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  return `om-${ts}-${short}`;
}

// ─── Live room metadata (mirrored in XMTP LIVE_ROOM: messages) ────────────────

export interface LiveRoomData {
  id:       string;   // LiveKit room name
  host:     string;   // host username
  hostId:   string;   // host XMTP inboxId
  ts:       number;   // start timestamp (ms)
  active:   boolean;  // false = room ended
  eventId?: string;   // linked calendar event ID (optional)
}

export function buildLiveRoomMessage(data: LiveRoomData): string {
  return `LIVE_ROOM:${JSON.stringify(data)}`;
}

export function parseLiveRoomMessage(content: string): LiveRoomData | null {
  if (!content.startsWith('LIVE_ROOM:')) return null;
  try {
    return JSON.parse(content.slice('LIVE_ROOM:'.length)) as LiveRoomData;
  } catch {
    return null;
  }
}
