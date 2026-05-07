/**
 * CyberpunkGlitchBubble — pixelated speech bubble with stepped corners,
 * a tail/pointer, and an RGB chromatic-ghost border. Designed to mirror
 * retro 8-bit / glitch dialogue boxes (vecteezy-style reference).
 *
 * Shape construction:
 *   - Custom Skia Path. Each corner is a 3-step staircase — looks like a
 *     pixelated rounded corner instead of a smooth curve.
 *   - Optional tail/pointer at the bottom on the appropriate side
 *     ("left" for received messages, "right" for own, "none" for bot
 *     center-aligned bubbles).
 *
 * Layers (back → front):
 *   1. Soft outer glow halo — same Path, blurred, accent-tinted
 *   2. Dark glass body fill (semi-transparent dark for text contrast)
 *   3. Accent tint fill (PFP color at low alpha — gives the bubble its
 *      visible identity color)
 *   4. Faint horizontal scanlines (clipped to bubble interior)
 *   5. Magenta chromatic ghost border (Path stroke offset −1.5px)
 *   6. Cyan chromatic ghost border (Path stroke offset +1.5px)
 *   7. Hard 1.5px accent border on the main path
 *
 * Earlier iterations had a 22-chunk scatter of "broken pixels" along the
 * perimeter and a set of HUD corner brackets — both removed 2026-05-07
 * because they read as separate dots/decorations, not as a coherent
 * broken-edge bubble. The glitch character now lives in the SHAPE itself
 * (stepped staircase corners + chromatic ghost) which is what the
 * reference design actually communicates.
 */

import React, { useMemo } from "react";
import {
  Canvas,
  Path,
  BlurMask,
  Group,
} from "@shopify/react-native-skia";

interface CyberpunkGlitchBubbleProps {
  width: number;
  height: number;
  /** Accent color in #RRGGBB form (sender's PFP dominant color). */
  color: string;
  /** Corner staircase target depth (px). 3 steps fit in this budget. */
  radius?: number;
  /** Which side the tail/pointer extends from. "none" = no tail (bot). */
  tailSide?: "left" | "right" | "none";
}

const GHOST_MAGENTA = "#FF3DFF";
const GHOST_CYAN = "#00D4FF";
const STEPS_PER_CORNER = 3;
// Side-tail geometry — sits on the right (own) or left (others) edge,
// just above the bottom staircase, pointing horizontally toward the
// sender's PFP.
const TAIL_LENGTH = 11;          // how far the tip extends out from the edge
const TAIL_BASE_HEIGHT = 18;     // vertical height of the tail base on the edge
const TAIL_GAP_ABOVE_STAIRCASE = 6; // px between tail base bottom and BR/BL staircase start

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

/**
 * Build the bubble outline as a Skia Path string. Goes clockwise from
 * just past the top-left corner. Each corner is a 3-step staircase to
 * give it a pixelated 8-bit appearance. Optional tail at the bottom.
 */
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
  const s = r / STEPS_PER_CORNER;
  const parts: string[] = [];

  // Start just past TL corner on top edge
  parts.push(`M ${x + r} ${y}`);

  // Top edge → TR corner start
  parts.push(`L ${xR - r} ${y}`);

  // TR corner — DOWN, RIGHT alternating
  for (let i = 0; i < STEPS_PER_CORNER; i++) {
    parts.push(`L ${xR - r + i * s} ${y + (i + 1) * s}`);
    parts.push(`L ${xR - r + (i + 1) * s} ${y + (i + 1) * s}`);
  }

  // Right edge → BR corner start, optionally interrupted by the right
  // tail just above the BR staircase. Tail extends OUT (positive X)
  // toward the user's PFP.
  if (tailSide === "right") {
    const tailBaseBottom = yB - r - TAIL_GAP_ABOVE_STAIRCASE;
    const tailBaseTop = tailBaseBottom - TAIL_BASE_HEIGHT;
    const tailTipY = (tailBaseTop + tailBaseBottom) / 2;
    parts.push(`L ${xR} ${tailBaseTop}`);
    parts.push(`L ${xR + TAIL_LENGTH} ${tailTipY}`);
    parts.push(`L ${xR} ${tailBaseBottom}`);
    parts.push(`L ${xR} ${yB - r}`);
  } else {
    parts.push(`L ${xR} ${yB - r}`);
  }

  // BR corner — DOWN, LEFT alternating
  for (let i = 0; i < STEPS_PER_CORNER; i++) {
    parts.push(`L ${xR - i * s} ${yB - r + (i + 1) * s}`);
    parts.push(`L ${xR - (i + 1) * s} ${yB - r + (i + 1) * s}`);
  }

  // Bottom edge — clean (tail moved to side per design 2026-05-07)
  parts.push(`L ${x + r} ${yB}`);

  // BL corner — LEFT, UP alternating
  for (let i = 0; i < STEPS_PER_CORNER; i++) {
    parts.push(`L ${x + r - (i + 1) * s} ${yB - i * s}`);
    parts.push(`L ${x + r - (i + 1) * s} ${yB - (i + 1) * s}`);
  }

  // Left edge → TL corner start, optionally interrupted by the left
  // tail just above the BL staircase. Path is going UP (clockwise)
  // here, so we visit tailBaseBottom (lower-Y? higher screen?) ... wait —
  // going UP = Y decreasing. From (x, yB-r) we move toward (x, y+r).
  // tailBaseBottom is at yB-r-GAP (4px up); tailBaseTop is further up
  // (smaller Y). So in clockwise/UP order: tailBaseBottom first, tip,
  // tailBaseTop, then continue up.
  if (tailSide === "left") {
    const tailBaseBottom = yB - r - TAIL_GAP_ABOVE_STAIRCASE;
    const tailBaseTop = tailBaseBottom - TAIL_BASE_HEIGHT;
    const tailTipY = (tailBaseTop + tailBaseBottom) / 2;
    parts.push(`L ${x} ${tailBaseBottom}`);
    parts.push(`L ${x - TAIL_LENGTH} ${tailTipY}`);
    parts.push(`L ${x} ${tailBaseTop}`);
    parts.push(`L ${x} ${y + r}`);
  } else {
    parts.push(`L ${x} ${y + r}`);
  }

  // TL corner — UP, RIGHT alternating
  for (let i = 0; i < STEPS_PER_CORNER; i++) {
    parts.push(`L ${x + i * s} ${y + r - (i + 1) * s}`);
    parts.push(`L ${x + (i + 1) * s} ${y + r - (i + 1) * s}`);
  }

  parts.push("Z");
  return parts.join(" ");
}

export const CyberpunkGlitchBubble = React.memo(function CyberpunkGlitchBubble({
  width,
  height,
  color,
  radius = 14,
  tailSide = "none",
}: CyberpunkGlitchBubbleProps) {
  // Pad gives the canvas room for the glow halo + tail extending below.
  const pad = 22;
  const cw = width + pad * 2;
  const ch = height + pad * 2;
  const x = pad;
  const y = pad;

  const bubblePath = useMemo(
    () => buildBubblePath(x, y, width, height, radius, tailSide),
    [x, y, width, height, radius, tailSide],
  );

  // Faint scanlines drawn inside the bubble interior. Keep them simple —
  // 5 evenly spaced thin lines, accent-tinted at low alpha. They sit in
  // the rectangular interior; the path's tail/corner clipping isn't worth
  // the perf cost for such a subtle effect.
  const scanPath = useMemo(() => {
    if (width <= 0 || height <= 0) return "";
    const lines = 5;
    const parts: string[] = [];
    for (let i = 1; i <= lines; i++) {
      const ly = y + (height / (lines + 1)) * i;
      parts.push(`M ${x + 6} ${ly} L ${x + width - 6} ${ly}`);
    }
    return parts.join(" ");
  }, [x, y, width, height]);

  if (width <= 0 || height <= 0) return null;

  const tintBody = hexToRgba(color, 0.22);
  const scanlineColor = hexToRgba(color, 0.16);

  return (
    <Canvas
      style={{
        width: cw,
        height: ch,
        position: "absolute",
        top: -pad,
        left: -pad,
      }}
      pointerEvents="none"
    >
      {/* 1. Soft outer glow halo — same path, accent-tinted, blurred */}
      <Path path={bubblePath} color={hexToRgba(color, 0.32)}>
        <BlurMask blur={14} style="normal" />
      </Path>

      {/* 2. Dark glass body fill */}
      <Path path={bubblePath} color="rgba(8,8,20,0.55)" />

      {/* 3. Accent tint fill — gives the bubble its PFP-color identity */}
      <Path path={bubblePath} color={tintBody} />

      {/* 4. Faint scanlines */}
      <Path
        path={scanPath}
        color={scanlineColor}
        style="stroke"
        strokeWidth={1}
      />

      {/* 5. Magenta chromatic ghost border — offset −1.5px */}
      <Group transform={[{ translateX: -1.5 }]}>
        <Path
          path={bubblePath}
          color={GHOST_MAGENTA}
          style="stroke"
          strokeWidth={1.2}
          opacity={0.5}
        />
      </Group>

      {/* 6. Cyan chromatic ghost border — offset +1.5px */}
      <Group transform={[{ translateX: 1.5 }]}>
        <Path
          path={bubblePath}
          color={GHOST_CYAN}
          style="stroke"
          strokeWidth={1.2}
          opacity={0.5}
        />
      </Group>

      {/* 7. Hard accent border on the main path */}
      <Path
        path={bubblePath}
        color={color}
        style="stroke"
        strokeWidth={1.5}
        opacity={0.95}
      />
    </Canvas>
  );
});
