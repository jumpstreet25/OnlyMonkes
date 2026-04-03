/**
 * SkiaGlowBubble — GPU-rendered glassmorphic bubble with real Gaussian blur glow.
 *
 * Uses @shopify/react-native-skia Box + BoxShadow for pixel-perfect colored glow
 * that works identically on Android and iOS. Replaces the View-based approximation.
 *
 * Props:
 *   glowColor  — hex color for the outer glow (e.g., "#39ff14")
 *   width      — bubble width in pixels
 *   height     — bubble height in pixels
 *   radius     — border radius (default 24)
 */

import React from "react";
import { Canvas, Box, BoxShadow, rrect, rect, LinearGradient, vec } from "@shopify/react-native-skia";

interface SkiaGlowBubbleProps {
  glowColor: string;
  width: number;
  height: number;
  radius?: number;
}

export const SkiaGlowBubble = React.memo(function SkiaGlowBubble({
  glowColor,
  width,
  height,
  radius = 24,
}: SkiaGlowBubbleProps) {
  // Pad canvas for glow overflow
  const pad = 30;
  const cw = width + pad * 2;
  const ch = height + pad * 2;

  const bubbleRect = rrect(rect(pad, pad, width, height), radius, radius);

  return (
    <Canvas style={{ width: cw, height: ch, position: "absolute", top: -pad, left: -pad }} pointerEvents="none">
      {/* Outer glow — wide diffused colored shadow */}
      <Box box={bubbleRect} color="transparent">
        <BoxShadow dx={0} dy={0} blur={22} spread={4} color={glowColor + "55"} />
        <BoxShadow dx={0} dy={0} blur={12} spread={1} color={glowColor + "35"} />
      </Box>

      {/* Glass bubble body — dark semi-transparent with subtle border */}
      <Box box={bubbleRect} color="rgba(10, 10, 20, 0.92)">
        {/* Inner shadow — subtle depth at bottom */}
        <BoxShadow dx={0} dy={2} blur={6} spread={0} color="rgba(0,0,0,0.4)" inner />
        {/* Inner highlight — light hitting top edge */}
        <BoxShadow dx={0} dy={-1} blur={3} spread={0} color="rgba(255,255,255,0.08)" inner />
      </Box>

      {/* Glass gradient overlay — top-left light reflection */}
      <Box box={bubbleRect}>
        <LinearGradient
          start={vec(pad, pad)}
          end={vec(pad + width, pad + height)}
          colors={["rgba(255,255,255,0.10)", "rgba(255,255,255,0.02)", "transparent"]}
          positions={[0, 0.35, 1]}
        />
      </Box>

      {/* Faint glow-colored border stroke */}
      <Box
        box={bubbleRect}
        color="transparent"
        style="stroke"
        strokeWidth={1}
      >
        <LinearGradient
          start={vec(pad, pad)}
          end={vec(pad + width, pad + height)}
          colors={[glowColor + "30", glowColor + "10", "transparent"]}
          positions={[0, 0.5, 1]}
        />
      </Box>

      {/* Top-edge highlight line */}
      <Box
        box={rrect(rect(pad + 16, pad, width - 32, 1.5), 1, 1)}
        color={glowColor + "25"}
      />
    </Canvas>
  );
});
