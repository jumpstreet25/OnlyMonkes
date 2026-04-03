/**
 * SkiaGlowBubble — Two-layer glassmorphic bubble:
 *
 * Layer 1 (behind text): Glow backlight + dark glass body
 * Layer 2 (on top of text): Glass dome/shell with specular highlight
 *
 * The glass shell sits ON TOP like a sphere placed over the message.
 * The glare lives on this front surface, not behind the text.
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

// ── Back layer: glow + dark glass body (renders BEHIND the text) ──
export const SkiaGlowBack = React.memo(function SkiaGlowBack({
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

  const fillAlpha = Math.round((glassOpacity ?? 0.82) * 255).toString(16).padStart(2, "0");
  const glassFill = `#080814${fillAlpha}`;

  return (
    <Canvas
      style={{ width: cw, height: ch, position: "absolute", top: -pad, left: -pad }}
      pointerEvents="none"
    >
      {/* Glow backlight */}
      <RoundedRect x={x} y={y} width={width} height={height} r={radius} color={glowColor + "55"}>
        <BlurMask blur={22} style="normal" />
      </RoundedRect>
      <RoundedRect x={x} y={y} width={width} height={height} r={radius} color={glowColor + "30"}>
        <BlurMask blur={10} style="normal" />
      </RoundedRect>

      {/* Dark glass body */}
      <RoundedRect x={x} y={y} width={width} height={height} r={radius} color={glassFill} />

      {/* Subtle interior depth */}
      <Group clip={{ rect: { x, y, width, height }, rx: radius, ry: radius }}>
        {/* Bottom shadow for grounding */}
        <Rect x={x} y={y + height * 0.5} width={width} height={height * 0.5}>
          <LinearGradient
            start={vec(x + width / 2, y + height * 0.5)}
            end={vec(x + width / 2, y + height)}
            colors={["transparent", "rgba(0,0,0,0.25)"]}
          />
        </Rect>
        {/* Faint glow tint on body */}
        <Rect x={x} y={y} width={width} height={height}>
          <LinearGradient
            start={vec(x, y)}
            end={vec(x + width, y + height)}
            colors={[glowColor + "0A", "transparent", "rgba(0,0,0,0.06)"]}
            positions={[0, 0.4, 1]}
          />
        </Rect>
      </Group>

      {/* Border */}
      <RoundedRect
        x={x} y={y} width={width} height={height} r={radius}
        color="transparent" style="stroke" strokeWidth={0.75}
      >
        <LinearGradient
          start={vec(x, y)}
          end={vec(x + width, y + height)}
          colors={[glowColor + "25", glowColor + "0C", "rgba(255,255,255,0.03)"]}
          positions={[0, 0.5, 1]}
        />
      </RoundedRect>
    </Canvas>
  );
});

// ── Front layer: glass dome/shell with specular glare (renders ON TOP of text) ──
export const SkiaGlassFront = React.memo(function SkiaGlassFront({
  glowColor,
  width,
  height,
  radius = 24,
}: SkiaGlowBubbleProps) {
  if (width <= 0 || height <= 0) return null;

  const pad = 5; // small pad — this layer doesn't need glow overflow
  const cw = width + pad * 2;
  const ch = height + pad * 2;
  const x = pad;
  const y = pad;
  const minDim = Math.min(width, height);

  return (
    <Canvas
      style={{ width: cw, height: ch, position: "absolute", top: -pad, left: -pad }}
      pointerEvents="none"
    >
      <Group clip={{ rect: { x, y, width, height }, rx: radius, ry: radius }}>

        {/* Glass dome — sphere-like curved highlight across top 40% */}
        <Rect x={x} y={y} width={width} height={height * 0.45}>
          <LinearGradient
            start={vec(x + width / 2, y)}
            end={vec(x + width / 2, y + height * 0.45)}
            colors={["rgba(255,255,255,0.16)", "rgba(255,255,255,0.04)", "transparent"]}
            positions={[0, 0.5, 1]}
          />
        </Rect>

        {/* Primary specular — glow-colored sun-spot on the glass surface */}
        <Circle
          cx={x + width * 0.35}
          cy={y + height * 0.18}
          r={minDim * 0.3}
          color={glowColor + "1A"}
        >
          <BlurMask blur={minDim * 0.18} style="normal" />
        </Circle>

        {/* Hot white core — bright point where light is strongest */}
        <Circle
          cx={x + width * 0.3}
          cy={y + height * 0.14}
          r={minDim * 0.08}
          color="rgba(255,255,255,0.18)"
        >
          <BlurMask blur={minDim * 0.06} style="normal" />
        </Circle>

        {/* Top rim — bright edge where light catches the glass dome rim */}
        <Rect x={x} y={y} width={width} height={2}>
          <LinearGradient
            start={vec(x, y)}
            end={vec(x + width, y)}
            colors={["transparent", glowColor + "20", "rgba(255,255,255,0.22)", glowColor + "20", "transparent"]}
            positions={[0.05, 0.2, 0.5, 0.8, 0.95]}
          />
        </Rect>

        {/* Edge darkening — vignette on left and right for curvature */}
        <Rect x={x} y={y} width={width * 0.08} height={height}>
          <LinearGradient
            start={vec(x, y + height / 2)}
            end={vec(x + width * 0.08, y + height / 2)}
            colors={["rgba(0,0,0,0.12)", "transparent"]}
          />
        </Rect>
        <Rect x={x + width * 0.92} y={y} width={width * 0.08} height={height}>
          <LinearGradient
            start={vec(x + width, y + height / 2)}
            end={vec(x + width * 0.92, y + height / 2)}
            colors={["rgba(0,0,0,0.12)", "transparent"]}
          />
        </Rect>

        {/* Bottom rim reflection — faint glow bounce */}
        <Rect x={x} y={y + height - 2} width={width} height={2}>
          <LinearGradient
            start={vec(x, y + height)}
            end={vec(x + width, y + height)}
            colors={["transparent", glowColor + "10", glowColor + "18", glowColor + "10", "transparent"]}
            positions={[0.1, 0.3, 0.5, 0.7, 0.9]}
          />
        </Rect>
      </Group>
    </Canvas>
  );
});

// Re-export combined for backward compat
export const SkiaGlowBubble = SkiaGlowBack;

// ── Circular PFP glow — Skia radial glow behind a profile picture ──────────
interface SkiaGlowPfpProps {
  glowColor: string;
  size: number; // diameter of the PFP image
}

export const SkiaGlowPfp = React.memo(function SkiaGlowPfp({
  glowColor,
  size,
}: SkiaGlowPfpProps) {
  const pad = Math.round(size * 0.55); // glow extends beyond PFP
  const cw = size + pad * 2;
  const cx = cw / 2;
  const cy = cw / 2;
  const r = size / 2;

  return (
    <Canvas
      style={{
        width: cw,
        height: cw,
        position: "absolute",
        top: -pad,
        left: -pad,
      }}
      pointerEvents="none"
    >
      {/* Outer diffused glow */}
      <Circle cx={cx} cy={cy} r={r + pad * 0.4} color={glowColor + "40"}>
        <BlurMask blur={pad * 0.6} style="normal" />
      </Circle>
      {/* Inner concentrated glow */}
      <Circle cx={cx} cy={cy} r={r + 2} color={glowColor + "55"}>
        <BlurMask blur={8} style="normal" />
      </Circle>
    </Canvas>
  );
});
