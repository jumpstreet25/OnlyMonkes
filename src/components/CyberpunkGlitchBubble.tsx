/**
 * CyberpunkGlitchBubble — clean PFP-color-tinted bubble chrome for the
 * Solana Cyberpunk world. Color is keyed off the SENDER's PFP dominant
 * color so each user's bubbles wear their identity.
 *
 * Layers (back → front):
 *   1. Soft outer glow halo (accent color, blurred)
 *   2. Dark glass body (semi-transparent dark — readable text base)
 *   3. Accent tint layer (PFP color at ~22% alpha — gives the bubble its
 *      visible identity color, like green for a green-PFP user)
 *   4. Faint horizontal scanlines (accent-tinted)
 *   5. RGB chromatic ghost borders (magenta offset −1.5px, cyan offset
 *      +1.5px) — classic CRT glitch artifact
 *   6. Hard 1.5px accent border (PFP color)
 *   7. HUD-style corner brackets just outside the bubble
 *
 * Earlier iteration scattered 22 broken-pixel chunks around the perimeter
 * — read as floating dots rather than a coherent broken-edge effect.
 * Removed 2026-05-06 in favor of the tinted-body approach which actually
 * communicates per-user color identity.
 */

import React, { useMemo } from "react";
import {
  Canvas,
  RoundedRect,
  Path,
  BlurMask,
  Group,
} from "@shopify/react-native-skia";

interface CyberpunkGlitchBubbleProps {
  width: number;
  height: number;
  /** Accent color in #RRGGBB form (sender's PFP dominant color). */
  color: string;
  radius?: number;
}

const GHOST_MAGENTA = "#FF3DFF";
const GHOST_CYAN = "#00D4FF";

// Convert "#RRGGBB" → rgba(r, g, b, alpha) string. Used to tint the body
// with the accent at low opacity. Returns the input unchanged if it's
// already an rgba()/hsl() string (defensive — Skia accepts those too).
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
      {/* 1. Soft outer glow halo */}
      <RoundedRect
        x={x}
        y={y}
        width={width}
        height={height}
        r={radius}
        color={hexToRgba(color, 0.32)}
      >
        <BlurMask blur={14} style="normal" />
      </RoundedRect>

      {/* 2. Dark glass base body — readable text contrast.
            Alpha 0.55 (was 0.72) so the world layer shows through more
            of the bubble. White text remains readable against the
            tint+world composite. */}
      <RoundedRect
        x={x}
        y={y}
        width={width}
        height={height}
        r={radius}
        color="rgba(8,8,20,0.55)"
      />

      {/* 3. Accent tint — gives the bubble its PFP-color identity */}
      <RoundedRect
        x={x}
        y={y}
        width={width}
        height={height}
        r={radius}
        color={tintBody}
      />

      {/* 4. Faint scanlines, accent-tinted */}
      <Path
        path={scanPath}
        color={scanlineColor}
        style="stroke"
        strokeWidth={1}
      />

      {/* 5. RGB chromatic ghost borders — magenta offset left, cyan offset right */}
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

      {/* 6. Hard accent border (sender's PFP color) */}
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
