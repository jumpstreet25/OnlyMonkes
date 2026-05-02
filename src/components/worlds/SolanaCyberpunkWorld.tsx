/**
 * SolanaCyberpunkWorld — purple→teal gradient with a slowly drifting neon grid.
 *
 * Gradient + grid lines are static Skia primitives. The grid translates
 * vertically via a Reanimated shared value (UI thread, no JS bridge).
 */

import React, { useEffect } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import {
  Canvas,
  Rect,
  LinearGradient,
  vec,
  Path,
  Group,
} from "@shopify/react-native-skia";
import Animated, {
  useSharedValue,
  useDerivedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

const GRID_SPACING = 38;
const DRIFT_DURATION_MS = 14_000;

function buildGridPath(): string {
  const parts: string[] = [];
  // Vertical lines
  for (let x = 0; x <= SCREEN_W; x += GRID_SPACING) {
    parts.push(`M${x} 0 L${x} ${SCREEN_H + GRID_SPACING}`);
  }
  // Horizontal lines (extra row beyond the bottom for drift)
  for (let y = 0; y <= SCREEN_H + GRID_SPACING; y += GRID_SPACING) {
    parts.push(`M0 ${y} L${SCREEN_W} ${y}`);
  }
  return parts.join(" ");
}

interface SolanaCyberpunkWorldProps {
  active?: boolean;
}

export function SolanaCyberpunkWorld({ active = true }: SolanaCyberpunkWorldProps) {
  const gridPath = React.useMemo(buildGridPath, []);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(progress);
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: DRIFT_DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [active, progress]);

  // Drift: the whole grid translates downward by GRID_SPACING px per cycle, then
  // the modulo loop makes it look infinite.
  const transform = useDerivedValue(
    () => [{ translateY: -GRID_SPACING + progress.value * GRID_SPACING }],
    [progress],
  );

  return (
    <View style={styles.root} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Gradient backdrop */}
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(SCREEN_W, SCREEN_H)}
            colors={["#1a0533", "#2a1561", "#0a4a5e", "#0f7a85"]}
          />
        </Rect>

        {/* Drifting grid */}
        {active ? (
          <Group transform={transform}>
            <Path
              path={gridPath}
              color="rgba(20,241,149,0.18)"
              style="stroke"
              strokeWidth={0.75}
            />
          </Group>
        ) : (
          <Path
            path={gridPath}
            color="rgba(20,241,149,0.18)"
            style="stroke"
            strokeWidth={0.75}
          />
        )}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject },
});
