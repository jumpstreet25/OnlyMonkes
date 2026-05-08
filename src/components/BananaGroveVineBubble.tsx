/**
 * BananaGroveVineBubble — golden vine traces the bubble perimeter with
 * banana-leaf shapes sprouting at each corner.
 * Sketch v1, 2026-05-08.
 *
 * Visual identity:
 *   - Smooth rounded-rect silhouette (organic — opposite of Cyberpunk's
 *     pixelated stairsteps).
 *   - Two-layer vine border: thicker low-alpha gold vine outside, brighter
 *     thin gold vine inside (gives the "thick neon" feel without saturating).
 *   - Banana-leaf shapes at each of the 4 corners, drawn outward from each
 *     corner anchor point. Two-tone green (dark fill + light highlight).
 *   - Smooth tapered tail toward PFP (curved bezier — not a triangular
 *     pointer; reads as a vine tendril pointing).
 *   - Warm golden halo behind, like sunlight glowing through canopy.
 *
 * Layers (back → front):
 *   1. Warm golden halo
 *   2. Dark green-brown body (semi-transparent for text contrast)
 *   3. PFP-color tint underlay (low alpha)
 *   4. Outer vine — thicker gold low-alpha stroke
 *   5. Inner vine — thinner gold high-alpha stroke
 *   6. Corner leaves — dark green base + light green highlight
 *
 * Contract matches CyberpunkGlitchBubble for drop-in swap in MessageBubble.
 */
import React, { useMemo } from "react";
import {
  Canvas,
  Path,
  BlurMask,
  Group,
} from "@shopify/react-native-skia";

interface BananaGroveVineBubbleProps {
  width: number;
  height: number;
  /** Sender's PFP dominant color — drives the inner tint underlay. */
  color: string;
  radius?: number;
  tailSide?: "left" | "right" | "none";
}

const VINE_GOLD = "#FFD24A";
const HALO_GOLD = "rgba(255, 200, 92, 0.34)";
const LEAF_GREEN_DARK = "#5D8A38";
const LEAF_GREEN_LIGHT = "#A6D070";

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

/**
 * Banana-leaf shape — base anchored at (baseX, baseY), extends outward in
 * `angleDeg` direction for `length` px, max width `width` px at midpoint.
 * Returns a closed teardrop path.
 */
function leafPath(
  baseX: number,
  baseY: number,
  length: number,
  angleDeg: number,
  width: number,
): string {
  const rad = (angleDeg * Math.PI) / 180;
  const tipX = baseX + Math.cos(rad) * length;
  const tipY = baseY + Math.sin(rad) * length;
  const perpRad = rad + Math.PI / 2;
  const halfW = width / 2;
  const midX = baseX + Math.cos(rad) * length * 0.5;
  const midY = baseY + Math.sin(rad) * length * 0.5;
  const ctrl1X = midX + Math.cos(perpRad) * halfW;
  const ctrl1Y = midY + Math.sin(perpRad) * halfW;
  const ctrl2X = midX - Math.cos(perpRad) * halfW;
  const ctrl2Y = midY - Math.sin(perpRad) * halfW;
  return `M ${baseX} ${baseY} Q ${ctrl1X} ${ctrl1Y} ${tipX} ${tipY} Q ${ctrl2X} ${ctrl2Y} ${baseX} ${baseY} Z`;
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

  // 4 corner leaves — base at each corner anchor, pointing outward
  // diagonally. Length 11 / width 6 keeps them small enough not to overlap
  // adjacent UI but large enough to register as leaves.
  const leaves = useMemo(
    () => [
      leafPath(x, y, 11, -135, 6),                     // TL → up-left
      leafPath(x + width, y, 11, -45, 6),              // TR → up-right
      leafPath(x + width, y + height, 11, 45, 6),      // BR → down-right
      leafPath(x, y + height, 11, 135, 6),             // BL → down-left
    ],
    [x, y, width, height],
  );

  if (width <= 0 || height <= 0) return null;

  const tintBody = hexToRgba(color, 0.20);

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
      {/* 1. Warm golden halo */}
      <Path path={bubblePath} color={HALO_GOLD}>
        <BlurMask blur={14} style="normal" />
      </Path>

      {/* 2. Dark warm body — semi-transparent green-brown for text contrast */}
      <Path path={bubblePath} color="rgba(15, 24, 14, 0.55)" />

      {/* 3. PFP-color tint underlay */}
      <Path path={bubblePath} color={tintBody} />

      {/* 4. Outer vine — thick, low alpha (the "neon haze") */}
      <Path
        path={bubblePath}
        color={hexToRgba(VINE_GOLD, 0.55)}
        style="stroke"
        strokeWidth={2.6}
      />

      {/* 5. Inner vine — thin, bright (the "neon core") */}
      <Path
        path={bubblePath}
        color={VINE_GOLD}
        style="stroke"
        strokeWidth={1.2}
        opacity={0.95}
      />

      {/* 6. Corner leaves — dark green fill + lighter green highlight overlay */}
      {leaves.map((p, i) => (
        <Group key={`leaf-${i}`}>
          <Path path={p} color={LEAF_GREEN_DARK} style="fill" />
          <Path path={p} color={LEAF_GREEN_LIGHT} style="fill" opacity={0.55} />
        </Group>
      ))}
    </Canvas>
  );
});
