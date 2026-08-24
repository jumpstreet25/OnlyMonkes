/**
 * TradingFloorBubble — MonkeGlass speech bubble for Trading Floor world.
 *
 * Same real-blur construction as TechNoirBubble / rest of app.
 * Jade chrome for border / tail only (corner ticks removed 2026-08-07).
 */

import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { LiquidGlass as BlurView } from "@/components/LiquidGlass";
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

interface TradingFloorBubbleProps {
  width: number;
  height: number;
  color?: string;
  radius?: number;
  tailSide?: "left" | "right" | "none";
}

// Dirty jade — matches getWorldAccent('world_trading_floor')
const CHROME = "#2F8F6A";
const CHROME_SOFT = "rgba(47, 143, 106, 0.45)";
const TAIL_W = 10;
const TAIL_H = 8;
const WASH = getWorldGlassWash("world_trading_floor");

function buildTailPath(w: number, h: number, side: "left" | "right"): string {
  const midY = h / 2;
  if (side === "right") {
    const tx = w + TAIL_W;
    return `M${w} ${midY - TAIL_H / 2} L${tx} ${midY} L${w} ${midY + TAIL_H / 2} Z`;
  }
  const tx = -TAIL_W;
  return `M0 ${midY - TAIL_H / 2} L${tx} ${midY} L0 ${midY + TAIL_H / 2} Z`;
}

export function TradingFloorBubble({
  width: w,
  height: h,
  radius = 18,
  tailSide = "none",
}: TradingFloorBubbleProps) {
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
      {/* Glass body — BlurView samples jungle plate behind this bubble only */}
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
          borderColor: CHROME_SOFT,
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
            <Path path={tailPath} color="rgba(8, 16, 12, 0.45)" />
            <Path path={tailPath} color={CHROME} style="stroke" strokeWidth={1.2} />
          </Group>
        </Canvas>
      ) : null}
    </View>
  );
}
