/**
 * SkiaGlowBubble — GPU-rendered diffused glow using BlurMaskFilter.
 *
 * Draws a colored rounded rect with a Gaussian blur mask applied,
 * creating a soft, wide, diffused glow that radiates outward.
 * This approach works reliably on Android (BoxShadow can clip).
 */

import React from "react";
import { Canvas, RoundedRect, BlurMask } from "@shopify/react-native-skia";

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

  const pad = 40; // glow extends 40px beyond bubble edges
  const cw = width + pad * 2;
  const ch = height + pad * 2;

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
      {/* Wide soft glow — blurred colored shape */}
      <RoundedRect
        x={pad}
        y={pad}
        width={width}
        height={height}
        r={radius}
        color={glowColor + "60"}
      >
        <BlurMask blur={20} style="normal" />
      </RoundedRect>

      {/* Brighter core glow — tighter blur */}
      <RoundedRect
        x={pad}
        y={pad}
        width={width}
        height={height}
        r={radius}
        color={glowColor + "35"}
      >
        <BlurMask blur={10} style="normal" />
      </RoundedRect>
    </Canvas>
  );
});
