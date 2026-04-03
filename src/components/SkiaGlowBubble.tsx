/**
 * SkiaGlowBubble — GPU-rendered glassmorphic 3D bubble + diffused glow.
 *
 * Uses Skia BlurMask for real Gaussian glow and LinearGradient for
 * glass depth, specular highlights, and inner shadows.
 * Renders the complete visual — RN View on top should be transparent.
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

      {/* ── 2. Glass body — dark base fill ── */}
      <RoundedRect x={x} y={y} width={width} height={height} r={radius} color="rgba(12, 12, 24, 0.92)" />

      {/* ── 3. Glass gradient — top-left light, bottom-right dark (3D depth) ── */}
      <Group clip={{ rect: { x, y, width, height }, rx: radius, ry: radius }}>
        <Rect x={x} y={y} width={width} height={height}>
          <LinearGradient
            start={vec(x, y)}
            end={vec(x + width, y + height)}
            colors={["rgba(255,255,255,0.12)", "rgba(255,255,255,0.03)", "rgba(0,0,0,0.08)"]}
            positions={[0, 0.4, 1]}
          />
        </Rect>

        {/* ── 4. Specular highlight — bright strip across top edge ── */}
        <Rect x={x + 12} y={y} width={width - 24} height={height * 0.4}>
          <LinearGradient
            start={vec(x + width / 2, y)}
            end={vec(x + width / 2, y + height * 0.4)}
            colors={["rgba(255,255,255,0.14)", "transparent"]}
          />
        </Rect>

        {/* ── 5. Bottom inner shadow — creates depth/thickness ── */}
        <Rect x={x} y={y + height * 0.6} width={width} height={height * 0.4}>
          <LinearGradient
            start={vec(x + width / 2, y + height * 0.6)}
            end={vec(x + width / 2, y + height)}
            colors={["transparent", "rgba(0,0,0,0.15)"]}
          />
        </Rect>
      </Group>

      {/* ── 6. Glow-tinted border stroke ── */}
      <RoundedRect
        x={x}
        y={y}
        width={width}
        height={height}
        r={radius}
        color="transparent"
        style="stroke"
        strokeWidth={1}
      >
        <LinearGradient
          start={vec(x, y)}
          end={vec(x + width, y + height)}
          colors={[glowColor + "35", glowColor + "15", "rgba(255,255,255,0.05)"]}
          positions={[0, 0.5, 1]}
        />
      </RoundedRect>

      {/* ── 7. Top highlight line — glass edge catching light ── */}
      <RoundedRect
        x={x + 16}
        y={y + 0.5}
        width={width - 32}
        height={1.5}
        r={1}
        color={glowColor + "30"}
      />
    </Canvas>
  );
});
