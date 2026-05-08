/**
 * BananaGroveVineBubble — smooth bubble with two-layer gold neon vine
 * border tracing the perimeter.
 * v2, 2026-05-08.
 *
 * v2 changes:
 *   - Corner leaves removed. Were ornament that didn't earn their visual
 *     cost; the dual-layer gold neon border carries the identity alone.
 *   - Sender-keyed halo — was a fixed gold regardless of sender, which
 *     made the bot (teal palette) wear a gold halo. Now derives from
 *     `color` so each sender's halo matches their identity.
 *
 * Visual identity:
 *   - Smooth rounded-rect silhouette (organic — opposite of Cyberpunk's
 *     pixelated stairsteps).
 *   - Two-layer vine border: thicker low-alpha gold vine outside, brighter
 *     thin gold vine inside.
 *   - Smooth tapered tail toward PFP (curved bezier — vine tendril
 *     pointing at the sender's PFP).
 *
 * Layers (back → front):
 *   1. Sender-keyed halo
 *   2. Dark green-brown body (semi-transparent for text contrast)
 *   3. PFP-color tint underlay (low alpha)
 *   4. Outer vine — thicker gold low-alpha stroke
 *   5. Inner vine — thinner gold high-alpha stroke
 *
 * Contract matches CyberpunkGlitchBubble for drop-in swap in MessageBubble.
 */
import React, { useMemo } from "react";
import {
  Canvas,
  Path,
  BlurMask,
} from "@shopify/react-native-skia";

interface BananaGroveVineBubbleProps {
  width: number;
  height: number;
  /** Sender's PFP dominant color — drives the inner tint underlay + halo. */
  color: string;
  radius?: number;
  tailSide?: "left" | "right" | "none";
}

const PAD = 22;
const TAIL_LENGTH = 12;
const TAIL_HEIGHT = 16;
const PFP_TOTAL_HEIGHT = 42;
const PFP_GAP_ABOVE_TOP = 4;

function hexToRgba(hex: string, alpha: number): string {
  if (!hex.startsWith("#") || (hex.length !== 7 && hex.length !== 4)) return hex;
  let r: number, g: number, b: number;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Smooth rounded-rect with optional smooth tapered tail. */
function buildBubblePath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  tailSide: "left" | "right" | "none",
): string {
  const xR = x + w;
  const yB = y + h;
  const parts: string[] = [];

  parts.push(`M ${x + r} ${y}`);
  parts.push(`L ${xR - r} ${y}`);
  parts.push(`Q ${xR} ${y} ${xR} ${y + r}`);

  if (tailSide === "right") {
    const tailBaseBottom = yB - PFP_TOTAL_HEIGHT - PFP_GAP_ABOVE_TOP;
    const tailBaseTop = tailBaseBottom - TAIL_HEIGHT;
    if (tailBaseTop >= y + r + 4) {
      const tipY = (tailBaseTop + tailBaseBottom) / 2;
      parts.push(`L ${xR} ${tailBaseTop}`);
      // Smooth tapered curve — reads as a vine tendril pointing
      parts.push(`Q ${xR + TAIL_LENGTH * 1.4} ${tipY} ${xR} ${tailBaseBottom}`);
    }
    parts.push(`L ${xR} ${yB - r}`);
  } else {
    parts.push(`L ${xR} ${yB - r}`);
  }

  parts.push(`Q ${xR} ${yB} ${xR - r} ${yB}`);
  parts.push(`L ${x + r} ${yB}`);
  parts.push(`Q ${x} ${yB} ${x} ${yB - r}`);

  if (tailSide === "left") {
    const tailBaseBottom = yB - r - 6;
    const tailBaseTop = tailBaseBottom - TAIL_HEIGHT;
    const tipY = (tailBaseTop + tailBaseBottom) / 2;
    parts.push(`L ${x} ${tailBaseBottom}`);
    parts.push(`Q ${x - TAIL_LENGTH * 1.4} ${tipY} ${x} ${tailBaseTop}`);
    parts.push(`L ${x} ${y + r}`);
  } else {
    parts.push(`L ${x} ${y + r}`);
  }

  parts.push(`Q ${x} ${y} ${x + r} ${y}`);
  parts.push("Z");
  return parts.join(" ");
}

export const BananaGroveVineBubble = React.memo(function BananaGroveVineBubble({
  width,
  height,
  color,
  radius = 14,
  tailSide = "none",
}: BananaGroveVineBubbleProps) {
  const cw = width + PAD * 2;
  const ch = height + PAD * 2;
  const x = PAD;
  const y = PAD;

  const bubblePath = useMemo(
    () => buildBubblePath(x, y, width, height, radius, tailSide),
    [x, y, width, height, radius, tailSide],
  );

  if (width <= 0 || height <= 0) return null;

  const tintBody = hexToRgba(color, 0.20);
  // Sender-keyed halo — was a fixed gold that mismatched the bot (teal
  // palette). Now each sender's PFP color drives the halo so the bubble
  // glow matches their identity.
  const halo = hexToRgba(color, 0.34);

  return (
    <Canvas
      style={{
        width: cw,
        height: ch,
        position: "absolute",
        top: -PAD,
        left: -PAD,
      }}
      pointerEvents="none"
    >
      {/* 1. Sender-keyed halo */}
      <Path path={bubblePath} color={halo}>
        <BlurMask blur={14} style="normal" />
      </Path>

      {/* 2. Dark warm body — semi-transparent green-brown for text contrast */}
      <Path path={bubblePath} color="rgba(15, 24, 14, 0.55)" />

      {/* 3. PFP-color tint underlay */}
      <Path path={bubblePath} color={tintBody} />

      {/* (v3 2026-05-08) Gold neon vine outlines removed — read as a yellow
          frame that clashed against bot's pink palette and didn't earn its
          visual cost. Bubble now reads as a soft sender-tinted glass orb. */}
    </Canvas>
  );
});
