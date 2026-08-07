/**
 * WorldLayer — chooses + renders the user's equipped Chat World.
 *
 * Mounted as an absolute sibling behind FlashList in ChatScreen. Reads
 * `shopStyles.worldId` from appStore. Returns null when no world equipped
 * so the existing themeBg shows through.
 *
 * `active` pauses animations (waterfall, rain, falling bananas, etc.).
 * Callers pass false for Menu / Banana Shop / DMs so the plate stays static
 * under glass UI. Each world cancels its own clocks when active flips off.
 */

import React from "react";
import { View, Text, StyleSheet, Image as RNImage } from "react-native";
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
import { FrostGroveWorld } from "./FrostGroveWorld";

interface WorldLayerProps {
  active?: boolean;
}

export function WorldLayer({ active = true }: WorldLayerProps) {
  const worldId = useAppStore((s) => s.shopStyles?.worldId) as string | undefined;

  // Absolute fill wrapper so every world is pinned behind the full chat
  // surface (header + list + input) regardless of each world's root style.
  let body: React.ReactNode = null;
  switch (worldId) {
    case "world_banana_grove":     body = <BananaGroveWorld active={active} />; break;
    case "world_solana_cyberpunk": body = <SolanaCyberpunkWorld active={active} />; break;
    case "world_trading_floor":    body = <TradingFloorWorld active={active} />; break;
    case "world_tech_noir":        body = <TechNoirWorld active={active} />; break;
    case "world_deep_space":       body = <DeepSpaceWorld active={active} />; break;
    case "world_frost_grove":      body = <FrostGroveWorld active={active} />; break;
    default: return null;
  }
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {body}
    </View>
  );
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
              colors={["#3A2418", "#7A4A20", "#0D2818"]}
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
  if (worldId === "world_frost_grove") {
    // Mini-pile mirrors Banana Grove's preview structure: snowflakes pile at
    // the bottom, with a couple drifting in above. Scaled down for the card.
    const miniPile = [
      { xPct: 0.20, yOffset: 0,  size: 16, rot: -20 },
      { xPct: 0.42, yOffset: 2,  size: 18, rot: 12  },
      { xPct: 0.62, yOffset: 0,  size: 17, rot: -8  },
      { xPct: 0.82, yOffset: 4,  size: 15, rot: 22  },
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
              colors={["#0B1A2E", "#1C3A5C", "#0A1420"]}
            />
          </Rect>
        </Canvas>
        {/* Drifting snowflakes (static positions for preview) */}
        <Text style={[miniStyles.banana, { left: width * 0.30 - 9, top: height * 0.18, fontSize: 18, transform: [{ rotate: "-12deg" }], opacity: 0.85 }]}>❄️</Text>
        <Text style={[miniStyles.banana, { left: width * 0.70 - 8, top: height * 0.32, fontSize: 16, transform: [{ rotate: "18deg" }], opacity: 0.8 }]}>❄️</Text>
        {/* Pile at the bottom */}
        {miniPile.map((f, i) => (
          <Text
            key={i}
            style={[
              miniStyles.banana,
              {
                left: width * f.xPct - f.size / 2,
                bottom: 6 + f.yOffset,
                top: undefined,
                fontSize: f.size,
                opacity: 0.92,
                transform: [{ rotate: `${f.rot}deg` }],
              },
            ]}
          >
            ❄️
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
    // Shop mini-preview: same jungle candle plate as the live world.
    return (
      <View style={[miniStyles.root, { width, height, backgroundColor: "#0A120C" }]}>
        <RNImage
          source={require("../../../assets/trading-floor-jungle.jpg")}
          style={{ width, height }}
          resizeMode="cover"
        />
      </View>
    );
  }
  if (worldId === "world_tech_noir") {
    // Shop mini-preview uses the same street-level plate as the live world
    // (wet avenue, center Saga Monke billboard) so equip-preview matches reality.
    return (
      <View style={[miniStyles.root, { width, height, backgroundColor: "#010206" }]}>
        <RNImage
          source={require("../../../assets/tech-noir-street.jpg")}
          style={{ width, height }}
          resizeMode="cover"
        />
      </View>
    );
  }
  if (worldId === "world_deep_space") {
    // Shop mini-preview: same 3D monke-logo planet plate as the live world.
    return (
      <View style={[miniStyles.root, { width, height, backgroundColor: "#010108" }]}>
        <RNImage
          source={require("../../../assets/deep-space-plate.jpg")}
          style={{ width, height }}
          resizeMode="cover"
        />
      </View>
    );
  }
  return null;
}

const miniStyles = StyleSheet.create({
  root: { borderRadius: 12, overflow: "hidden", position: "relative" },
  banana: { position: "absolute", color: "#fff" },
});
