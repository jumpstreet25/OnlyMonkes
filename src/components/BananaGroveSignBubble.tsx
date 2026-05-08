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

// ── Natural wood palettes (v7 2026-05-08) ────────────────────────────────
// Each species defines its own 4-stop palette: light (top of vertical
// gradient), mid, dark (bottom), deep (back face — visible wood "side"
// in shadow). All 4 stops are real-wood color references; nothing is
// tinted with the sender's PFP color (that lives only in the polished
// edge in earlier versions, removed in v6).
//
// Picker uses HSL lightness + hue: lightness picks the BAND (very-dark →
// light), hue picks the species WITHIN the band (warm → cool → neutral).
interface WoodPalette {
  name: string;
  light: string;
  mid: string;
  dark: string;
  deep: string;
}

const WOOD_MAPLE: WoodPalette       = { name: "maple",       light: "#F0DBB0", mid: "#C9A87C", dark: "#997A52", deep: "#5C4828" };
const WOOD_BIRCH: WoodPalette       = { name: "birch",       light: "#ECD9B0", mid: "#C2A47A", dark: "#8C7548", deep: "#4F3D22" };
const WOOD_ASH: WoodPalette         = { name: "ash",         light: "#DCC9A8", mid: "#A89576", dark: "#756547", deep: "#423626" };
const WOOD_PINE: WoodPalette        = { name: "pine",        light: "#DEB887", mid: "#B8895A", dark: "#835E2E", deep: "#4F3815" };
const WOOD_CEDAR: WoodPalette       = { name: "cedar",       light: "#C99878", mid: "#9E6B4A", dark: "#704528", deep: "#432712" };
const WOOD_TEAK: WoodPalette        = { name: "teak",        light: "#B89970", mid: "#8B6F4A", dark: "#5F4A2C", deep: "#382B15" };
const WOOD_OAK: WoodPalette         = { name: "oak",         light: "#7A4A26", mid: "#5A3318", dark: "#3A2110", deep: "#1F1206" };
const WOOD_CHERRY: WoodPalette      = { name: "cherry",      light: "#A55B3D", mid: "#7B3F26", dark: "#5C2A15", deep: "#3A1808" };
const WOOD_MAHOGANY: WoodPalette    = { name: "mahogany",    light: "#6B3520", mid: "#4F2415", dark: "#38180A", deep: "#210D04" };
const WOOD_WALNUT: WoodPalette      = { name: "walnut",      light: "#5A3822", mid: "#3D2514", dark: "#28190B", deep: "#180E06" };
const WOOD_BLACK_MAPLE: WoodPalette = { name: "black_maple", light: "#3F3025", mid: "#2A1E15", dark: "#19110A", deep: "#0C0805" };
const WOOD_ROSEWOOD: WoodPalette    = { name: "rosewood",    light: "#5C2D2A", mid: "#3F1D1B", dark: "#2A1311", deep: "#170A09" };
const WOOD_WENGE: WoodPalette       = { name: "wenge",       light: "#382820", mid: "#221813", dark: "#14100A", deep: "#080606" };
const WOOD_EBONY: WoodPalette       = { name: "ebony",       light: "#261E18", mid: "#14100C", dark: "#080604", deep: "#030201" };

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

/** Convert hex to HSL — used to pick the wood species from the sender's PFP color. */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  if (!hex.startsWith("#") || hex.length !== 7) return { h: 0, s: 0, l: 0.5 };
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d) + (g < b ? 6 : 0);
    else if (max === g) h = ((b - r) / d) + 2;
    else h = ((r - g) / d) + 4;
    h /= 6;
  }
  return { h, s, l };
}

/**
 * Pick a natural wood species based on the sender's PFP color.
 * Lightness chooses the BAND (very-dark → dark → medium → light → very-light).
 * Hue/saturation refines WITHIN the band: warm hues get red-tinged species
 * (Cherry, Mahogany, Rosewood), cool hues get neutral-to-cool species
 * (Oak, Walnut, Wenge), low-saturation grays get neutral species (Teak,
 * Black Maple, Ebony). Yellow hues get warm-honey species (Pine, Maple).
 */
function pickWoodPalette(pfpColor: string): WoodPalette {
  const { h, s, l } = hexToHsl(pfpColor);

  // Low-sat grays → neutral species ladder by lightness
  if (s < 0.18) {
    if (l < 0.10) return WOOD_EBONY;
    if (l < 0.22) return WOOD_WENGE;
    if (l < 0.40) return WOOD_BLACK_MAPLE;
    if (l < 0.58) return WOOD_TEAK;
    if (l < 0.78) return WOOD_ASH;
    return WOOD_BIRCH;
  }

  // Hue groups (0..1 normalized):
  //   warm     = red / orange / pink-magenta → red-toned woods
  //   yellow   = yellow / gold              → honey-toned woods
  //   cool     = green / cyan / blue        → neutral-to-cool woods
  const isWarm   = h < 0.07 || h >= 0.85;
  const isYellow = h >= 0.07 && h < 0.18;
  const isCool   = h >= 0.18 && h < 0.85;

  // Very-dark band (l < 0.18)
  if (l < 0.18) {
    if (isWarm)   return WOOD_ROSEWOOD;
    if (isYellow) return WOOD_BLACK_MAPLE;
    if (isCool)   return WOOD_WENGE;
  }

  // Dark band (0.18-0.35)
  if (l < 0.35) {
    if (isWarm)   return WOOD_MAHOGANY;
    if (isYellow) return WOOD_BLACK_MAPLE;
    if (isCool)   return WOOD_WALNUT;
  }

  // Medium band (0.35-0.55)
  if (l < 0.55) {
    if (isWarm)   return WOOD_CHERRY;
    if (isYellow) return WOOD_TEAK;
    if (isCool)   return WOOD_OAK;
  }

  // Medium-light band (0.55-0.72)
  if (l < 0.72) {
    if (isWarm)   return WOOD_CEDAR;
    if (isYellow) return WOOD_PINE;
    if (isCool)   return WOOD_TEAK;
  }

  // Light band (>= 0.72)
  if (isWarm)   return WOOD_BIRCH;
  if (isYellow) return WOOD_MAPLE;
  if (isCool)   return WOOD_ASH;
  return WOOD_OAK; // shouldn't reach here, but safe fallback
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
  // Pick natural wood species from the sender's PFP color (lightness + hue).
  // Bot's hot pink → warm/dark band → Mahogany. Bright golden NFT → Pine.
  // Pale white NFT → Maple. Dark green → Walnut. Etc.
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

      {/* 1. Back face — visible thickness on the bottom-right edge. Same
            silhouette as the front face, offset down-right by 10px. The
            visible band where this peeks out is the wood "side" — the
            entire reason the bubble reads as a 2-inch-thick chunk. Color
            is the species' deepest stop (in-shadow side). */}
      <Path
        path={bubblePath}
        color={palette.deep}
        transform={[{ translateX: THICKNESS_OFFSET_X }, { translateY: THICKNESS_OFFSET_Y }]}
      />

      {/* 2. Wood gradient body — species' light → mid → dark */}
      <Path path={bubblePath}>
        <LinearGradient
          start={vec(0, y)}
          end={vec(0, y + height)}
          colors={[palette.light, palette.mid, palette.dark]}
        />
      </Path>

      {/* 3. Wood grain — dark strokes use palette.deep, light highlights
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

      {/* 5. Recessed inner frame — chiseled border feel */}
      <Path
        path={bubblePath}
        color={FRAME_INNER}
        style="stroke"
        strokeWidth={0.8}
      />

      {/* (v6 2026-05-08) Polished colored outer edge REMOVED — user
          consistently flagged it as a "colored outline around the wood".
          The wood now stands without a chrome ring. */}

      {/* 6. Top-edge highlight — thin warm light stroke just inside the
            top edge. Reinforces the 3D thickness — light catching the top
            face of the wood chunk. */}
      <Path
        path={`M ${x + 5} ${y + 1} L ${x + width - 5} ${y + 1}`}
        color={TOP_EDGE_HIGHLIGHT}
        style="stroke"
        strokeWidth={1.5}
        strokeCap="round"
      />

      {/* 7. Bottom-edge plank seam — thin DARK stroke at the bottom of the
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
