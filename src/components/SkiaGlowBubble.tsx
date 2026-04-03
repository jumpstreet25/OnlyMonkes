/**
 * SkiaGlowBubble — GPU-rendered glassmorphic 3D bubble + diffused glow.
 *
 * Creates a sphere-like glass capsule with volume and depth:
 * - Bright specular sun-spot highlight (upper-left, like light hitting curved glass)
 * - Edge darkening (vignette) to simulate glass thickness at the perimeter
 * - Bright center (thinner glass = more light passes through)
 * - Deep bottom shadow for 3D grounding
 * - Bottom rim reflection (light bouncing off glow)
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

  const minDim = Math.min(width, height);

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

      {/* ── 3. 3D depth effects (clipped to bubble shape) ── */}
      <Group clip={{ rect: { x, y, width, height }, rx: radius, ry: radius }}>

        {/* 3a. Edge vignette — darken all edges for glass thickness/curvature */}
        {/* Top edge dark */}
        <Rect x={x} y={y} width={width} height={height * 0.2}>
          <LinearGradient
            start={vec(x + width / 2, y)}
            end={vec(x + width / 2, y + height * 0.2)}
            colors={["rgba(0,0,0,0.18)", "transparent"]}
          />
        </Rect>
        {/* Left edge dark */}
        <Rect x={x} y={y} width={width * 0.12} height={height}>
          <LinearGradient
            start={vec(x, y + height / 2)}
            end={vec(x + width * 0.12, y + height / 2)}
            colors={["rgba(0,0,0,0.15)", "transparent"]}
          />
        </Rect>
        {/* Right edge dark */}
        <Rect x={x + width * 0.88} y={y} width={width * 0.12} height={height}>
          <LinearGradient
            start={vec(x + width, y + height / 2)}
            end={vec(x + width * 0.88, y + height / 2)}
            colors={["rgba(0,0,0,0.15)", "transparent"]}
          />
        </Rect>
        {/* Bottom edge — deeper shadow for 3D grounding */}
        <Rect x={x} y={y + height * 0.5} width={width} height={height * 0.5}>
          <LinearGradient
            start={vec(x + width / 2, y + height * 0.5)}
            end={vec(x + width / 2, y + height)}
            colors={["transparent", "rgba(0,0,0,0.30)"]}
          />
        </Rect>

        {/* 3b. Center brightness — glass is thinner in the middle, more light passes */}
        <Circle
          cx={x + width * 0.5}
          cy={y + height * 0.45}
          r={minDim * 0.5}
          color="rgba(255,255,255,0.04)"
        >
          <BlurMask blur={minDim * 0.3} style="normal" />
        </Circle>

        {/* 3c. Primary sun-spot specular — bright glow-tinted highlight upper-left */}
        <Circle
          cx={x + width * 0.32}
          cy={y + height * 0.22}
          r={minDim * 0.35}
          color={glowColor + "18"}
        >
          <BlurMask blur={minDim * 0.22} style="normal" />
        </Circle>

        {/* 3d. Hot specular core — small bright white spot */}
        <Circle
          cx={x + width * 0.28}
          cy={y + height * 0.18}
          r={minDim * 0.12}
          color="rgba(255,255,255,0.10)"
        >
          <BlurMask blur={minDim * 0.1} style="normal" />
        </Circle>

        {/* 3e. Top rim highlight — light catching the upper glass edge */}
        <Rect x={x} y={y} width={width} height={2.5}>
          <LinearGradient
            start={vec(x, y)}
            end={vec(x + width, y)}
            colors={["transparent", glowColor + "18", glowColor + "28", glowColor + "18", "transparent"]}
            positions={[0.05, 0.2, 0.5, 0.8, 0.95]}
          />
        </Rect>

        {/* 3f. Bottom rim reflection — glow bouncing off surface below */}
        <Rect x={x} y={y + height - 3} width={width} height={3}>
          <LinearGradient
            start={vec(x, y + height)}
            end={vec(x + width, y + height)}
            colors={["transparent", glowColor + "0C", glowColor + "14", glowColor + "0C", "transparent"]}
            positions={[0.1, 0.3, 0.5, 0.7, 0.9]}
          />
        </Rect>
      </Group>

      {/* ── 4. Border stroke — glow-tinted glass edge ── */}
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
          colors={[glowColor + "30", glowColor + "12", "rgba(255,255,255,0.04)"]}
          positions={[0, 0.5, 1]}
        />
      </RoundedRect>
    </Canvas>
  );
});
