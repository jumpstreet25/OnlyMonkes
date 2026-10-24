/**
 * Web stand-in for the per-world Skia bubble backgrounds (DeepSpaceBubble,
 * CyberpunkGlitchBubble, …): a rounded glass panel in the world's colour.
 * Each Skia bubble is its own WebGL canvas on the web, and a full Main Chat of
 * them froze the page (see SkiaGlowBubble.web.tsx). The phone keeps Skia.
 */
import React from "react";
import { View } from "react-native";

export type WebBubbleChromeProps = {
  width: number;
  height: number;
  color?: string;
  radius?: number;
  tailSide?: "left" | "right" | "none";
  [key: string]: unknown;
};

export function makeWebBubble(name: string, accent: string, fill = "rgba(8,8,20,0.82)") {
  const C = React.memo(function WebBubble({ width, height, color, radius = 18 }: WebBubbleChromeProps) {
    if (width <= 0 || height <= 0) return null;
    const c = color && /^#[0-9a-f]{6}$/i.test(color) ? color : accent;
    return (
      <View
        pointerEvents="none"
        style={{
          position: "absolute", top: 0, left: 0, width, height, borderRadius: radius,
          backgroundColor: fill, borderWidth: 1, borderColor: `${c}88`,
          boxShadow: `0 0 14px ${c}40`,
        } as any}
      />
    );
  });
  C.displayName = name;
  return C;
}
