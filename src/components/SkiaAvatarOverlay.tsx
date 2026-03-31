/**
 * SkiaAvatarOverlay — GPU-accelerated expression rendering using Skia canvas.
 *
 * Draws continuous bezier-curve expressions (mouth, eyes, brows) on top of the
 * NFT PFP, driven by 22 blendshape values from MediaPipe face tracking.
 *
 * Replaces the 5-state sprite system with smooth, continuous animation:
 * - Mouth: Bezier curves with asymmetric smile/frown
 * - Eyes: Ellipses with blink/wide/squint
 * - Brows: Arc curves with raise/furrow
 * - Cheeks: Radial expansion on puff
 *
 * All coordinates are relative to the PFP size for resolution independence.
 */

import React from 'react';
import { Canvas, Path, Circle, Group } from '@shopify/react-native-skia';
import type { BlendshapeParams, BlendshapeName } from '@/lib/faceTracking';
import { MOUTH_OVERLAY_RECT } from '@/lib/mouthOverlays';

interface SkiaAvatarOverlayProps {
  blendshapes: BlendshapeParams;
  size: number;
}

// Helper to get blendshape value with default 0
function bs(values: Record<BlendshapeName, number>, name: BlendshapeName): number {
  return values[name] ?? 0;
}

// Interpolate between two values
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export const SkiaAvatarOverlay = React.memo(function SkiaAvatarOverlay({
  blendshapes,
  size,
}: SkiaAvatarOverlayProps) {
  const v = blendshapes.values;

  // ── Coordinate system (relative to PFP size) ────────────────────────────

  // Mouth region
  const mouthCx = size * (MOUTH_OVERLAY_RECT.leftPct + MOUTH_OVERLAY_RECT.widthPct / 2);
  const mouthCy = size * (MOUTH_OVERLAY_RECT.topPct + MOUTH_OVERLAY_RECT.heightPct / 2);
  const mouthW = size * MOUTH_OVERLAY_RECT.widthPct;
  const mouthH = size * MOUTH_OVERLAY_RECT.heightPct;

  // Eye positions (relative to PFP — estimated for Saga Monke pixel art)
  const eyeY = size * 0.44;
  const leftEyeX = size * 0.36;
  const rightEyeX = size * 0.64;
  const eyeW = size * 0.08;
  const eyeH = size * 0.05;

  // Brow positions (above eyes)
  const browY = eyeY - size * 0.06;
  const browW = eyeW * 1.3;

  // ── Mouth path (bezier curve) ──────────────────────────────────────────

  const jawOpen = bs(v, 'jawOpen');
  const smileL = bs(v, 'mouthSmileLeft');
  const smileR = bs(v, 'mouthSmileRight');
  const frownL = bs(v, 'mouthFrownLeft');
  const frownR = bs(v, 'mouthFrownRight');
  const pucker = bs(v, 'mouthPucker');

  // Mouth width narrows with pucker
  const mouthOpenW = mouthW * lerp(1, 0.5, pucker);
  // Mouth height from jaw open
  const mouthOpenH = mouthH * lerp(0.15, 1.2, jawOpen);

  // Corner Y offsets from smile/frown
  const leftCornerDy = lerp(0, -mouthH * 0.4, smileL) + lerp(0, mouthH * 0.3, frownL);
  const rightCornerDy = lerp(0, -mouthH * 0.4, smileR) + lerp(0, mouthH * 0.3, frownR);

  // Build mouth path
  const mLeft = mouthCx - mouthOpenW / 2;
  const mRight = mouthCx + mouthOpenW / 2;
  const mTop = mouthCy - mouthOpenH / 3;
  const mBottom = mouthCy + mouthOpenH * 2 / 3;

  const mouthPath = `
    M ${mLeft} ${mouthCy + leftCornerDy}
    Q ${mouthCx} ${mTop} ${mRight} ${mouthCy + rightCornerDy}
    Q ${mouthCx} ${mBottom} ${mLeft} ${mouthCy + leftCornerDy}
    Z
  `;

  // ── Eye rendering ──────────────────────────────────────────────────────

  const blinkL = bs(v, 'eyeBlinkLeft');
  const blinkR = bs(v, 'eyeBlinkRight');
  const wideL = bs(v, 'eyeWideLeft');
  const wideR = bs(v, 'eyeWideRight');
  const squintL = bs(v, 'eyeSquintLeft');
  const squintR = bs(v, 'eyeSquintRight');

  // Eye height: shrinks with blink/squint, grows with wide
  const leftEyeH = eyeH * lerp(1, 0.05, blinkL) * lerp(1, 0.7, squintL) * lerp(1, 1.4, wideL);
  const rightEyeH = eyeH * lerp(1, 0.05, blinkR) * lerp(1, 0.7, squintR) * lerp(1, 1.4, wideR);

  // ── Brow rendering ─────────────────────────────────────────────────────

  const browDownL = bs(v, 'browDownLeft');
  const browDownR = bs(v, 'browDownRight');
  const browInnerUp = bs(v, 'browInnerUp');
  const browOuterUpL = bs(v, 'browOuterUpLeft');
  const browOuterUpR = bs(v, 'browOuterUpRight');

  // Brow Y offsets
  const leftBrowInnerDy = lerp(0, size * 0.02, browDownL) - lerp(0, size * 0.025, browInnerUp);
  const leftBrowOuterDy = -lerp(0, size * 0.02, browOuterUpL);
  const rightBrowInnerDy = lerp(0, size * 0.02, browDownR) - lerp(0, size * 0.025, browInnerUp);
  const rightBrowOuterDy = -lerp(0, size * 0.02, browOuterUpR);

  const leftBrowPath = `
    M ${leftEyeX - browW / 2} ${browY + leftBrowOuterDy}
    Q ${leftEyeX} ${browY - size * 0.015 + (leftBrowInnerDy + leftBrowOuterDy) / 2}
      ${leftEyeX + browW / 2} ${browY + leftBrowInnerDy}
  `;
  const rightBrowPath = `
    M ${rightEyeX - browW / 2} ${browY + rightBrowInnerDy}
    Q ${rightEyeX} ${browY - size * 0.015 + (rightBrowInnerDy + rightBrowOuterDy) / 2}
      ${rightEyeX + browW / 2} ${browY + rightBrowOuterDy}
  `;

  // ── Cheek puff ─────────────────────────────────────────────────────────

  const cheekPuff = bs(v, 'cheekPuff');
  const cheekRadius = size * 0.03 * cheekPuff;
  const cheekY = mouthCy - size * 0.02;

  return (
    <Canvas style={{ width: size, height: size, position: 'absolute', top: 0, left: 0 }}>
      {/* Mouth — dark fill with bezier shape */}
      {jawOpen > 0.03 && (
        <Path
          path={mouthPath}
          color="rgba(30, 18, 15, 0.85)"
          style="fill"
        />
      )}

      {/* Closed mouth line when jaw is mostly closed */}
      {jawOpen <= 0.03 && (
        <Path
          path={`M ${mLeft} ${mouthCy + leftCornerDy} L ${mRight} ${mouthCy + rightCornerDy}`}
          color="rgba(30, 18, 15, 0.6)"
          style="stroke"
          strokeWidth={size * 0.006}
        />
      )}

      {/* Left eye */}
      <Group transform={[{ translateX: leftEyeX }, { translateY: eyeY }]}>
        {/* Sclera */}
        <Circle cx={0} cy={0} r={eyeW / 2} color="rgba(255, 255, 255, 0.9)" />
        {/* Pupil */}
        <Circle cx={0} cy={0} r={eyeW * 0.25} color="rgba(20, 15, 10, 0.95)" />
        {/* Eyelid overlay (closes from top) */}
        {blinkL > 0.1 && (
          <Path
            path={`
              M ${-eyeW / 2} ${-eyeH / 2}
              L ${eyeW / 2} ${-eyeH / 2}
              L ${eyeW / 2} ${lerp(-eyeH / 2, eyeH / 2, blinkL)}
              L ${-eyeW / 2} ${lerp(-eyeH / 2, eyeH / 2, blinkL)}
              Z
            `}
            color="rgba(80, 60, 50, 0.9)"
            style="fill"
          />
        )}
      </Group>

      {/* Right eye */}
      <Group transform={[{ translateX: rightEyeX }, { translateY: eyeY }]}>
        <Circle cx={0} cy={0} r={eyeW / 2} color="rgba(255, 255, 255, 0.9)" />
        <Circle cx={0} cy={0} r={eyeW * 0.25} color="rgba(20, 15, 10, 0.95)" />
        {blinkR > 0.1 && (
          <Path
            path={`
              M ${-eyeW / 2} ${-eyeH / 2}
              L ${eyeW / 2} ${-eyeH / 2}
              L ${eyeW / 2} ${lerp(-eyeH / 2, eyeH / 2, blinkR)}
              L ${-eyeW / 2} ${lerp(-eyeH / 2, eyeH / 2, blinkR)}
              Z
            `}
            color="rgba(80, 60, 50, 0.9)"
            style="fill"
          />
        )}
      </Group>

      {/* Brows */}
      <Path
        path={leftBrowPath}
        color="rgba(50, 35, 25, 0.8)"
        style="stroke"
        strokeWidth={size * 0.008}
        strokeCap="round"
      />
      <Path
        path={rightBrowPath}
        color="rgba(50, 35, 25, 0.8)"
        style="stroke"
        strokeWidth={size * 0.008}
        strokeCap="round"
      />

      {/* Cheek puff */}
      {cheekPuff > 0.2 && (
        <>
          <Circle
            cx={leftEyeX - size * 0.04}
            cy={cheekY}
            r={cheekRadius}
            color={`rgba(255, 180, 160, ${cheekPuff * 0.4})`}
          />
          <Circle
            cx={rightEyeX + size * 0.04}
            cy={cheekY}
            r={cheekRadius}
            color={`rgba(255, 180, 160, ${cheekPuff * 0.4})`}
          />
        </>
      )}
    </Canvas>
  );
});
