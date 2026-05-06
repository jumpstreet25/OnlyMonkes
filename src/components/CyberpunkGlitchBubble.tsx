/**
 * CyberpunkGlitchBubble — neon HUD chrome for chat bubbles when the
 * Solana Cyberpunk world is equipped. Skia overlay rendered in place of
 * the standard glass gradient.
 *
 * Layers (back → front):
 *   1. Soft outer glow halo (BlurMask, neon tint).
 *   2. Dark glass body (rgba 8,8,20,0.72).
 *   3. Faint horizontal scanlines across the interior.
 *   4. Hard 1.5px neon border (cyan for own, magenta for others).
 *   5. Four HUD-style L-shaped corner brackets just outside the bubble.
 *
 * Cyan = own messages, Magenta = others. Auto-applied by MessageBubble
 * when worldId === "world_solana_cyberpunk" and the user has not equipped
 * an explicit Bubble cosmetic — the user's own choices always win.
 */

import React from "react";
import {
  Canvas,
  RoundedRect,
  Path,
  BlurMask,
} from "@shopify/react-native-skia";

interface CyberpunkGlitchBubbleProps {
  width: number;
  height: number;
  variant: "cyan" | "magenta";
  radius?: number;
}

const PALETTE = {
  cyan: { neon: "#00D4FF", scanline: "rgba(0,212,255,0.07)" },
  magenta: { neon: "#FF3DFF", scanline: "rgba(255,61,255,0.07)" },
};

export const CyberpunkGlitchBubble = React.memo(function CyberpunkGlitchBubble({
  width,
  height,
  variant,
  radius = 18,
}: CyberpunkGlitchBubbleProps) {
  if (width <= 0 || height <= 0) return null;

  const pad = 18;
  const cw = width + pad * 2;
  const ch = height + pad * 2;
  const x = pad;
  const y = pad;
  const colors = PALETTE[variant];

  // Faint horizontal scanlines — 5 evenly spaced inside the bubble.
  const scanLineParts: string[] = [];
  const numLines = 5;
  for (let i = 1; i <= numLines; i++) {
    const ly = y + (height / (numLines + 1)) * i;
    scanLineParts.push(`M${x + 4} ${ly} L${x + width - 4} ${ly}`);
  }
  const scanPath = scanLineParts.join(" ");

  // HUD-style corner brackets — L-shape just outside each corner.
  const bracketLen = 9;
  const bracketGap = 3;
  const brackets: string[] = [];
  // Top-left: down to corner, then right
  brackets.push(
    `M${x - bracketGap} ${y + bracketLen} L${x - bracketGap} ${y - bracketGap} L${x + bracketLen} ${y - bracketGap}`,
  );
  // Top-right: left to corner, then down
  brackets.push(
    `M${x + width - bracketLen} ${y - bracketGap} L${x + width + bracketGap} ${y - bracketGap} L${x + width + bracketGap} ${y + bracketLen}`,
  );
  // Bottom-left: up to corner, then right
  brackets.push(
    `M${x - bracketGap} ${y + height - bracketLen} L${x - bracketGap} ${y + height + bracketGap} L${x + bracketLen} ${y + height + bracketGap}`,
  );
  // Bottom-right: left to corner, then up
  brackets.push(
    `M${x + width - bracketLen} ${y + height + bracketGap} L${x + width + bracketGap} ${y + height + bracketGap} L${x + width + bracketGap} ${y + height - bracketLen}`,
  );
  const bracketPath = brackets.join(" ");

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
      {/* Soft outer glow halo */}
      <RoundedRect
        x={x}
        y={y}
        width={width}
        height={height}
        r={radius}
        color={colors.neon + "40"}
      >
        <BlurMask blur={14} style="normal" />
      </RoundedRect>

      {/* Dark glass body */}
      <RoundedRect
        x={x}
        y={y}
        width={width}
        height={height}
        r={radius}
        color="rgba(8,8,20,0.72)"
      />

      {/* Faint scanlines */}
      <Path
        path={scanPath}
        color={colors.scanline}
        style="stroke"
        strokeWidth={1}
      />

      {/* Hard neon border */}
      <RoundedRect
        x={x}
        y={y}
        width={width}
        height={height}
        r={radius}
        color={colors.neon}
        style="stroke"
        strokeWidth={1.5}
        opacity={0.85}
      />

      {/* HUD corner brackets */}
      <Path
        path={bracketPath}
        color={colors.neon}
        style="stroke"
        strokeWidth={1.5}
      />
    </Canvas>
  );
});
