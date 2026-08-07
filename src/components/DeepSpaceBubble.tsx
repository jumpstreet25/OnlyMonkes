/**
 * DeepSpaceBubble — MonkeGlass speech bubble for Deep Space.
 *
 * Same real-blur construction as TechNoirBubble / TradingFloorBubble:
 * BlurView samples the deep-space plate, light fill + violet wash + chrome rim.
 * Accent matches getWorldAccent('world_deep_space') / Solana violet.
 */

import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import {
  Canvas,
  Path,
  Group,
} from "@shopify/react-native-skia";
import {
  BUBBLE_GLASS_FILL,
  GLASS_GRADIENT_COLORS,
  HIGHLIGHT,
  getPanelBlurProps,
  getWorldGlassWash,
} from "@/lib/glassTheme";

interface DeepSpaceBubbleProps {
  width: number;
  height: number;
  color: string; // unused — space chrome is fixed to world accent
  radius?: number;
  tailSide?: "left" | "right" | "none";
}

// Nebula violet — matches getWorldAccent('world_deep_space')
const CHROME = "#9B70FF";
const CHROME_EDGE = "rgba(125, 211, 252, 0.45)"; // Solana light-blue edge kiss
const TAIL_W = 10;
const TAIL_H = 8;
const WASH = getWorldGlassWash("world_deep_space");

function buildTailPath(w: number, h: number, side: "left" | "right"): string {
  const midY = h / 2;
  if (side === "right") {
    const tx = w + TAIL_W;
    return `M${w} ${midY - TAIL_H / 2} L${tx} ${midY} L${w} ${midY + TAIL_H / 2} Z`;
  }
  const tx = -TAIL_W;
  return `M0 ${midY - TAIL_H / 2} L${tx} ${midY} L0 ${midY + TAIL_H / 2} Z`;
}

export function DeepSpaceBubble({
  width: w,
  height: h,
  radius = 18,
  tailSide = "none",
}: DeepSpaceBubbleProps) {
  const tailPath = useMemo(
    () => (tailSide !== "none" ? buildTailPath(w, h, tailSide) : null),
    [w, h, tailSide],
  );

  const canvasW = tailSide === "right" || tailSide === "left" ? w + TAIL_W + 1 : w;
  const offsetX = tailSide === "left" ? TAIL_W : 0;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: tailSide === "left" ? -TAIL_W : 0,
        width: canvasW,
        height: h,
      }}
    >
      <View
        style={{
          position: "absolute",
          left: offsetX,
          top: 0,
          width: w,
          height: h,
          borderRadius: radius,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: "rgba(155, 112, 255, 0.50)",
        }}
      >
        <BlurView {...getPanelBlurProps()} style={StyleSheet.absoluteFill} />
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: BUBBLE_GLASS_FILL },
          ]}
        />
        {WASH ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: WASH }]} />
        ) : null}
        <LinearGradient
          colors={GLASS_GRADIENT_COLORS}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Top highlight — faint cyan kiss for Solana dual-tone */}
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 14,
            right: 14,
            height: 1.25,
            backgroundColor: HIGHLIGHT,
            borderRadius: 1,
          }}
        />
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: radius,
            borderWidth: 0.5,
            borderColor: CHROME_EDGE,
          }}
        />
      </View>

      {tailPath ? (
        <Canvas
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: canvasW,
            height: h,
          }}
        >
          <Group transform={[{ translateX: offsetX }]}>
            <Path path={tailPath} color="rgba(12, 12, 22, 0.45)" />
            <Path path={tailPath} color={CHROME} style="stroke" strokeWidth={1.2} />
          </Group>
        </Canvas>
      ) : null}
    </View>
  );
}
