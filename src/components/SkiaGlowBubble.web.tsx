/**
 * Web stand-in for SkiaGlowBubble.tsx: the same glow / glass / PFP-glow
 * layers drawn with plain styled Views (CSS box-shadow) instead of Skia.
 * On the web every Skia canvas makes its own WebGL context, draws, reads back
 * and releases it; with these on every Main Chat bubble (bot PFP glow, glow
 * bubble, glass front) the chat froze for 5–17 s per frame once it held ~60
 * messages (owner's ?perf=1 report, 2026-10-24). The phone keeps the Skia
 * versions.
 */
import React from "react";
import { View } from "react-native";

interface SkiaGlowBubbleProps {
  glowColor: string;
  width: number;
  height: number;
  radius?: number;
  glassOpacity?: number;
}

export const SkiaGlowBack = React.memo(function SkiaGlowBack({
  glowColor,
  width,
  height,
  radius = 24,
  glassOpacity,
}: SkiaGlowBubbleProps) {
  if (width <= 0 || height <= 0) return null;
  const fillAlpha = Math.round((glassOpacity ?? 0.82) * 255).toString(16).padStart(2, "0");
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute", top: 0, left: 0, width, height, borderRadius: radius,
        backgroundColor: `#080814${fillAlpha}`,
        boxShadow: `0 0 22px ${glowColor}55, 0 0 10px ${glowColor}30`,
      } as any}
    />
  );
});

export const SkiaGlassFront = React.memo(function SkiaGlassFront({
  width,
  height,
  radius = 24,
}: SkiaGlowBubbleProps) {
  if (width <= 0 || height <= 0) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute", top: 0, left: 0, width, height, borderRadius: radius,
        borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
        backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0) 45%)",
      } as any}
    />
  );
});

export const SkiaGlowBubble = SkiaGlowBack;

interface SkiaGlowPfpProps {
  glowColor: string;
  size: number;
}

export const SkiaGlowPfp = React.memo(function SkiaGlowPfp({ glowColor, size }: SkiaGlowPfpProps) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute", top: 0, left: 0, width: size, height: size, borderRadius: size / 2,
        boxShadow: `0 0 ${Math.round(size * 0.35)}px ${glowColor}40, 0 0 8px ${glowColor}55`,
      } as any}
    />
  );
});
