/**
 * TechNoirBubble — MonkeGlass speech bubble for Tech Noir.
 *
 * Same real-blur construction as the rest of the app (BlurView + light
 * fill + glass gradient): the wet city plate shows through as a soft
 * frosted field. Cyan chrome for border / tail outline only (corner ticks
 * removed 2026-08-07 — read as little triangles on every bubble).
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

interface TechNoirBubbleProps {
  width: number;
  height: number;
  color: string; // unused — noir chrome is fixed to world accent
  radius?: number;
  tailSide?: "left" | "right" | "none";
}

// Electric cyan — matches getWorldAccent('world_tech_noir') / TechNoirWorld
const CHROME = "#4FD8FF";
const TAIL_W = 10;
const TAIL_H = 8;
const WASH = getWorldGlassWash("world_tech_noir");

function buildTailPath(w: number, h: number, side: "left" | "right"): string {
  const midY = h / 2;
  if (side === "right") {
    const tx = w + TAIL_W;
    return `M${w} ${midY - TAIL_H / 2} L${tx} ${midY} L${w} ${midY + TAIL_H / 2} Z`;
  }
  const tx = -TAIL_W;
  return `M0 ${midY - TAIL_H / 2} L${tx} ${midY} L0 ${midY + TAIL_H / 2} Z`;
}

export function TechNoirBubble({
  width: w,
  height: h,
  radius = 18,
  tailSide = "none",
}: TechNoirBubbleProps) {
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
      {/* Glass body — BlurView samples the city plate behind the bubble */}
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
          borderColor: "rgba(79, 216, 255, 0.45)",
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

      {/* Tail outline only — no corner ticks */}
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
