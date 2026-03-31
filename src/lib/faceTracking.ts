/**
 * faceTracking.ts — Blendshape-based face tracking for avatar animation.
 *
 * Supports both MediaPipe 52-blendshape mode and legacy ML Kit FaceParams.
 * Binary data channel encoding (~104 bytes) for compact transmission.
 */

// ── Blendshape names (MediaPipe standard) ────────────────────────────────────

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

// ── MediaPipe result → BlendshapeParams ──────────────────────────────────────

interface MediaPipeCategory {
  categoryName?: string;
  score: number;
}

interface MediaPipeClassifications {
  categories: MediaPipeCategory[];
}

/**
 * Convert MediaPipe faceBlendshapes result to BlendshapeParams.
 * MediaPipe returns 52 blendshapes — we extract the 22 most useful ones.
 */
export function mediapipeToBlendshapes(
  blendshapeClassifications: MediaPipeClassifications[],
  transformMatrix?: number[][],
): BlendshapeParams {
  const values = { ...BLENDSHAPE_IDLE.values };

  if (blendshapeClassifications.length > 0) {
    const cats = blendshapeClassifications[0].categories;
    for (const cat of cats) {
      const name = cat.categoryName as BlendshapeName;
      if (name && name in values) {
        values[name] = cat.score;
      }
    }
  }

  // Extract head rotation from transformation matrix if available
  let headRotation = { x: 0, y: 0, z: 0 };
  if (transformMatrix && transformMatrix.length >= 3) {
    // Approximate Euler angles from rotation matrix
    const m = transformMatrix;
    headRotation = {
      x: Math.atan2(-m[1][2], m[2][2]) * (180 / Math.PI), // pitch
      y: Math.asin(m[0][2]) * (180 / Math.PI),             // yaw
      z: Math.atan2(-m[0][1], m[0][0]) * (180 / Math.PI),  // roll
    };
  }

  return { values, headRotation };
}

// ── Legacy ML Kit compat ─────────────────────────────────────────────────────

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

export function encodeBlendshapes(identity: string, params: BlendshapeParams): Uint8Array {
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

// Legacy JSON encode/decode (kept for backward compat during migration)
export function encodeFaceParams(identity: string, params: FaceParams): Uint8Array {
  const data = {
    i: identity,
    m: Math.round(params.mouthOpenness * 100) / 100,
    rx: Math.round(params.headRotation.x * 10) / 10,
    ry: Math.round(params.headRotation.y * 10) / 10,
    rz: Math.round(params.headRotation.z * 10) / 10,
    e: Math.round(params.eyeOpenness * 100) / 100,
  };
  return new TextEncoder().encode(JSON.stringify(data));
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
