/**
 * CyberpunkGlitchBubble — broken-pixel chat bubble chrome for the Solana
 * Cyberpunk world. Inspired by retro glitch dialogue boxes: a clean rounded
 * frame whose edges fragment into displaced "broken pixels," with a
 * chromatic-aberration RGB ghost on the border. Color is keyed off the
 * SENDER's PFP dominant color so each user's bubbles wear their identity.
 *
 * Layers (back → front):
 *   1. Soft outer glow halo (accent color, blurred)
 *   2. Dark glass body (semi-transparent dark)
 *   3. Faint horizontal scanlines
 *   4. Magenta + cyan chromatic ghost borders (offset ±1.5px)
 *   5. Hard 1.5px accent border (PFP color)
 *   6. Broken-pixel chunks scattered along the perimeter (some pixels
 *      offset inward, some outward, mostly accent color with rare
 *      cyan/magenta "sparks" for chromatic feel)
 *   7. HUD-style corner brackets just outside the bubble
 *
 * Pixel positions are deterministic per (width × height × color) via
 * useMemo so they don't dance between re-renders. Per-bubble jitter still
 * gives each message its own glitch fingerprint.
 */

import React, { useMemo } from "react";
import {
  Canvas,
  RoundedRect,
  Rect,
  Path,
  BlurMask,
  Group,
} from "@shopify/react-native-skia";

interface CyberpunkGlitchBubbleProps {
  width: number;
  height: number;
  /** Accent color in #RRGGBB or rgba() form (sender's PFP dominant color). */
  color: string;
  radius?: number;
}

const GHOST_MAGENTA = "#FF3DFF";
const GHOST_CYAN = "#00D4FF";
const PIXEL_COUNT = 22;

interface BrokenPixel {
  x: number;
  y: number;
  size: number;
  color: string;
}

// Cheap LCG seeded by dimensions + color hash so the pattern is stable per
// bubble dimensions/color pair but varies between bubbles of different
// sizes/colors.
function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function colorHash(c: string): number {
  let h = 0;
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function buildBrokenPixels(
  width: number,
  height: number,
  pad: number,
  accent: string,
): BrokenPixel[] {
  const seed = Math.floor(width * 13 + height * 7 + colorHash(accent) * 3);
  const rand = seededRandom(seed || 1);
  const pixels: BrokenPixel[] = [];

  const x0 = pad;
  const y0 = pad;
  const x1 = pad + width;
  const y1 = pad + height;

  for (let i = 0; i < PIXEL_COUNT; i++) {
    const side = i % 4;             // distribute roughly evenly across 4 sides
    const t = rand();               // 0..1 along that side
    const offset = (rand() - 0.5) * 9; // -4.5..4.5 perpendicular offset
    const size = 3 + Math.floor(rand() * 4); // 3..6
    const sparkRoll = rand();
    const color =
      sparkRoll < 0.12 ? GHOST_CYAN :
      sparkRoll < 0.22 ? GHOST_MAGENTA :
      accent;

    let cx: number;
    let cy: number;
    if (side === 0) {
      // Top edge
      cx = x0 + t * width;
      cy = y0 + offset;
    } else if (side === 1) {
      // Right edge
      cx = x1 + offset;
      cy = y0 + t * height;
    } else if (side === 2) {
      // Bottom edge
      cx = x0 + t * width;
      cy = y1 + offset;
    } else {
      // Left edge
      cx = x0 + offset;
      cy = y0 + t * height;
    }
    pixels.push({ x: cx - size / 2, y: cy - size / 2, size, color });
  }
  return pixels;
}

export const CyberpunkGlitchBubble = React.memo(function CyberpunkGlitchBubble({
  width,
  height,
  color,
  radius = 18,
}: CyberpunkGlitchBubbleProps) {
  const pad = 18;
  const cw = width + pad * 2;
  const ch = height + pad * 2;
  const x = pad;
  const y = pad;

  const brokenPixels = useMemo(
    () => buildBrokenPixels(width, height, pad, color),
    [width, height, color],
  );

  // Scanlines — 5 evenly spaced thin horizontal lines inside the bubble.
  const scanPath = useMemo(() => {
    if (width <= 0 || height <= 0) return "";
    const parts: string[] = [];
    const numLines = 5;
    for (let i = 1; i <= numLines; i++) {
      const ly = y + (height / (numLines + 1)) * i;
      parts.push(`M${x + 4} ${ly} L${x + width - 4} ${ly}`);
    }
    return parts.join(" ");
  }, [width, height, x, y]);

  // HUD corner brackets — L-shape just outside each corner.
  const bracketPath = useMemo(() => {
    if (width <= 0 || height <= 0) return "";
    const len = 9;
    const gap = 3;
    const parts: string[] = [];
    parts.push(
      `M${x - gap} ${y + len} L${x - gap} ${y - gap} L${x + len} ${y - gap}`,
    );
    parts.push(
      `M${x + width - len} ${y - gap} L${x + width + gap} ${y - gap} L${x + width + gap} ${y + len}`,
    );
    parts.push(
      `M${x - gap} ${y + height - len} L${x - gap} ${y + height + gap} L${x + len} ${y + height + gap}`,
    );
    parts.push(
      `M${x + width - len} ${y + height + gap} L${x + width + gap} ${y + height + gap} L${x + width + gap} ${y + height - len}`,
    );
    return parts.join(" ");
  }, [width, height, x, y]);

  if (width <= 0 || height <= 0) return null;

  // Faint scanline tint derived from accent — mostly transparent.
  const scanlineColor = color + "12"; // ~7% alpha (12 hex)

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
      {/* 1. Soft outer glow halo */}
      <RoundedRect
        x={x}
        y={y}
        width={width}
        height={height}
        r={radius}
        color={color + "40"}
      >
        <BlurMask blur={14} style="normal" />
      </RoundedRect>

      {/* 2. Dark glass body */}
      <RoundedRect
        x={x}
        y={y}
        width={width}
        height={height}
        r={radius}
        color="rgba(8,8,20,0.72)"
      />

      {/* 3. Faint scanlines */}
      <Path
        path={scanPath}
        color={scanlineColor}
        style="stroke"
        strokeWidth={1}
      />

      {/* 4. RGB chromatic ghost borders — magenta offset left, cyan offset right */}
      <Group transform={[{ translateX: -1.5 }]}>
        <RoundedRect
          x={x}
          y={y}
          width={width}
          height={height}
          r={radius}
          color={GHOST_MAGENTA}
          style="stroke"
          strokeWidth={1.2}
          opacity={0.5}
        />
      </Group>
      <Group transform={[{ translateX: 1.5 }]}>
        <RoundedRect
          x={x}
          y={y}
          width={width}
          height={height}
          r={radius}
          color={GHOST_CYAN}
          style="stroke"
          strokeWidth={1.2}
          opacity={0.5}
        />
      </Group>

      {/* 5. Hard accent border (sender's PFP color) */}
      <RoundedRect
        x={x}
        y={y}
        width={width}
        height={height}
        r={radius}
        color={color}
        style="stroke"
        strokeWidth={1.5}
        opacity={0.95}
      />

      {/* 6. Broken-pixel chunks along the perimeter */}
      {brokenPixels.map((p, i) => (
        <Rect
          key={i}
          x={p.x}
          y={p.y}
          width={p.size}
          height={p.size}
          color={p.color}
        />
      ))}

      {/* 7. HUD corner brackets */}
      <Path
        path={bracketPath}
        color={color}
        style="stroke"
        strokeWidth={1.5}
      />
    </Canvas>
  );
});
