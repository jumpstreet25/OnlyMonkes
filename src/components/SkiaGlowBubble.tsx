/**
 * SkiaGlowBubble — GPU-rendered diffused glow ONLY (no glass body).
 *
 * Renders behind the RN View bubble. Uses Skia Box + BoxShadow for
 * real Gaussian blur colored glow on Android.
 */

import React from "react";
import { Canvas, Box, BoxShadow, rrect, rect } from "@shopify/react-native-skia";

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
  if (width <= 0 || height <= 0) return null;

  const pad = 35; // extra space for glow to extend into
  const cw = width + pad * 2;
  const ch = height + pad * 2;

  const bubbleRect = rrect(rect(pad, pad, width, height), radius, radius);

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
      {/* Invisible shape that casts the colored glow shadows */}
      <Box box={bubbleRect} color="transparent">
        {/* Wide diffused outer glow */}
        <BoxShadow dx={0} dy={0} blur={25} spread={6} color={glowColor + "50"} />
        {/* Tighter brighter core glow */}
        <BoxShadow dx={0} dy={0} blur={12} spread={2} color={glowColor + "40"} />
        {/* Tight edge glow */}
        <BoxShadow dx={0} dy={0} blur={4} spread={0} color={glowColor + "30"} />
      </Box>
    </Canvas>
  );
});
