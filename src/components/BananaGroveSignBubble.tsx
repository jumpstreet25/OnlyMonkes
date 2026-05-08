/**
 * BananaGroveSignBubble — carved wooden sign aesthetic.
 * Sketch v1, 2026-05-08. Drop-in replacement for the dark glass surface
 * when the world bubble skin resolves to Banana Grove.
 *
 * Visual identity:
 *   - Wood-grain plank body — warm vertical brown gradient with wavy
 *     horizontal grain lines (Skia paths, not noise textures, so it reads
 *     as carved/painted rather than photographic).
 *   - Hand-carved corner chips — small triangular cuts at each corner give
 *     the silhouette a "hand-shaped" quality (organic counterpart to
 *     Cyberpunk's machined pixelated stairsteps).
 *   - Recessed inner frame — thin darker line just inside the perimeter,
 *     reads as a chiseled border around the sign face.
 *   - Polished gold edge — outer 1.2px stroke in the SENDER's PFP color so
 *     each user has their own polished-wood-edge tint.
 *   - Soft warm amber halo behind, like dusk light catching the sign.
 *
 * Layers (back → front):
 *   1. Amber glow halo
 *   2. Brown wood gradient (light top → dark bottom)
 *   3. PFP-color tint underlay (low alpha — wood "species" identity)
 *   4. Wavy grain lines (darker brown, thin strokes)
 *   5. Recessed inner frame (very thin dark stroke)
 *   6. Polished outer edge (sender's PFP color, 1.2px stroke)
 *
 * Contract matches CyberpunkGlitchBubble for drop-in swap in MessageBubble.
 */
import React, { useMemo } from "react";
import {
  Canvas,
  Path,
  BlurMask,
  LinearGradient,
  vec,
} from "@shopify/react-native-skia";

interface BananaGroveSignBubbleProps {
  width: number;
  height: number;
  /** Sender's PFP dominant color (drives the polished outer edge). */
  color: string;
  radius?: number;
  tailSide?: "left" | "right" | "none";
}

const WOOD_LIGHT = "#5C3A1F";
const WOOD_DARK = "#2D1810";
const GRAIN_COLOR = "rgba(20, 12, 6, 0.42)";
const HALO_AMBER = "rgba(255, 180, 80, 0.32)";
const FRAME_INNER = "rgba(15, 8, 4, 0.55)";

const PAD = 22;
const TAIL_LENGTH = 10;
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

/** Bubble outline with diagonal corner chips (carved-by-hand feel). */
function buildSignPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  tailSide: "left" | "right" | "none",
): string {
  const xR = x + w;
  const yB = y + h;
  // Chip size — small triangular cut at each corner. Smaller than the
  // legacy `radius` so corners feel chipped, not chamfered.
  const c = Math.min(r * 0.45, 5);
  const parts: string[] = [];

  parts.push(`M ${x + c} ${y}`);
  parts.push(`L ${xR - c} ${y}`);
  // TR chip
  parts.push(`L ${xR} ${y + c}`);

  if (tailSide === "right") {
    const tailBaseBottom = yB - PFP_TOTAL_HEIGHT - PFP_GAP_ABOVE_TOP;
    const tailBaseTop = tailBaseBottom - TAIL_HEIGHT;
    if (tailBaseTop >= y + c + 4) {
      const tailTipY = (tailBaseTop + tailBaseBottom) / 2;
      parts.push(`L ${xR} ${tailBaseTop}`);
      // Wooden peg — short rectangular extension w/ slight outer taper
      parts.push(`L ${xR + TAIL_LENGTH - 2} ${tailBaseTop + 1}`);
      parts.push(`L ${xR + TAIL_LENGTH} ${tailBaseTop + 3}`);
      parts.push(`L ${xR + TAIL_LENGTH} ${tailBaseBottom - 3}`);
      parts.push(`L ${xR + TAIL_LENGTH - 2} ${tailBaseBottom - 1}`);
      parts.push(`L ${xR} ${tailBaseBottom}`);
    }
    parts.push(`L ${xR} ${yB - c}`);
  } else {
    parts.push(`L ${xR} ${yB - c}`);
  }

  // BR chip
  parts.push(`L ${xR - c} ${yB}`);
  parts.push(`L ${x + c} ${yB}`);
  // BL chip
  parts.push(`L ${x} ${yB - c}`);

  if (tailSide === "left") {
    const tailBaseBottom = yB - c - 6;
    const tailBaseTop = tailBaseBottom - TAIL_HEIGHT;
    parts.push(`L ${x} ${tailBaseBottom}`);
    parts.push(`L ${x - TAIL_LENGTH + 2} ${tailBaseBottom - 1}`);
    parts.push(`L ${x - TAIL_LENGTH} ${tailBaseBottom - 3}`);
    parts.push(`L ${x - TAIL_LENGTH} ${tailBaseTop + 3}`);
    parts.push(`L ${x - TAIL_LENGTH + 2} ${tailBaseTop + 1}`);
    parts.push(`L ${x} ${tailBaseTop}`);
    parts.push(`L ${x} ${y + c}`);
  } else {
    parts.push(`L ${x} ${y + c}`);
  }

  // TL chip
  parts.push(`L ${x + c} ${y}`);
  parts.push("Z");
  return parts.join(" ");
}

/** Wavy horizontal grain lines — natural wood, not perfectly straight. */
function buildGrainPath(x: number, y: number, w: number, h: number): string {
  const lines = 5;
  const parts: string[] = [];
  for (let i = 1; i <= lines; i++) {
    const ly = y + (h / (lines + 1)) * i + (i % 2 === 0 ? 1.2 : -0.8);
    const cy = ly + (i % 2 === 0 ? 1.5 : -1.5);
    parts.push(`M ${x + 8} ${ly} Q ${x + w / 2} ${cy} ${x + w - 8} ${ly}`);
  }
  return parts.join(" ");
}

export const BananaGroveSignBubble = React.memo(function BananaGroveSignBubble({
  width,
  height,
  color,
  radius = 14,
  tailSide = "none",
}: BananaGroveSignBubbleProps) {
  const cw = width + PAD * 2;
  const ch = height + PAD * 2;
  const x = PAD;
  const y = PAD;

  const bubblePath = useMemo(
    () => buildSignPath(x, y, width, height, radius, tailSide),
    [x, y, width, height, radius, tailSide],
  );
  const grainPath = useMemo(
    () => buildGrainPath(x, y, width, height),
    [x, y, width, height],
  );

  if (width <= 0 || height <= 0) return null;

  const tintBody = hexToRgba(color, 0.18);
  const polishedEdge = hexToRgba(color, 0.85);

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
      {/* 1. Warm amber halo — dusk light catching the sign */}
      <Path path={bubblePath} color={HALO_AMBER}>
        <BlurMask blur={16} style="normal" />
      </Path>

      {/* 2. Wood gradient body */}
      <Path path={bubblePath}>
        <LinearGradient
          start={vec(0, y)}
          end={vec(0, y + height)}
          colors={[WOOD_LIGHT, WOOD_DARK]}
        />
      </Path>

      {/* 3. PFP-color tint — wood "species" undertone per sender */}
      <Path path={bubblePath} color={tintBody} />

      {/* 4. Wavy grain lines */}
      <Path
        path={grainPath}
        color={GRAIN_COLOR}
        style="stroke"
        strokeWidth={0.9}
      />

      {/* 5. Recessed inner frame — chiseled border feel */}
      <Path
        path={bubblePath}
        color={FRAME_INNER}
        style="stroke"
        strokeWidth={0.8}
      />

      {/* 6. Polished outer edge — sender's PFP color */}
      <Path
        path={bubblePath}
        color={polishedEdge}
        style="stroke"
        strokeWidth={1.3}
      />
    </Canvas>
  );
});
