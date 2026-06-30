/**
 * WorldLayer — chooses + renders the user's equipped Chat World.
 *
 * Mounted as an absolute sibling behind FlashList in ChatScreen. Reads
 * `shopStyles.worldId` from appStore. Returns null when no world equipped
 * so the existing themeBg shows through.
 *
 * `active` is used to pause animations when the chat is not focused (drawer
 * open, app backgrounded). Each world handles its own clock cancellation.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import {
  Canvas,
  Rect,
  LinearGradient,
  vec,
  Path,
  Group,
  Line,
} from "@shopify/react-native-skia";
import { useAppStore } from "@/store/appStore";
import { BananaGroveWorld } from "./BananaGroveWorld";
import { SolanaCyberpunkWorld } from "./SolanaCyberpunkWorld";
import { TradingFloorWorld } from "./TradingFloorWorld";
import { TechNoirWorld } from "./TechNoirWorld";
import { DeepSpaceWorld } from "./DeepSpaceWorld";

interface WorldLayerProps {
  active?: boolean;
}

export function WorldLayer({ active = true }: WorldLayerProps) {
  const worldId = useAppStore((s) => s.shopStyles?.worldId) as string | undefined;

  switch (worldId) {
    case "world_banana_grove":     return <BananaGroveWorld active={active} />;
    case "world_solana_cyberpunk": return <SolanaCyberpunkWorld active={active} />;
    case "world_trading_floor":    return <TradingFloorWorld active={active} />;
    case "world_tech_noir":        return <TechNoirWorld active={active} />;
    case "world_deep_space":       return <DeepSpaceWorld active={active} />;
    default: return null;
  }
}

/**
 * Tiny static preview for the shop modal — a small Skia gradient + 1-2 hint
 * elements per world. No animation; this is rendered inside a 280×140 card.
 */
interface WorldMiniPreviewProps {
  worldId: string;
  width: number;
  height: number;
}

export function WorldMiniPreview({ worldId, width, height }: WorldMiniPreviewProps) {
  if (worldId === "world_banana_grove") {
    // Mini-pile mirrors the real world: bananas pile at the bottom, with a
    // couple drifting in above. Scaled down to fit the preview card.
    const miniPile = [
      // Bottom row
      { xPct: 0.20, yOffset: 0,  size: 16, rot: -20 },
      { xPct: 0.42, yOffset: 2,  size: 18, rot: 12  },
      { xPct: 0.62, yOffset: 0,  size: 17, rot: -8  },
      { xPct: 0.82, yOffset: 4,  size: 15, rot: 22  },
      // Middle / top
      { xPct: 0.32, yOffset: 11, size: 14, rot: 28  },
      { xPct: 0.52, yOffset: 14, size: 15, rot: -16 },
      { xPct: 0.72, yOffset: 10, size: 13, rot: 6   },
    ];
    return (
      <View style={[miniStyles.root, { width, height }]}>
        <Canvas style={{ width, height }}>
          <Rect x={0} y={0} width={width} height={height}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(0, height)}
              colors={["#0A0A0F", "#070708", "#000000"]}
            />
          </Rect>
        </Canvas>
        {/* Drifting bananas (static positions for preview) */}
        <Text style={[miniStyles.banana, { left: width * 0.30 - 9, top: height * 0.18, fontSize: 18, transform: [{ rotate: "-12deg" }], opacity: 0.85 }]}>🍌</Text>
        <Text style={[miniStyles.banana, { left: width * 0.70 - 8, top: height * 0.32, fontSize: 16, transform: [{ rotate: "18deg" }], opacity: 0.8 }]}>🍌</Text>
        {/* Pile at the bottom */}
        {miniPile.map((b, i) => (
          <Text
            key={i}
            style={[
              miniStyles.banana,
              {
                left: width * b.xPct - b.size / 2,
                bottom: 6 + b.yOffset,
                top: undefined,
                fontSize: b.size,
                opacity: 0.92,
                transform: [{ rotate: `${b.rot}deg` }],
              },
            ]}
          >
            🍌
          </Text>
        ))}
      </View>
    );
  }
  if (worldId === "world_solana_cyberpunk") {
    const path = (() => {
      const parts: string[] = [];
      const step = 22;
      for (let x = 0; x <= width; x += step) parts.push(`M${x} 0 L${x} ${height}`);
      for (let y = 0; y <= height; y += step) parts.push(`M0 ${y} L${width} ${y}`);
      return parts.join(" ");
    })();
    return (
      <View style={[miniStyles.root, { width, height }]}>
        <Canvas style={{ width, height }}>
          <Rect x={0} y={0} width={width} height={height}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(width, height)}
              colors={["#1a0533", "#2a1561", "#0a4a5e", "#0f7a85"]}
            />
          </Rect>
          <Path
            path={path}
            color="rgba(20,241,149,0.30)"
            style="stroke"
            strokeWidth={0.75}
          />
        </Canvas>
      </View>
    );
  }
  if (worldId === "world_trading_floor") {
    // 6 static candles for the preview
    const candleW = 10;
    const gap = 4;
    const candles = [
      { o: 0.4, c: 0.6 }, { o: 0.6, c: 0.45 }, { o: 0.45, c: 0.7 },
      { o: 0.7, c: 0.55 }, { o: 0.55, c: 0.78 }, { o: 0.78, c: 0.6 },
    ];
    const startX = width / 2 - (candles.length * (candleW + gap)) / 2;
    const yMid = height / 2;
    const range = height * 0.5;
    return (
      <View style={[miniStyles.root, { width, height }]}>
        <Canvas style={{ width, height }}>
          <Rect x={0} y={0} width={width} height={height}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(0, height)}
              colors={["#06070d", "#0a0d18", "#08101c"]}
            />
          </Rect>
          <Group opacity={0.55}>
            {candles.map((c, i) => {
              const isUp = c.c >= c.o;
              const color = isUp ? "#10B981" : "#EF4444";
              const x = startX + i * (candleW + gap);
              const top = yMid + (0.5 - Math.max(c.o, c.c)) * range;
              const bot = yMid + (0.5 - Math.min(c.o, c.c)) * range;
              return (
                <Group key={i}>
                  <Line
                    p1={vec(x + candleW / 2, top - 4)}
                    p2={vec(x + candleW / 2, bot + 4)}
                    color={color}
                    strokeWidth={1}
                  />
                  <Rect x={x} y={top} width={candleW} height={Math.max(1, bot - top)} color={color} />
                </Group>
              );
            })}
          </Group>
        </Canvas>
      </View>
    );
  }
  if (worldId === "world_tech_noir") {
    // Mini skyline silhouette + rain streaks over a noir gradient
    const buildings = [
      { xPct: 0.05, wPct: 0.08, hPct: 0.35 },
      { xPct: 0.13, wPct: 0.06, hPct: 0.50 },
      { xPct: 0.19, wPct: 0.09, hPct: 0.32 },
      { xPct: 0.28, wPct: 0.06, hPct: 0.44 },
      { xPct: 0.34, wPct: 0.04, hPct: 0.62 }, // tallest
      { xPct: 0.38, wPct: 0.08, hPct: 0.40 },
      { xPct: 0.46, wPct: 0.06, hPct: 0.28 },
      { xPct: 0.52, wPct: 0.09, hPct: 0.50 },
      { xPct: 0.61, wPct: 0.06, hPct: 0.36 },
      { xPct: 0.67, wPct: 0.08, hPct: 0.42 },
      { xPct: 0.75, wPct: 0.06, hPct: 0.30 },
      { xPct: 0.81, wPct: 0.09, hPct: 0.46 },
      { xPct: 0.90, wPct: 0.08, hPct: 0.33 },
    ];
    const skylineParts: string[] = [`M0 ${height}`];
    for (const b of buildings) {
      const bx = b.xPct * width;
      const bw = b.wPct * width;
      const top = height - b.hPct * height;
      skylineParts.push(`L${bx} ${height} L${bx} ${top} L${bx + bw} ${top} L${bx + bw} ${height}`);
    }
    skylineParts.push(`L${width} ${height} Z`);
    const skyline = skylineParts.join(" ");
    // Static rain streaks
    const rain: Array<{ x: number; y1: number; y2: number; a: number }> = [];
    const rainSeeds = [7, 23, 41, 67, 89, 113, 137, 157, 181, 211, 233, 257, 281, 307, 331];
    for (let i = 0; i < rainSeeds.length; i++) {
      const s = rainSeeds[i];
      const fx = ((s * 1103515245 + i * 12345) & 0x7fffffff) / 0x7fffffff;
      const fy = ((s * 6764231 + i * 22695477) & 0x7fffffff) / 0x7fffffff;
      const fa = ((s * 214013 + i * 2531011) & 0x7fffffff) / 0x7fffffff;
      rain.push({ x: fx * width, y1: fy * (height * 0.7), y2: fy * (height * 0.7) + 10 + fa * 8, a: 0.12 + fa * 0.2 });
    }
    return (
      <View style={[miniStyles.root, { width, height }]}>
        <Canvas style={{ width, height }}>
          <Rect x={0} y={0} width={width} height={height}>
            <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={["#010308", "#02060F", "#040C1C"]} />
          </Rect>
          {rain.map((r, i) => (
            <Line key={i} p1={vec(r.x, r.y1)} p2={vec(r.x, r.y2)} color={`rgba(160,192,220,${r.a})`} strokeWidth={0.8} />
          ))}
          <Path path={skyline} color="#000A14" />
          <Path path={skyline} color="#1A3A5C" style="stroke" strokeWidth={0.8} />
        </Canvas>
      </View>
    );
  }
  if (worldId === "world_deep_space") {
    // Star field + nebula glow over a near-black gradient
    const stars: Array<{ cx: number; cy: number; r: number; a: number }> = [];
    const starSeeds = [11,29,53,79,101,127,149,173,197,223,241,269,293,311,337,359,383,409,421,449];
    for (let i = 0; i < starSeeds.length; i++) {
      const s = starSeeds[i];
      const fx = ((s * 1103515245 + i * 12345) & 0x7fffffff) / 0x7fffffff;
      const fy = ((s * 6764231 + i * 22695477) & 0x7fffffff) / 0x7fffffff;
      const fa = ((s * 214013 + i * 2531011) & 0x7fffffff) / 0x7fffffff;
      stars.push({ cx: fx * width, cy: fy * height, r: 0.5 + fa * 1.1, a: 0.35 + fa * 0.5 });
    }
    return (
      <View style={[miniStyles.root, { width, height }]}>
        <Canvas style={{ width, height }}>
          <Rect x={0} y={0} width={width} height={height}>
            <LinearGradient start={vec(0, 0)} end={vec(width, height)} colors={["#010108", "#03020F", "#050218"]} />
          </Rect>
          {/* Nebula hint */}
          <Rect x={-width * 0.1} y={0} width={width * 0.7} height={height}>
            <LinearGradient start={vec(0, height * 0.2)} end={vec(width * 0.4, height * 0.6)}
              colors={["rgba(80,30,160,0.10)", "rgba(0,0,0,0)"]} />
          </Rect>
          {stars.map((s, i) => (
            <Rect key={i} x={s.cx} y={s.cy} width={s.r * 2} height={s.r * 2} color={`rgba(220,230,255,${s.a})`} />
          ))}
        </Canvas>
      </View>
    );
  }
  return null;
}

const miniStyles = StyleSheet.create({
  root: { borderRadius: 12, overflow: "hidden", position: "relative" },
  banana: { position: "absolute", color: "#fff" },
});
