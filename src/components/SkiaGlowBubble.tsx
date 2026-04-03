/**
 * SkiaGlowBubble — GPU-rendered glassmorphic 3D bubble + diffused glow.
 *
 * Renders glow aura + glass body + sun-spot glare + depth shadows.
 * All highlights tinted with glowColor for per-package theming.
 */

import React from "react";
import {
  Canvas,
  RoundedRect,
  BlurMask,
  LinearGradient,
  Group,
  Rect,
  Circle,
  vec,
} from "@shopify/react-native-skia";

interface SkiaGlowBubbleProps {
  glowColor: string;
  width: number;
  height: number;
  radius?: number;
  glassOpacity?: number;
}

export const SkiaGlowBubble = React.memo(function SkiaGlowBubble({
  glowColor,
  width,
  height,
  radius = 24,
  glassOpacity,
}: SkiaGlowBubbleProps) {
  if (width <= 0 || height <= 0) return null;

  const pad = 40;
  const cw = width + pad * 2;
  const ch = height + pad * 2;
  const x = pad;
  const y = pad;

  const fillAlpha = Math.round((glassOpacity ?? 0.78) * 255).toString(16).padStart(2, "0");
  const glassFill = `#0A0A16${fillAlpha}`;

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
      {/* ── 1. Outer glow aura ── */}
      <RoundedRect x={x} y={y} width={width} height={height} r={radius} color={glowColor + "55"}>
        <BlurMask blur={22} style="normal" />
      </RoundedRect>
      <RoundedRect x={x} y={y} width={width} height={height} r={radius} color={glowColor + "30"}>
        <BlurMask blur={10} style="normal" />
      </RoundedRect>

      {/* ── 2. Glass body ── */}
      <RoundedRect x={x} y={y} width={width} height={height} r={radius} color={glassFill} />

      {/* ── 3. Clipped interior ── */}
      <Group clip={{ rect: { x, y, width, height }, rx: radius, ry: radius }}>

        {/* 3a. Base tint gradient */}
        <Rect x={x} y={y} width={width} height={height}>
          <LinearGradient
            start={vec(x, y)}
            end={vec(x + width, y + height)}
            colors={[glowColor + "14", "rgba(255,255,255,0.02)", "rgba(0,0,0,0.10)"]}
            positions={[0, 0.35, 1]}
          />
        </Rect>

        {/* 3b. Sun-spot glare — blurred circle for organic highlight, not a rectangle */}
        <Circle
          cx={x + width * 0.35}
          cy={y + height * 0.25}
          r={Math.min(width, height) * 0.4}
          color={glowColor + "14"}
        >
          <BlurMask blur={Math.min(width, height) * 0.25} style="normal" />
        </Circle>

        {/* 3c. Brighter sun-spot core */}
        <Circle
          cx={x + width * 0.3}
          cy={y + height * 0.2}
          r={Math.min(width, height) * 0.2}
          color="rgba(255,255,255,0.06)"
        >
          <BlurMask blur={Math.min(width, height) * 0.15} style="normal" />
        </Circle>

        {/* 3d. Top rim glow — soft fade along top edge */}
        <Rect x={x} y={y} width={width} height={3}>
          <LinearGradient
            start={vec(x, y)}
            end={vec(x + width, y)}
            colors={["transparent", glowColor + "15", glowColor + "22", glowColor + "15", "transparent"]}
            positions={[0.05, 0.25, 0.5, 0.75, 0.95]}
          />
        </Rect>

        {/* 3e. Bottom depth shadow */}
        <Rect x={x} y={y + height * 0.55} width={width} height={height * 0.45}>
          <LinearGradient
            start={vec(x + width / 2, y + height * 0.55)}
            end={vec(x + width / 2, y + height)}
            colors={["transparent", "rgba(0,0,0,0.22)"]}
          />
        </Rect>
      </Group>

      {/* ── 4. Border stroke ── */}
      <RoundedRect
        x={x}
        y={y}
        width={width}
        height={height}
        r={radius}
        color="transparent"
        style="stroke"
        strokeWidth={0.75}
      >
        <LinearGradient
          start={vec(x, y)}
          end={vec(x + width, y + height)}
          colors={[glowColor + "28", glowColor + "10", "rgba(255,255,255,0.04)"]}
          positions={[0, 0.5, 1]}
        />
      </RoundedRect>
    </Canvas>
  );
});
