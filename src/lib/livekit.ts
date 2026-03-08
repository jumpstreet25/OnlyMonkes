/**
 * livekit.ts
 *
 * LiveKit token generation (client-side JWT via crypto-js) and room helpers.
 *
 * Credentials come from app.config.ts extras → .env:
 *   LIVEKIT_URL        — wss://your-project.livekit.cloud
 *   LIVEKIT_API_KEY    — API key from LiveKit Cloud dashboard
 *   LIVEKIT_API_SECRET — API secret from LiveKit Cloud dashboard
 *
 * Setup (one-time):
 *   1. Sign up at https://livekit.io/cloud → create a project
 *   2. Copy URL, API Key, Secret into .env
 *   3. Rebuild the APK
 */

import CryptoJS from 'crypto-js';
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra as Record<string, string>) ?? {};

export const LK_URL    = extra.livekitUrl    || 'wss://onlymonkes-emw5bbmh.livekit.cloud';
export const LK_KEY    = extra.livekitApiKey  || 'REDACTED_LIVEKIT_API_KEY';
export const LK_SECRET = extra.livekitApiSecret || 'REDACTED_LIVEKIT_API_SECRET';

export function livekitConfigured(): boolean {
  return !!(LK_URL && LK_KEY && LK_SECRET);
}

// ─── JWT token generation ──────────────────────────────────────────────────────

function b64url(input: string): string {
  // Convert plain base64 to base64url
  return input.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function encodeSegment(obj: object): string {
  const json = JSON.stringify(obj);
  // Buffer is available globally in Expo via Metro's polyfill
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  return b64url(b64);
}

/**
 * Generate a LiveKit access token entirely in JS (no server needed).
 * Uses HMAC-SHA256 from crypto-js — works in React Native Hermes.
 */
export function createLivekitToken(
  roomName: string,
  participantIdentity: string,
  participantName: string,
  canPublish = true,
): string {
  if (!LK_KEY || !LK_SECRET) {
    throw new Error('LiveKit credentials not configured. Add LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET to .env');
  }

  const now = Math.floor(Date.now() / 1000);

  const header = encodeSegment({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeSegment({
    sub:  participantIdentity,
    name: participantName,
    iss:  LK_KEY,
    iat:  now,
    nbf:  now - 60,
    exp:  now + 6 * 3600, // 6-hour token
    video: {
      roomCreate:      false,
      roomJoin:        true,
      room:            roomName,
      canPublish,
      canSubscribe:    true,
      canPublishData:  true,
    },
  });

  const input = `${header}.${payload}`;
  const hmac  = CryptoJS.HmacSHA256(input, LK_SECRET);
  const sig   = b64url(CryptoJS.enc.Base64.stringify(hmac));

  return `${input}.${sig}`;
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
