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
  Group,
  LinearGradient,
  RadialGradient,
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

// Wood palettes + picker live in src/lib/woodPalettes.ts so both this
// component and BananaGroveCarvedText can use the same species mapping.
import { pickWoodPalette, hexToRgba } from "@/lib/woodPalettes";
import type { WoodPalette } from "@/lib/woodPalettes";

const FRAME_INNER = "rgba(15, 8, 4, 0.55)";
const TOP_EDGE_HIGHLIGHT = "rgba(255, 220, 170, 0.45)"; // light catching top of plank
// (v11 2026-05-08) Back-face thickness REMOVED. An offset duplicate
// silhouette literally IS the shape of a CSS box-shadow — there's no way
// to render it that doesn't read as one. Real thickness on a 2D surface
// comes from asymmetric edge bevels, not an offset shape behind the
// front face. The bevel strokes below replace the back face.

const PAD = 22;
const TAIL_LENGTH = 10;
const TAIL_HEIGHT = 16;
const PFP_TOTAL_HEIGHT = 42;
const PFP_GAP_ABOVE_TOP = 4;

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
  // Chip size — small triangular cut at each corner. Reduced in v11
  // from 5 → 2 px for sharper, chunkier wood-block edges per spec
  // ("thick sharp edges and a slightly chunky stylized shape").
  const c = Math.min(r * 0.2, 2);
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
  const lines = 16;
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

/**
 * Hairline cracks — 3 short jagged paths that hint at age + handcrafted
 * irregularity. Each crack is 3-4 short segments at varied angles, drawn
 * with very thin strokes at low alpha. Deterministic positions seeded by
 * sin/cos so the pattern is stable across renders.
 */
function buildCracks(x: number, y: number, w: number, h: number): string[] {
  if (w < 100 || h < 40) return [];
  const cracks: string[] = [];
  const positions = [
    { sx: 0.30, sy: 0.18, dir: 1 },
    { sx: 0.55, sy: 0.78, dir: -1 },
    { sx: 0.78, sy: 0.42, dir: 1 },
  ];
  positions.forEach((p, i) => {
    let curX = x + w * p.sx;
    let curY = y + h * p.sy;
    let path = `M ${curX} ${curY}`;
    const segments = 4;
    const baseLen = 6 + (Math.abs(Math.sin(i * 5.1)) % 1) * 8;
    for (let s = 0; s < segments; s++) {
      const dx = baseLen * (0.6 + (Math.abs(Math.sin(i * 3.7 + s * 1.7)) % 1) * 0.5) * p.dir;
      const dy = (Math.sin(i * 9.3 + s * 2.1) % 1) * 3.5;
      curX += dx;
      curY += dy;
      path += ` L ${curX} ${curY}`;
    }
    cracks.push(path);
  });
  return cracks;
}

// (v9 2026-05-08) Stain blob system removed entirely — the Phase 1
// full-bubble overlay read as floating colored orbs on top of the wood,
// not as in-groove resin. Per-glyph color resin requires the Phase 2
// Skia-text rendering refactor (parked, multi-day project).

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
  const cracks = useMemo(
    () => buildCracks(x, y, width, height),
    [x, y, width, height],
  );

  // Pick natural wood species from the sender's PFP color (lightness + hue).
  const palette = useMemo(() => pickWoodPalette(color), [color]);

  if (width <= 0 || height <= 0) return null;

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
      {/* (v7 2026-05-08) Cast shadow REMOVED — read as a heavy black halo
          behind the bubble; thickness already shows via the back-face
          peek-through. (v7) PFP-color tint REMOVED — was causing the
          bot's bubble to read as "brownish pink"; wood now stays natural. */}

      {/* (v11 2026-05-08) Back-face render REMOVED — no offset duplicate
          shape. Thickness now comes from asymmetric edge bevels (layers
          10–11 below) which create directional 3D edge lighting without
          the shape-behind-a-shape that read as a box-shadow. */}

      {/* 1. Wood gradient body (front face top) */}
      <Path path={bubblePath}>
        <LinearGradient
          start={vec(0, y)}
          end={vec(0, y + height)}
          colors={[palette.light, palette.mid]}
        />
      </Path>

      {/* 2. Wood grain — dark strokes use palette.deep, light highlights
            use palette.light. Both tones stay within the species' family
            so grain reads natural for that wood (subtle on light wood,
            visible on dark wood, never artificial). */}
      {grainStrokes.map((g, i) => (
        <Path
          key={`grain-${i}`}
          path={g.path}
          color={hexToRgba(g.isHighlight ? palette.light : palette.deep, g.alpha)}
          style="stroke"
          strokeWidth={g.width}
          strokeCap="round"
        />
      ))}

      {/* 4. Wood knots — concentric rings using palette.deep at varied
            alpha. Knots are inherently darker than the wood surface, so
            using palette.deep gives the right "carbonized" look across
            all species (stark on Maple, subtle on Wenge). */}
      {knots.map((k, i) => (
        <React.Fragment key={`knot-${i}`}>
          {/* Outer ring */}
          <Oval
            rect={rect(k.cx - k.rx, k.cy - k.ry, k.rx * 2, k.ry * 2)}
            color={hexToRgba(palette.deep, 0.65)}
            style="stroke"
            strokeWidth={1}
          />
          {/* Middle fill */}
          <Oval
            rect={rect(k.cx - k.rx * 0.7, k.cy - k.ry * 0.7, k.rx * 1.4, k.ry * 1.4)}
            color={hexToRgba(palette.deep, 0.85)}
          />
          {/* Inner darkest center */}
          <Oval
            rect={rect(k.cx - k.rx * 0.32, k.cy - k.ry * 0.32, k.rx * 0.64, k.ry * 0.64)}
            color={hexToRgba(palette.deep, 0.98)}
          />
        </React.Fragment>
      ))}

      {/* 5. Hairline cracks — short jagged paths across the surface.
            Hint at age + handcrafted feel without overwhelming the wood. */}
      {cracks.map((c, i) => (
        <Path
          key={`crack-${i}`}
          path={c}
          color={hexToRgba(palette.deep, 0.45)}
          style="stroke"
          strokeWidth={0.7}
          strokeCap="round"
        />
      ))}

      {/* ── Layered lighting (v10 2026-05-08) ─────────────────────────────
          The five layers below treat the bubble like a 3D-lit game UI
          surface, not a CSS gradient. Order matters — AO darkens first,
          specular highlight catches light over the AO, PFP ambient adds
          NFT-color light bounce, inner shadow recesses the perimeter. */}

      {/* 6. Ambient occlusion — dark radial in the bottom-right interior.
            Simulates the corner of the wood face being deeper in shadow.
            Clipped to the bubble path (so it doesn't bleed beyond edges). */}
      <Path path={bubblePath}>
        <RadialGradient
          c={vec(x + width * 0.78, y + height * 0.82)}
          r={Math.max(width, height) * 0.65}
          colors={["rgba(0, 0, 0, 0.42)", "rgba(0, 0, 0, 0)"]}
        />
      </Path>

      {/* 7. Specular highlight — bright cream radial at top-left.
            Simulates overhead light catching the wood face. Soft + low
            opacity so it reads as ambient light, not a hot spot. */}
      <Path path={bubblePath}>
        <RadialGradient
          c={vec(x + width * 0.22, y + height * 0.22)}
          r={Math.max(width, height) * 0.55}
          colors={["rgba(255, 240, 210, 0.30)", "rgba(255, 240, 210, 0)"]}
        />
      </Path>

      {/* 8. PFP-color ambient bounce — sender's color tints the upper-right
            of the wood very subtly, like NFT-colored light reflecting off
            an unseen surface. ~6% alpha — subliminal "normal-map illusion
            using NFT colors" per spec. NOT a stain blob. */}
      <Path path={bubblePath}>
        <RadialGradient
          c={vec(x + width * 0.65, y + height * 0.18)}
          r={Math.max(width, height) * 0.5}
          colors={[hexToRgba(color, 0.10), hexToRgba(color, 0)]}
        />
      </Path>

      {/* (v11 2026-05-08) Inner-shadow stroke removed — was contributing
          to the "framed by darkness" perception alongside the back-face. */}

      {/* 9. Recessed inner frame — chiseled border feel */}
      <Path
        path={bubblePath}
        color={FRAME_INNER}
        style="stroke"
        strokeWidth={0.8}
      />

      {/* (v6 2026-05-08) Polished colored outer edge REMOVED — user
          consistently flagged it as a "colored outline around the wood".
          The wood now stands without a chrome ring. */}

      {/* 10. Top-left bevel — bright cream stroke offset up-left by 1px.
            Creates the illusion that the upper-left edge of the wood face
            catches overhead light, suggesting a chamfered 3D edge.
            Asymmetric edge lighting is the actual technique game UIs use
            for thickness — no offset duplicate-shape needed. */}
      <Path
        path={bubblePath}
        color="rgba(255, 230, 175, 0.55)"
        style="stroke"
        strokeWidth={1.4}
        transform={[{ translateX: -0.8 }, { translateY: -0.8 }]}
      />

      {/* 11. Bottom-right bevel — dark stroke offset down-right by 1px.
            Pairs with the top-left highlight: bottom-right edge in deeper
            shadow. Together these two offset strokes make the bubble read
            as a 3D wood block lit from above-left. */}
      <Path
        path={bubblePath}
        color="rgba(10, 5, 2, 0.55)"
        style="stroke"
        strokeWidth={1.4}
        transform={[{ translateX: 1 }, { translateY: 1 }]}
      />

      {/* 12. Top-edge inner highlight — thin warm light stroke just inside
            the top edge. Light catching the upper face of the wood chunk. */}
      <Path
        path={`M ${x + 5} ${y + 1} L ${x + width - 5} ${y + 1}`}
        color={TOP_EDGE_HIGHLIGHT}
        style="stroke"
        strokeWidth={1.5}
        strokeCap="round"
      />

      {/* 13. Bottom-edge inner plank seam — thin dark stroke marking the
            bottom of the top face. Subtle 3D reinforcement. */}
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
