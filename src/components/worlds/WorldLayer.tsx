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

interface WorldLayerProps {
  active?: boolean;
}

export function WorldLayer({ active = true }: WorldLayerProps) {
  const worldId = useAppStore((s) => s.shopStyles?.worldId) as string | undefined;

  switch (worldId) {
    case "world_banana_grove":   return <BananaGroveWorld active={active} />;
    case "world_solana_cyberpunk": return <SolanaCyberpunkWorld active={active} />;
    case "world_trading_floor":  return <TradingFloorWorld active={active} />;
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
    return (
      <View style={[miniStyles.root, { width, height }]}>
        <Canvas style={{ width, height }}>
          <Rect x={0} y={0} width={width} height={height}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(0, height)}
              colors={["#0d2818", "#1a3d22", "#2d5a18", "#5e7a1a"]}
            />
          </Rect>
        </Canvas>
        {/* Static banana hints */}
        <Text style={[miniStyles.banana, { left: width * 0.2, top: height * 0.25, fontSize: 18 }]}>🍌</Text>
        <Text style={[miniStyles.banana, { left: width * 0.7, top: height * 0.55, fontSize: 22 }]}>🍌</Text>
        <Text style={[miniStyles.banana, { left: width * 0.45, top: height * 0.7, fontSize: 16 }]}>🍌</Text>
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
  return null;
}

const miniStyles = StyleSheet.create({
  root: { borderRadius: 12, overflow: "hidden", position: "relative" },
  banana: { position: "absolute", color: "#fff" },
});
