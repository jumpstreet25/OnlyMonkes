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

// Warmer brown palette — more orange-brown saturation than v2's gray-brown.
const WOOD_LIGHT = "#7A4A26";
const WOOD_MID = "#5A3318";
const WOOD_DARK = "#3A2110";
const WOOD_DEEP = "#1F1206"; // deepest — used for the back face / wood "side"
const GRAIN_COLOR_BASE = "rgba(20, 10, 4, 1)";
const HIGHLIGHT_COLOR_BASE = "rgba(180, 130, 80, 1)";
const KNOT_RING_OUTER = "rgba(20, 10, 4, 0.65)";
const KNOT_RING_MID = "rgba(40, 22, 10, 0.85)";
const KNOT_CENTER = "rgba(10, 5, 2, 0.95)";
const FRAME_INNER = "rgba(15, 8, 4, 0.55)";
const TOP_EDGE_HIGHLIGHT = "rgba(255, 220, 170, 0.45)"; // light catching top of plank
// 3D thickness — back face offset (down + right) by this many pixels.
// Doubled in v6 (5 → 10) so the chunk's thickness is unmistakable; v5's 5px
// was getting lost against the world's dark gradient.
const THICKNESS_OFFSET_X = 10;
const THICKNESS_OFFSET_Y = 10;

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
 * Wood grain — 12 long bezier curves with varied amplitude, plus shorter
 * highlight curves (lighter brown) that sit just above darker grain to
 * sell 3D depth. Real wood reads as a layered surface, not flat lines.
 */
interface GrainStroke { path: string; alpha: number; width: number; isHighlight: boolean; }

function buildGrainStrokes(x: number, y: number, w: number, h: number): GrainStroke[] {
  const lines = 12;
  const strokes: GrainStroke[] = [];
  for (let i = 0; i < lines; i++) {
    const baseY = y + (h / (lines + 1)) * (i + 1);
    const jitterY = baseY + Math.sin(i * 7.3) * 2.0;

    // Some lines fade in/out partway — natural variation
    const startFrac = (Math.abs(Math.sin(i * 3.7)) % 1) * 0.22;
    const endFrac = 0.78 + (Math.abs(Math.cos(i * 1.9)) % 1) * 0.22;
    const startX = x + 5 + startFrac * w;
    const endX = x + endFrac * w - 5;
    if (endX <= startX + 14) continue;

    // Cubic S-curve with stronger amplitude for visible wood flow
    const span = endX - startX;
    const c1x = startX + span * 0.28;
    const c2x = startX + span * 0.72;
    const amp = 4 + (Math.abs(Math.sin(i * 1.7)) % 1) * 4; // 4-8px amplitude
    const c1y = jitterY + Math.sin(i * 1.3 + 0.5) * amp;
    const c2y = jitterY + Math.cos(i * 2.1 + 0.7) * amp * 0.7;

    const path = `M ${startX} ${jitterY} C ${c1x} ${c1y} ${c2x} ${c2y} ${endX} ${jitterY}`;
    // Higher alpha than v2 — wood grain should read clearly
    const alpha = 0.30 + (Math.abs(Math.cos(i * 5.1)) % 1) * 0.25; // 0.30-0.55
    const width = 0.55 + (Math.abs(Math.sin(i * 4.3)) % 1) * 0.85; // 0.55-1.40
    strokes.push({ path, alpha, width, isHighlight: false });

    // Add a HIGHLIGHT stroke on every 3rd line — lighter brown ~1.5px above
    // the dark line. Sells the 3D feel of a grain ridge catching light.
    if (i % 3 === 0 && i > 0) {
      const hPath = `M ${startX} ${jitterY - 1.6} C ${c1x} ${c1y - 1.6} ${c2x} ${c2y - 1.6} ${endX} ${jitterY - 1.6}`;
      strokes.push({
        path: hPath,
        alpha: 0.15 + (Math.abs(Math.cos(i * 2.7)) % 1) * 0.10,
        width: 0.5,
        isHighlight: true,
      });
    }
  }
  return strokes;
}

/**
 * Wood knots — concentric oval rings. Each knot has 3 layers: outer dark
 * ring (stroke), middle medium ring (fill), inner darkest center (fill).
 * Reads as a real wood knot vs. a single dot.
 */
interface Knot { cx: number; cy: number; rx: number; ry: number; }

function buildKnots(x: number, y: number, w: number, h: number): Knot[] {
  if (w < 80 || h < 30) {
    return [{ cx: x + w * 0.35, cy: y + h * 0.55, rx: 3.2, ry: 2.4 }];
  }
  return [
    { cx: x + w * 0.22, cy: y + h * 0.32, rx: 4.5, ry: 3.2 },
    { cx: x + w * 0.68, cy: y + h * 0.62, rx: 3.6, ry: 2.6 },
    { cx: x + w * 0.85, cy: y + h * 0.28, rx: 2.6, ry: 1.9 },
  ];
}

function rgbaWithAlpha(rgbaBase: string, alpha: number): string {
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
  if (width <= 0 || height <= 0) return null;

  const tintBody = hexToRgba(color, 0.14);

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
      {/* 1. Cast shadow — sharp directional shadow, NOT a centered halo.
            Tuned to read as the chunk's shadow on the chat below; v6 bumps
            the offset and alpha so it's clearly visible against the dusk
            world bg without bleeding into a halo. */}
      <Path
        path={bubblePath}
        color="rgba(0, 0, 0, 0.65)"
        transform={[{ translateX: 6 }, { translateY: 14 }]}
      >
        <BlurMask blur={4} style="normal" />
      </Path>

      {/* 2. Back face — visible thickness on the bottom-right edge. Same
            silhouette as the front face, offset down-right by ~5px. The
            visible band where this peeks out from behind the front face
            is the "side" of the 2-inch-thick wood chunk. */}
      <Path
        path={bubblePath}
        color={WOOD_DEEP}
        transform={[{ translateX: THICKNESS_OFFSET_X }, { translateY: THICKNESS_OFFSET_Y }]}
      />

      {/* 3. Wood gradient body — 3-stop warm brown (the plank's TOP face) */}
      <Path path={bubblePath}>
        <LinearGradient
          start={vec(0, y)}
          end={vec(0, y + height)}
          colors={[WOOD_LIGHT, WOOD_MID, WOOD_DARK]}
        />
      </Path>

      {/* 4. PFP-color tint — wood "species" undertone per sender. */}
      <Path path={bubblePath} color={tintBody} />

      {/* 5. Wood grain — dark cubic S-curves + lighter highlight strokes */}
      {grainStrokes.map((g, i) => (
        <Path
          key={`grain-${i}`}
          path={g.path}
          color={rgbaWithAlpha(g.isHighlight ? HIGHLIGHT_COLOR_BASE : GRAIN_COLOR_BASE, g.alpha)}
          style="stroke"
          strokeWidth={g.width}
          strokeCap="round"
        />
      ))}

      {/* 6. Wood knots — concentric rings (outer ring + middle fill + dark center) */}
      {knots.map((k, i) => (
        <React.Fragment key={`knot-${i}`}>
          {/* Outer dark ring */}
          <Oval
            rect={rect(k.cx - k.rx, k.cy - k.ry, k.rx * 2, k.ry * 2)}
            color={KNOT_RING_OUTER}
            style="stroke"
            strokeWidth={1}
          />
          {/* Middle medium-dark fill */}
          <Oval
            rect={rect(k.cx - k.rx * 0.7, k.cy - k.ry * 0.7, k.rx * 1.4, k.ry * 1.4)}
            color={KNOT_RING_MID}
          />
          {/* Inner darkest center */}
          <Oval
            rect={rect(k.cx - k.rx * 0.32, k.cy - k.ry * 0.32, k.rx * 0.64, k.ry * 0.64)}
            color={KNOT_CENTER}
          />
        </React.Fragment>
      ))}

      {/* 7. Recessed inner frame — chiseled border feel */}
      <Path
        path={bubblePath}
        color={FRAME_INNER}
        style="stroke"
        strokeWidth={0.8}
      />

      {/* (v6 2026-05-08) Polished colored outer edge REMOVED — user
          consistently flagged it as a "colored outline around the wood".
          The wood now stands without a chrome ring. */}

      {/* 8. Top-edge highlight — thin warm light stroke just inside the
            top edge. Reinforces the 3D thickness — light catching the top
            face of the wood chunk. */}
      <Path
        path={`M ${x + 5} ${y + 1} L ${x + width - 5} ${y + 1}`}
        color={TOP_EDGE_HIGHLIGHT}
        style="stroke"
        strokeWidth={1.5}
        strokeCap="round"
      />

      {/* 9. Bottom-edge plank seam — thin DARK stroke at the bottom of the
            wood top face. Marks where the top face meets the side face,
            making the thickness illusion read more clearly. */}
      <Path
        path={`M ${x + 5} ${y + height - 1} L ${x + width - 5} ${y + height - 1}`}
        color="rgba(0, 0, 0, 0.55)"
        style="stroke"
        strokeWidth={1}
        strokeCap="round"
      />
    </Canvas>
  );
});
