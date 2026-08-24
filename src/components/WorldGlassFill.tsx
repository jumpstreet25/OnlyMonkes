/**
 * WorldGlassFill — absolute-fill MonkeGlass matching MainChat bubbles.
 *
 * Full stack (blur=true, default): BlurView → BUBBLE_GLASS_FILL → world wash
 * → gradient → top highlight. Use on static chrome (headers, profile card).
 *
 * Light stack (blur=false): same fills WITHOUT BlurView. Use on every tile
 * inside a ScrollView (menu grid, shop item cards) — dozens of live BlurViews
 * destroy scroll FPS on device; tint + wash still reads as monke glass over
 * the world plate.
 *
 * Parent must set overflow: "hidden" (and a borderRadius if rounded).
 */

import React from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { LiquidGlass as BlurView } from "@/components/LiquidGlass";
import { LinearGradient } from "expo-linear-gradient";
import {
  BUBBLE_GLASS_FILL,
  GLASS_GRADIENT_COLORS,
  HIGHLIGHT,
  getPanelBlurProps,
  getWorldGlassWash,
} from "@/lib/glassTheme";

interface WorldGlassFillProps {
  worldId?: string | null;
  /** Show the thin top glass highlight line (default true). */
  showHighlight?: boolean;
  /**
   * Real optical blur. Default true. Set false for scrollable lists —
   * keeps glass look without per-row BlurView cost.
   */
  blur?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function WorldGlassFill({
  worldId,
  showHighlight = true,
  blur = true,
  style,
}: WorldGlassFillProps) {
  const wash = getWorldGlassWash(worldId);

  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      {blur ? (
        <BlurView {...getPanelBlurProps()} style={StyleSheet.absoluteFill} />
      ) : null}
      <View
        style={[
          StyleSheet.absoluteFill,
          // Slightly stronger fill when no blur so text still pops over world art
          { backgroundColor: blur ? BUBBLE_GLASS_FILL : "rgba(12, 12, 22, 0.42)" },
        ]}
      />
      {wash ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: wash }]} />
      ) : null}
      <LinearGradient
        colors={GLASS_GRADIENT_COLORS}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {showHighlight ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 12,
            right: 12,
            height: 1.25,
            backgroundColor: HIGHLIGHT,
            borderRadius: 1,
          }}
        />
      ) : null}
    </View>
  );
}
