/**
 * Web Avatar Room: use a phone as the mic + camera (a computer without them).
 * The QR opens /viewer/cam on the phone with, in the #fragment only (never sent
 * to a server): the cam-relay room + AES key (public/viewer/phonecam.js) and a
 * LiveKit pass for `<you>~phone`. The phone joins the room with its mic
 * (avatarRoom.ts folds it into you) and seals its face numbers to this browser
 * through the relay (worker-actions/src/phoneCam.ts), which can't read them.
 */
import { createLivekitToken, LK_URL } from "@/lib/livekit";
import { phoneIdentityFor } from "@/lib/avatarRoom";
import { BLENDSHAPE_NAMES, type BlendshapeName, type BlendshapeParams } from "@/lib/faceTracking";

const VERSION = 1;

export interface PhoneLink {
  url: string;
  stop(): void;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function openFrame(plain: Uint8Array): BlendshapeParams | null {
  if (plain.length !== 26 || plain[0] !== VERSION) return null;
  const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const values = {} as Record<BlendshapeName, number>;
  BLENDSHAPE_NAMES.forEach((n, i) => { values[n] = plain[1 + i] / 255; });
  return { values, headRotation: { x: view.getInt8(23), y: view.getInt8(24), z: view.getInt8(25) } };
}

/**
 * Starts a phone link for this room: returns the QR link, then calls onFace
 * with each face frame and onPhone(true/false) as the phone comes and goes.
 */
export async function startPhoneLink(opts: {
  roomName: string;
  identity: string;
  name: string;
  onFace: (params: BlendshapeParams) => void;
  onPhone: (connected: boolean) => void;
}): Promise<PhoneLink> {
  const token = await createLivekitToken(opts.roomName, phoneIdentityFor(opts.identity), opts.name, true);
  const room = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const rawKey = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const fragment = new URLSearchParams({ r: room, k: b64url(rawKey), t: token, u: LK_URL });
  const url = `${location.origin}/viewer/cam#${fragment.toString()}`;

  let ws: WebSocket | null = null;
  let stopped = false;
  let wait = 1000;
  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/cam/${room}?role=viewer`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => { wait = 1000; };
    ws.onmessage = async (e) => {
      if (typeof e.data === "string") {
        try {
          const s = JSON.parse(e.data);
          if (s?.t === "status") opts.onPhone(!!s.camera);
        } catch { /* not a status frame */ }
        return;
      }
      try {
        const bytes = new Uint8Array(e.data as ArrayBuffer);
        const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
        const face = openFrame(plain);
        if (face) opts.onFace(face);
      } catch { /* not sealed with our key */ }
    };
    ws.onclose = (e) => {
      opts.onPhone(false);
      if (stopped || e.code === 4001) return; // 4001: the relay room expired (2 h)
      setTimeout(connect, wait);
      wait = Math.min(wait * 2, 15000);
    };
  };
  connect();
  return { url, stop: () => { stopped = true; try { ws?.close(1000); } catch { /* ignore */ } } };
}
