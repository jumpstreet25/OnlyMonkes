/**
 * BananaGroveSignBubble — carved wooden sign aesthetic.
 * v2, 2026-05-08. Drop-in replacement for the dark glass surface when the
 * world bubble skin resolves to Banana Grove.
 *
 * v2 changes:
 *   - Wood grain rebuilt — 9 short bezier S-curves with varied alpha and
 *     stroke width, some not spanning full width, plus 3 knot ovals
 *     (darker spots). Reads as actual wood, not parallel stripes.
 *   - Sender-keyed halo — was a fixed amber regardless of sender, which
 *     made the bot (teal palette) wear an orange halo. Now derives from
 *     `color` so each user (and the bot) wears their own glow.
 *   - Drop shadow — subtle dark blur underneath the sign sells the
 *     "wooden plaque hanging in space" tactility.
 *
 * Layers (back → front):
 *   1. Drop shadow (offset down, blurred)
 *   2. Sender-keyed halo (warm version of PFP color, blurred)
 *   3. Brown wood gradient (light top → dark bottom)
 *   4. PFP-color tint underlay (low alpha — wood "species" identity)
 *   5. Wavy grain S-curves (varied alpha + width)
 *   6. Knot ovals (small darker spots)
 *   7. Recessed inner frame (very thin dark stroke)
 *   8. Polished outer edge (sender's PFP color, 1.3px stroke)
 *
 * Contract matches CyberpunkGlitchBubble for drop-in swap in MessageBubble.
 */
import React, { useMemo } from "react";
import {
  Canvas,
  Path,
  Oval,
  BlurMask,
  LinearGradient,
  vec,
  rect,
} from "@shopify/react-native-skia";

interface BananaGroveSignBubbleProps {
  width: number;
  height: number;
  /** Sender's PFP dominant color (drives the polished outer edge + halo). */
  color: string;
  radius?: number;
  tailSide?: "left" | "right" | "none";
}

const WOOD_LIGHT = "#5C3A1F";
const WOOD_DARK = "#2D1810";
const GRAIN_COLOR_BASE = "rgba(28, 18, 10, 1)"; // alpha applied per-stroke
const KNOT_COLOR = "rgba(15, 8, 3, 0.55)";
const FRAME_INNER = "rgba(15, 8, 4, 0.55)";
const SHADOW_COLOR = "rgba(0, 0, 0, 0.45)";

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

/**
 * Wood grain — 9 short bezier S-curves. Varied alpha + stroke width.
 * Not all lines span the full width (some fade in/out partway). The S-curve
 * comes from a CUBIC bezier with two control points on opposite sides,
 * giving real wood-like flow vs. the soft single-Q arc of v1.
 */
interface GrainStroke { path: string; alpha: number; width: number; }

function buildGrainStrokes(x: number, y: number, w: number, h: number): GrainStroke[] {
  const lines = 9;
  const strokes: GrainStroke[] = [];
  for (let i = 0; i < lines; i++) {
    // Y baseline with deterministic jitter so the pattern is stable
    const baseY = y + (h / (lines + 1)) * (i + 1);
    const jitterY = baseY + Math.sin(i * 7.3) * 1.6;

    // Some lines start partway in, end partway out — fade-in/out feel
    const startFrac = (Math.abs(Math.sin(i * 3.7)) % 1) * 0.18;
    const endFrac = 0.82 + (Math.abs(Math.cos(i * 1.9)) % 1) * 0.18;
    const startX = x + 6 + startFrac * w;
    const endX = x + endFrac * w - 6;
    if (endX <= startX + 12) continue;

    // Cubic S-curve — two control points on opposite sides of the baseline
    const span = endX - startX;
    const c1x = startX + span * 0.28;
    const c2x = startX + span * 0.72;
    const c1y = jitterY + Math.sin(i * 1.3 + 0.5) * 4.5;
    const c2y = jitterY + Math.cos(i * 2.1 + 0.7) * 3.6;

    const path = `M ${startX} ${jitterY} C ${c1x} ${c1y} ${c2x} ${c2y} ${endX} ${jitterY}`;
    const alpha = 0.15 + (Math.abs(Math.cos(i * 5.1)) % 1) * 0.18; // 0.15-0.33
    const width = 0.45 + (Math.abs(Math.sin(i * 4.3)) % 1) * 0.55; // 0.45-1.00
    strokes.push({ path, alpha, width });
  }
  return strokes;
}

interface Knot { cx: number; cy: number; rx: number; ry: number; }

function buildKnots(x: number, y: number, w: number, h: number): Knot[] {
  // 3 small darker oval knots at deterministic-but-irregular positions.
  // Larger inner radius gives an organic "wood eye" rather than a dot.
  if (w < 80 || h < 30) {
    // Tiny bubbles get fewer knots (avoid overcrowding)
    return [{ cx: x + w * 0.35, cy: y + h * 0.55, rx: 2.4, ry: 1.6 }];
  }
  return [
    { cx: x + w * 0.22, cy: y + h * 0.32, rx: 3.2, ry: 2.0 },
    { cx: x + w * 0.68, cy: y + h * 0.62, rx: 2.4, ry: 1.6 },
    { cx: x + w * 0.85, cy: y + h * 0.28, rx: 1.8, ry: 1.4 },
  ];
}

function rgbaWithAlpha(rgbaBase: string, alpha: number): string {
  // rgbaBase like "rgba(28, 18, 10, 1)" — replace last component
  return rgbaBase.replace(/, ?1\)$/, `, ${alpha})`);
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
  const grainStrokes = useMemo(
    () => buildGrainStrokes(x, y, width, height),
    [x, y, width, height],
  );
  const knots = useMemo(
    () => buildKnots(x, y, width, height),
    [x, y, width, height],
  );
  // Drop-shadow path — same shape, offset slightly down. Built as a
  // transformed path string by adjusting Y values directly so we can
  // blur it independently. Cheaper than another full Skia path build.
  const shadowPath = bubblePath; // same path; we'll transform via translateY at render

  if (width <= 0 || height <= 0) return null;

  const tintBody = hexToRgba(color, 0.18);
  const polishedEdge = hexToRgba(color, 0.85);
  // Sender-keyed halo — replaces the fixed amber that made bot bubbles
  // (teal palette) glow orange. Each sender's PFP color drives the halo
  // so the bubble glow matches the user's identity.
  const halo = hexToRgba(color, 0.32);

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
      {/* 1. Drop shadow — offset down, blurred. Sells the "plaque hanging
            in space" tactility without needing literal hanging vines. */}
      <Path path={shadowPath} color={SHADOW_COLOR} transform={[{ translateY: 6 }]}>
        <BlurMask blur={10} style="normal" />
      </Path>

      {/* 2. Sender-keyed halo */}
      <Path path={bubblePath} color={halo}>
        <BlurMask blur={16} style="normal" />
      </Path>

      {/* 3. Wood gradient body */}
      <Path path={bubblePath}>
        <LinearGradient
          start={vec(0, y)}
          end={vec(0, y + height)}
          colors={[WOOD_LIGHT, WOOD_DARK]}
        />
      </Path>

      {/* 4. PFP-color tint — wood "species" undertone per sender */}
      <Path path={bubblePath} color={tintBody} />

      {/* 5. Wood grain — varied S-curves */}
      {grainStrokes.map((g, i) => (
        <Path
          key={`grain-${i}`}
          path={g.path}
          color={rgbaWithAlpha(GRAIN_COLOR_BASE, g.alpha)}
          style="stroke"
          strokeWidth={g.width}
          strokeCap="round"
        />
      ))}

      {/* 6. Wood knots — small darker ovals */}
      {knots.map((k, i) => (
        <Oval
          key={`knot-${i}`}
          rect={rect(k.cx - k.rx, k.cy - k.ry, k.rx * 2, k.ry * 2)}
          color={KNOT_COLOR}
        />
      ))}

      {/* 7. Recessed inner frame — chiseled border feel */}
      <Path
        path={bubblePath}
        color={FRAME_INNER}
        style="stroke"
        strokeWidth={0.8}
      />

      {/* 8. Polished outer edge — sender's PFP color */}
      <Path
        path={bubblePath}
        color={polishedEdge}
        style="stroke"
        strokeWidth={1.3}
      />
    </Canvas>
  );
});
