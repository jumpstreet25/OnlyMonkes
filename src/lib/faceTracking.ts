/**
 * faceTracking.ts — Blendshape-based face tracking for avatar animation.
 *
 * Uses ML Kit face detection (via react-native-vision-camera-face-detector)
 * to estimate 22 blendshapes from facial contours, landmarks, and rotations.
 * Binary data channel encoding (~104 bytes) for compact transmission.
 */

// ── Blendshape names ────────────────────────────────────────────────────────

export const BLENDSHAPE_NAMES = [
  'jawOpen',
  'mouthSmileLeft', 'mouthSmileRight',
  'mouthFrownLeft', 'mouthFrownRight',
  'mouthPucker',
  'mouthLeft', 'mouthRight',
  'eyeBlinkLeft', 'eyeBlinkRight',
  'eyeWideLeft', 'eyeWideRight',
  'eyeSquintLeft', 'eyeSquintRight',
  'browDownLeft', 'browDownRight',
  'browInnerUp',
  'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff',
  'cheekSquintLeft', 'cheekSquintRight',
] as const;

export type BlendshapeName = typeof BLENDSHAPE_NAMES[number];

// ── Types ────────────────────────────────────────────────────────────────────

export interface BlendshapeParams {
  values: Record<BlendshapeName, number>;  // 22 named blendshapes, each 0-1
  headRotation: { x: number; y: number; z: number };  // pitch, yaw, roll in degrees
}

// Legacy compat
export interface FaceParams {
  mouthOpenness: number;
  headRotation: { x: number; y: number; z: number };
  eyeOpenness: number;
}

export const BLENDSHAPE_IDLE: BlendshapeParams = {
  values: Object.fromEntries(BLENDSHAPE_NAMES.map(n => [n, 0])) as Record<BlendshapeName, number>,
  headRotation: { x: 0, y: 0, z: 0 },
};

export const FACE_PARAMS_IDLE: FaceParams = {
  mouthOpenness: 0,
  headRotation: { x: 0, y: 0, z: 0 },
  eyeOpenness: 1,
};

// ── ML Kit face → legacy FaceParams ─────────────────────────────────────────

/**
 * Convert ML Kit Face detection to legacy FaceParams (backward compat).
 */
export function faceToParams(face: any): FaceParams {
  const bounds = face.bounds ?? { height: 1 };
  const faceH = bounds.height || 1;

  let mouthOpenness = 0;
  if (face.contours?.UPPER_LIP_BOTTOM && face.contours?.LOWER_LIP_TOP) {
    const upperLip = face.contours.UPPER_LIP_BOTTOM;
    const lowerLip = face.contours.LOWER_LIP_TOP;
    if (upperLip.length > 0 && lowerLip.length > 0) {
      const upperY = upperLip.reduce((sum: number, p: any) => sum + p.y, 0) / upperLip.length;
      const lowerY = lowerLip.reduce((sum: number, p: any) => sum + p.y, 0) / lowerLip.length;
      const lipGap = Math.max(0, lowerY - upperY);
      mouthOpenness = Math.min(1, lipGap / (faceH * 0.10));
    }
  }

  return {
    mouthOpenness,
    headRotation: {
      x: face.pitchAngle ?? 0,
      y: face.yawAngle ?? 0,
      z: face.rollAngle ?? 0,
    },
    eyeOpenness: ((face.leftEyeOpenProbability ?? 1) + (face.rightEyeOpenProbability ?? 1)) / 2,
  };
}

// ── Bridge functions ─────────────────────────────────────────────────────────

/** Map BlendshapeParams to the 0-1 energy scale for mouth sprite fallback. */
export function faceParamsToEnergy(params: FaceParams): number {
  return params.mouthOpenness;
}

/** Map BlendshapeParams to legacy FaceParams for backward compat. */
export function blendshapesToFaceParams(bs: BlendshapeParams): FaceParams {
  return {
    mouthOpenness: bs.values.jawOpen,
    headRotation: bs.headRotation,
    eyeOpenness: 1 - ((bs.values.eyeBlinkLeft + bs.values.eyeBlinkRight) / 2),
  };
}

// ── Binary data channel serialization (compact) ──────────────────────────────
// 22 blendshape floats + 3 head rotation floats = 25 floats × 4 bytes = 100 bytes
// + 4 byte header (identity hash) = 104 bytes total

const FLOAT_COUNT = BLENDSHAPE_NAMES.length + 3; // 22 + 3 = 25

// Explicit Uint8Array<ArrayBuffer> return type (not bare Uint8Array, which
// TS 5.7+ defaults to Uint8Array<ArrayBufferLike>) — livekit-client 2.21.0's
// publishData() narrowed its param type to require ArrayBuffer specifically.
// Truthful here: always constructed from `new ArrayBuffer(...)`, never a
// SharedArrayBuffer.
export function encodeBlendshapes(identity: string, params: BlendshapeParams): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(4 + FLOAT_COUNT * 4); // 4 header + 100 data = 104 bytes
  const view = new DataView(buffer);

  // 4-byte identity hash (simple djb2)
  let hash = 5381;
  for (let i = 0; i < identity.length; i++) {
    hash = ((hash << 5) + hash + identity.charCodeAt(i)) | 0;
  }
  view.setInt32(0, hash, true);

  // 22 blendshape values
  let offset = 4;
  for (const name of BLENDSHAPE_NAMES) {
    view.setFloat32(offset, params.values[name], true);
    offset += 4;
  }

  // 3 head rotation values
  view.setFloat32(offset, params.headRotation.x, true); offset += 4;
  view.setFloat32(offset, params.headRotation.y, true); offset += 4;
  view.setFloat32(offset, params.headRotation.z, true);

  return new Uint8Array(buffer);
}

export function decodeBlendshapes(
  payload: Uint8Array,
): { identityHash: number; params: BlendshapeParams } | null {
  if (payload.byteLength < 4 + FLOAT_COUNT * 4) return null;

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const identityHash = view.getInt32(0, true);

  const values = { ...BLENDSHAPE_IDLE.values };
  let offset = 4;
  for (const name of BLENDSHAPE_NAMES) {
    values[name] = view.getFloat32(offset, true);
    offset += 4;
  }

  const headRotation = {
    x: view.getFloat32(offset, true),
    y: view.getFloat32(offset + 4, true),
    z: view.getFloat32(offset + 8, true),
  };

  return { identityHash, params: { values, headRotation } };
}

// ── Viseme solver (adapted from KalidoKit Face.solve) ───────────────────────
// Maps blendshape values to A/E/I/O/U vowel shapes (0-1 each).
// KalidoKit uses raw landmark distances; we adapt the same mutual-dampening
// logic to work from blendshape values directly.

export interface VisemeValues {
  A: number; // open mouth "ah" — jaw dropped, neutral width
  E: number; // slightly open, wide "eh" — mild open + mild wide
  I: number; // wide smile/teeth "ee" — wide stretch + some jaw
  O: number; // round open "oh" — jaw dropped + slight pucker
  U: number; // pursed/narrow "oo" — pucker, minimal jaw
}

function remap(val: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (val - min) / (max - min)));
}

/**
 * Derive A/E/I/O/U viseme shapes from blendshape data.
 *
 * The key insight from KalidoKit: mouth openness (Y) and width (X) are the
 * two axes that define vowel shapes. Visemes are mutually dampening — when
 * I (smile) is high, A/O/U are suppressed, and vice versa.
 *
 * Blendshape → axis mapping:
 *   mouthY (openness) = jawOpen (0-1)
 *   mouthX (width)    = avg(mouthSmileLeft, mouthSmileRight) - mouthPucker
 *                        clamped to 0-1 range
 */
export function blendshapesToVisemes(bs: BlendshapeParams): VisemeValues {
  const v = bs.values;

  // Primary axes
  const mouthY = v.jawOpen; // 0-1 openness
  const smile = (v.mouthSmileLeft + v.mouthSmileRight) / 2;
  const pucker = v.mouthPucker;
  // Width: positive = wide/smile, negative clamped to 0
  const mouthX = Math.max(0, Math.min(1, smile - pucker * 0.5));

  // I (ee/smile): high when mouth is both wide AND somewhat open
  // KalidoKit: ratioI = clamp(remap(mouthX, 0, 1) * 2 * remap(mouthY, 0.2, 0.7), 0, 1)
  const ratioI = Math.min(1, mouthX * 2 * remap(mouthY, 0.1, 0.5));

  // A (ah): scales with openness, reduced when I is high
  // KalidoKit: ratioA = mouthY * 0.4 + mouthY * (1 - ratioI) * 0.6
  const ratioA = mouthY * 0.4 + mouthY * (1 - ratioI) * 0.6;

  // U (oo/pursed): active when open but NOT wide, boosted by pucker
  // KalidoKit: ratioU = mouthY * remap(1 - ratioI, 0, 0.3) * 0.1
  // We boost with pucker since blendshapes give us that directly
  const ratioU = Math.min(1,
    mouthY * remap(1 - ratioI, 0, 0.3) * 0.1 + pucker * 0.6 * remap(mouthY, 0.05, 0.3),
  );

  // E (eh): derives from U region, mild open + mild wide
  // KalidoKit: ratioE = remap(ratioU, 0.2, 1) * (1 - ratioI) * 0.3
  const ratioE = remap(ratioU, 0.1, 0.8) * (1 - ratioI) * 0.3 +
    remap(mouthY, 0.05, 0.2) * remap(mouthX, 0.1, 0.4) * 0.4;

  // O (oh): complement of I scaled by openness, boosted by pucker
  // KalidoKit: ratioO = (1 - ratioI) * remap(mouthY, 0.3, 1) * 0.4
  const ratioO = (1 - ratioI) * remap(mouthY, 0.25, 0.8) * 0.4 +
    pucker * remap(mouthY, 0.15, 0.5) * 0.3;

  return {
    A: ratioA || 0,
    E: ratioE || 0,
    I: ratioI || 0,
    O: ratioO || 0,
    U: ratioU || 0,
  };
}

/**
 * Get the dominant viseme and its intensity for sprite selection.
 * Returns the viseme with the highest value and the combined openness.
 */
export function getDominantViseme(visemes: VisemeValues): { viseme: keyof VisemeValues; intensity: number } {
  let maxKey: keyof VisemeValues = 'A';
  let maxVal = 0;
  for (const key of ['A', 'E', 'I', 'O', 'U'] as const) {
    if (visemes[key] > maxVal) {
      maxVal = visemes[key];
      maxKey = key;
    }
  }
  return { viseme: maxKey, intensity: maxVal };
}

// Legacy JSON encode/decode (kept for backward compat during migration)
// Same Uint8Array<ArrayBuffer> narrowing as encodeBlendshapes above —
// TextEncoder.encode() is typed as Uint8Array<ArrayBufferLike> in this
// project's lib config, but never actually backs onto a SharedArrayBuffer
// at runtime, so the cast is truthful.
export function encodeFaceParams(identity: string, params: FaceParams): Uint8Array<ArrayBuffer> {
  const data = {
    i: identity,
    m: Math.round(params.mouthOpenness * 100) / 100,
    rx: Math.round(params.headRotation.x * 10) / 10,
    ry: Math.round(params.headRotation.y * 10) / 10,
    rz: Math.round(params.headRotation.z * 10) / 10,
    e: Math.round(params.eyeOpenness * 100) / 100,
  };
  return new TextEncoder().encode(JSON.stringify(data)) as Uint8Array<ArrayBuffer>;
}

export function decodeFaceParams(
  payload: Uint8Array,
): { identity: string; params: FaceParams } | null {
  try {
    const text = new TextDecoder().decode(payload);
    const data = JSON.parse(text);
    if (typeof data.i !== 'string' || typeof data.m !== 'number') return null;
    return {
      identity: data.i,
      params: {
        mouthOpenness: data.m,
        headRotation: { x: data.rx ?? 0, y: data.ry ?? 0, z: data.rz ?? 0 },
        eyeOpenness: data.e ?? 1,
      },
    };
  } catch {
    return null;
  }
}
