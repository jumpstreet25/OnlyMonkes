/**
 * SkiaGlowBubble — GPU-rendered glassmorphic 3D bubble + diffused glow.
 *
 * Uses Skia BlurMask for real Gaussian glow and LinearGradient for
 * glass depth, green-tinted specular highlights, and inner shadows.
 */

import React from "react";
import {
  Canvas,
  RoundedRect,
  BlurMask,
  LinearGradient,
  Group,
  Rect,
  vec,
} from "@shopify/react-native-skia";

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

  const pad = 40;
  const cw = width + pad * 2;
  const ch = height + pad * 2;
  const x = pad;
  const y = pad;

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
      {/* ── 1. Outer glow — wide diffused colored aura ── */}
      <RoundedRect x={x} y={y} width={width} height={height} r={radius} color={glowColor + "55"}>
        <BlurMask blur={22} style="normal" />
      </RoundedRect>
      <RoundedRect x={x} y={y} width={width} height={height} r={radius} color={glowColor + "30"}>
        <BlurMask blur={10} style="normal" />
      </RoundedRect>

      {/* ── 2. Glass body — semi-transparent dark fill ── */}
      <RoundedRect x={x} y={y} width={width} height={height} r={radius} color="rgba(10, 10, 22, 0.78)" />

      {/* ── 3. Clipped interior effects ── */}
      <Group clip={{ rect: { x, y, width, height }, rx: radius, ry: radius }}>

        {/* 3a. Base gradient — green-tinted light top-left → dark bottom-right */}
        <Rect x={x} y={y} width={width} height={height}>
          <LinearGradient
            start={vec(x, y)}
            end={vec(x + width, y + height)}
            colors={[glowColor + "18", "rgba(255,255,255,0.04)", "rgba(0,0,0,0.12)"]}
            positions={[0, 0.35, 1]}
          />
        </Rect>

        {/* 3b. Specular highlight — green-tinted glare across top half */}
        <Rect x={x} y={y} width={width} height={height * 0.45}>
          <LinearGradient
            start={vec(x + width * 0.3, y)}
            end={vec(x + width * 0.5, y + height * 0.45)}
            colors={[glowColor + "22", glowColor + "08", "transparent"]}
            positions={[0, 0.5, 1]}
          />
        </Rect>

        {/* 3c. Edge highlight — bright line along the top for glass rim */}
        <Rect x={x} y={y} width={width} height={3}>
          <LinearGradient
            start={vec(x, y)}
            end={vec(x + width, y)}
            colors={["transparent", glowColor + "20", glowColor + "30", glowColor + "20", "transparent"]}
            positions={[0, 0.2, 0.5, 0.8, 1]}
          />
        </Rect>

        {/* 3d. Bottom inner shadow — deep shadow for 3D thickness */}
        <Rect x={x} y={y + height * 0.55} width={width} height={height * 0.45}>
          <LinearGradient
            start={vec(x + width / 2, y + height * 0.55)}
            end={vec(x + width / 2, y + height)}
            colors={["transparent", "rgba(0,0,0,0.25)"]}
          />
        </Rect>

        {/* 3e. Left edge light — subtle side reflection for volume */}
        <Rect x={x} y={y} width={width * 0.15} height={height}>
          <LinearGradient
            start={vec(x, y + height * 0.3)}
            end={vec(x + width * 0.15, y + height * 0.3)}
            colors={[glowColor + "10", "transparent"]}
          />
        </Rect>
      </Group>

      {/* ── 4. Border stroke — green-tinted glass edge ── */}
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
