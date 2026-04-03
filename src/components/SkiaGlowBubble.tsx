/**
 * SkiaGlowBubble — GPU-rendered glassmorphic 3D bubble + diffused glow.
 *
 * Renders glow aura + glass body + depth. Tints all highlights with the
 * glow color so each Banana Shop package has its own look.
 * The RN View on top should be transparent (content only).
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
  /** Extra transparency for Frosted Ice style (0-1, lower = more transparent) */
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

  // Glass fill opacity — default 0.78, can be overridden per package
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
      {/* ── 1. Outer glow — wide diffused colored aura ── */}
      <RoundedRect x={x} y={y} width={width} height={height} r={radius} color={glowColor + "55"}>
        <BlurMask blur={22} style="normal" />
      </RoundedRect>
      <RoundedRect x={x} y={y} width={width} height={height} r={radius} color={glowColor + "30"}>
        <BlurMask blur={10} style="normal" />
      </RoundedRect>

      {/* ── 2. Glass body — tinted dark fill ── */}
      <RoundedRect x={x} y={y} width={width} height={height} r={radius} color={glassFill} />

      {/* ── 3. Clipped interior effects ── */}
      <Group clip={{ rect: { x, y, width, height }, rx: radius, ry: radius }}>

        {/* 3a. Diagonal gradient — glow-tinted light top-left → dark bottom-right */}
        <Rect x={x} y={y} width={width} height={height}>
          <LinearGradient
            start={vec(x, y)}
            end={vec(x + width, y + height)}
            colors={[glowColor + "16", "rgba(255,255,255,0.03)", "rgba(0,0,0,0.12)"]}
            positions={[0, 0.35, 1]}
          />
        </Rect>

        {/* 3b. Specular glare — soft curved highlight across top (no straight lines) */}
        <Rect x={x} y={y} width={width} height={height * 0.5}>
          <LinearGradient
            start={vec(x + width * 0.2, y)}
            end={vec(x + width * 0.6, y + height * 0.5)}
            colors={[glowColor + "20", glowColor + "0A", "transparent"]}
            positions={[0, 0.4, 1]}
          />
        </Rect>

        {/* 3c. Top rim glow — soft gradient along top edge (not a hard line) */}
        <Rect x={x} y={y} width={width} height={4}>
          <LinearGradient
            start={vec(x, y)}
            end={vec(x + width, y)}
            colors={["transparent", glowColor + "18", glowColor + "25", glowColor + "18", "transparent"]}
            positions={[0.05, 0.25, 0.5, 0.75, 0.95]}
          />
        </Rect>

        {/* 3d. Bottom inner shadow — dark depth for 3D thickness */}
        <Rect x={x} y={y + height * 0.55} width={width} height={height * 0.45}>
          <LinearGradient
            start={vec(x + width / 2, y + height * 0.55)}
            end={vec(x + width / 2, y + height)}
            colors={["transparent", "rgba(0,0,0,0.22)"]}
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
          colors={[glowColor + "28", glowColor + "10", "rgba(255,255,255,0.04)"]}
          positions={[0, 0.5, 1]}
        />
      </RoundedRect>
    </Canvas>
  );
});
