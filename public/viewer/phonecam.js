// Phone as the website's camera — shared by the 3D viewer (monke3d.html) and
// the phone page (cam.html). The phone seals each face frame with AES-GCM
// under a key that only travels in the QR's #fragment; the relay
// (worker-actions/src/phoneCam.ts) passes ciphertext it can't read.
//
// Frame plaintext (26 bytes): version, the 22 blendshapes in
// src/lib/faceTracking.ts order as 0–255, head pitch/yaw/roll in degrees as int8.

export const NAMES = [
  "jawOpen",
  "mouthSmileLeft", "mouthSmileRight",
  "mouthFrownLeft", "mouthFrownRight",
  "mouthPucker",
  "mouthLeft", "mouthRight",
  "eyeBlinkLeft", "eyeBlinkRight",
  "eyeWideLeft", "eyeWideRight",
  "eyeSquintLeft", "eyeSquintRight",
  "browDownLeft", "browDownRight",
  "browInnerUp",
  "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff",
  "cheekSquintLeft", "cheekSquintRight",
];
const VERSION = 1;

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** A new room: 128-bit id for the relay, 128-bit key that stays in the link. */
export function newSession() {
  return { room: b64url(crypto.getRandomValues(new Uint8Array(16))), key: b64url(crypto.getRandomValues(new Uint8Array(16))) };
}

export function sessionFromHash(hash) {
  const p = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const room = p.get("r") || "", key = p.get("k") || "";
  return /^[A-Za-z0-9_-]{22}$/.test(room) && /^[A-Za-z0-9_-]{22}$/.test(key) ? { room, key } : null;
}

export const phoneUrl = ({ room, key }) => `${location.origin}/viewer/cam#r=${room}&k=${key}`;

export const importKey = (key) => crypto.subtle.importKey("raw", fromB64url(key), "AES-GCM", false, ["encrypt", "decrypt"]);

export async function seal(cryptoKey, values, headRotation) {
  const plain = new Uint8Array(26);
  const view = new DataView(plain.buffer);
  plain[0] = VERSION;
  NAMES.forEach((n, i) => { plain[1 + i] = Math.round(Math.max(0, Math.min(1, Number(values[n]) || 0)) * 255); });
  ["x", "y", "z"].forEach((k, i) => view.setInt8(23 + i, Math.max(-127, Math.min(127, Math.round(Number(headRotation?.[k]) || 0)))));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, plain));
  const out = new Uint8Array(12 + sealed.length);
  out.set(iv);
  out.set(sealed, 12);
  return out;
}

/** → { values, headRotation }, or null for anything that doesn't open. */
export async function open(cryptoKey, data) {
  try {
    const bytes = new Uint8Array(data);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, cryptoKey, bytes.slice(12)));
    if (plain.length !== 26 || plain[0] !== VERSION) return null;
    const view = new DataView(plain.buffer);
    const values = {};
    NAMES.forEach((n, i) => { values[n] = plain[1 + i] / 255; });
    return { values, headRotation: { x: view.getInt8(23), y: view.getInt8(24), z: view.getInt8(25) } };
  } catch {
    return null;
  }
}

/**
 * Keeps a relay connection open, reconnecting with backoff.
 * onStatus({ camera, viewers }) for the room's text status frames,
 * onFrame(ArrayBuffer) for binary frames, onState("open" | "closed" | "expired").
 */
export function connect({ room, role, onStatus, onFrame, onState }) {
  let ws = null, stopped = false, wait = 1000;
  const url = `${location.origin.replace(/^http/, "ws")}/api/cam/${room}?role=${role}`;
  const start = () => {
    if (stopped) return;
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => { wait = 1000; onState?.("open"); };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        try { const s = JSON.parse(e.data); if (s && s.t === "status") onStatus?.({ camera: !!s.camera, viewers: Number(s.viewers) || 0 }); } catch { /* ignore */ }
      } else {
        onFrame?.(e.data);
      }
    };
    ws.onclose = (e) => {
      if (e.code === 4001) { stopped = true; onState?.("expired"); return; }
      if (e.code === 4000) { stopped = true; onState?.("replaced"); return; }
      onState?.("closed");
      if (!stopped) { setTimeout(start, wait); wait = Math.min(wait * 2, 15000); }
    };
  };
  start();
  return {
    send: (bytes) => { if (ws && ws.readyState === 1 && ws.bufferedAmount < 4096) ws.send(bytes); },
    close: () => { stopped = true; try { ws?.close(1000); } catch { /* ignore */ } },
  };
}

/** MediaPipe face tracking on this device's front camera; calls onFace ~15×/s. */
export async function startFaceTracking(video, onFace) {
  const vision = await new Promise((resolve, reject) => {
    if (globalThis.__OM_MEDIAPIPE) return resolve(globalThis.__OM_MEDIAPIPE);
    addEventListener("om-mediapipe-ready", () => resolve(globalThis.__OM_MEDIAPIPE), { once: true });
    const s = document.createElement("script");
    s.type = "module";
    s.src = "/vendor/mediapipe-loader.mjs";
    s.onerror = () => reject(new Error("tracker failed to load"));
    document.head.appendChild(s);
  });
  const base = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0";
  const fileset = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
  const lm = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", delegate: "GPU" },
    runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
  });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 320, height: 240 }, audio: false });
  video.muted = true; video.playsInline = true; video.srcObject = stream;
  await video.play();
  const DEG = 180 / Math.PI;
  let last = 0, running = true;
  const tick = (now) => {
    if (!running) return;
    requestAnimationFrame(tick);
    if (now - last < 66 || video.readyState < 2) return;
    last = now;
    const res = lm.detectForVideo(video, now);
    const cats = res?.faceBlendshapes?.[0]?.categories;
    if (!cats) return;
    const values = {};
    for (const c of cats) values[c.categoryName] = c.score;
    const m = res.facialTransformationMatrixes?.[0]?.data;
    const r = (row, col) => m[col * 4 + row];
    const headRotation = m ? {
      x: Math.atan2(r(2, 1), r(2, 2)) * DEG,
      y: Math.asin(Math.max(-1, Math.min(1, -r(2, 0)))) * DEG,
      z: Math.atan2(r(1, 0), r(0, 0)) * DEG,
    } : {};
    onFace(values, headRotation);
  };
  requestAnimationFrame(tick);
  return () => { running = false; stream.getTracks().forEach((t) => t.stop()); lm.close?.(); };
}

/** The message to show when a camera can't start. */
export function cameraError(e) {
  if (e?.name === "NotAllowedError") return "Camera permission was denied. Allow it in the browser's site settings and try again.";
  if (e?.name === "NotFoundError" || e?.name === "OverconstrainedError") return "No camera found on this device.";
  if (e?.name === "NotReadableError") return "The camera is in use by another app. Close it and try again.";
  return "Face tracking couldn't start on this device.";
}
