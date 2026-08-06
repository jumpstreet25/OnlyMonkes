/**
 * TechNoirWorld — film noir meets cold tech.
 *
 * Composition:
 *   - Near-black deep navy gradient backdrop.
 *   - City skyline silhouette at the bottom (Skia path).
 *   - Three rain layers (fast/medium/slow) drifting downward — each is a
 *     full 2×SCREEN_H canvas of vertical streaks, looping via translateY
 *     so the rain is seamless with no visible reset.
 *   - Occasional searchlight sweep — a wide translucent cone that arcs
 *     slowly across the sky every 20-40s.
 */

import React, { useEffect, useMemo } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import {
  Canvas,
  Rect,
  LinearGradient,
  vec,
  Path,
  Line,
  Group,
  BlurMask,
} from "@shopify/react-native-skia";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// Rain timing
const RAIN_FAST_MS  = 1100;
const RAIN_MED_MS   = 2000;
const RAIN_SLOW_MS  = 3400;
const STREAK_LEN    = 20; // px

// City skyline buildings (% of screen width, % of screen height from bottom)
const BUILDINGS = [
  { x: 0.00, w: 0.06, h: 0.22 },
  { x: 0.05, w: 0.04, h: 0.28 },
  { x: 0.08, w: 0.07, h: 0.18 },
  { x: 0.14, w: 0.05, h: 0.35 },
  { x: 0.18, w: 0.04, h: 0.42 },  // tallest in left cluster
  { x: 0.21, w: 0.06, h: 0.30 },
  { x: 0.26, w: 0.04, h: 0.22 },
  { x: 0.30, w: 0.08, h: 0.25 },
  { x: 0.37, w: 0.04, h: 0.32 },
  { x: 0.40, w: 0.06, h: 0.20 },
  { x: 0.45, w: 0.05, h: 0.38 },  // center spire
  { x: 0.49, w: 0.03, h: 0.45 },  // antenna tower
  { x: 0.51, w: 0.06, h: 0.29 },
  { x: 0.56, w: 0.04, h: 0.18 },
  { x: 0.59, w: 0.07, h: 0.24 },
  { x: 0.65, w: 0.05, h: 0.36 },
  { x: 0.69, w: 0.04, h: 0.20 },
  { x: 0.72, w: 0.08, h: 0.28 },
  { x: 0.79, w: 0.04, h: 0.23 },
  { x: 0.82, w: 0.06, h: 0.30 },
  { x: 0.87, w: 0.05, h: 0.17 },
  { x: 0.91, w: 0.04, h: 0.26 },
  { x: 0.94, w: 0.06, h: 0.19 },
];

function buildSkylinePath(): string {
  const parts: string[] = [];
  const groundY = SCREEN_H;
  parts.push(`M0 ${groundY}`);
  for (const b of BUILDINGS) {
    const x = b.x * SCREEN_W;
    const w = b.w * SCREEN_W;
    const top = SCREEN_H - b.h * SCREEN_H;
    parts.push(`L${x} ${groundY} L${x} ${top} L${x + w} ${top} L${x + w} ${groundY}`);
  }
  parts.push(`L${SCREEN_W} ${groundY} Z`);
  return parts.join(" ");
}

// Build a seamlessly-looping rain canvas: 2×SCREEN_H tall, streaks scattered
// throughout so when we translate -SCREEN_H→0 on repeat it looks continuous.
function buildRainPath(count: number, seed: number): string {
  const parts: string[] = [];
  const totalH = SCREEN_H * 2;
  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random from seed + index
    const fx = ((seed * 1103515245 + i * 12345) & 0x7fffffff) / 0x7fffffff;
    const fy = ((seed * 6764231 + i * 22695477) & 0x7fffffff) / 0x7fffffff;
    const x = fx * SCREEN_W;
    const y = fy * totalH;
    parts.push(`M${x} ${y} L${x} ${y + STREAK_LEN}`);
  }
  return parts.join(" ");
}

interface RainLayerProps {
  cycleDuration: number;
  count: number;
  seed: number;
  strokeWidth: number;
  opacity: number;
  active: boolean;
}

function RainLayer({ cycleDuration, count, seed, strokeWidth, opacity, active }: RainLayerProps) {
  const path = useMemo(() => buildRainPath(count, seed), [count, seed]);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active) { cancelAnimation(progress); return; }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: cycleDuration, easing: Easing.linear }),
      -1, false,
    );
    return () => cancelAnimation(progress);
  }, [active, cycleDuration, progress]);

  // Translate the 2×SCREEN_H rain canvas from 0 → -SCREEN_H (downward visual effect)
  const transform = useDerivedValue(
    () => [{ translateY: progress.value * SCREEN_H }],
    [progress],
  );

  return (
    <Group transform={transform} opacity={opacity}>
      <Path path={path} color="#A8C0D8" style="stroke" strokeWidth={strokeWidth} />
    </Group>
  );
}

// Searchlight — a translucent cone that slowly sweeps across the sky
interface SearchlightProps {
  active: boolean;
}

function Searchlight({ active }: SearchlightProps) {
  const angle = useSharedValue(0.15); // fraction of screen width (0→1)
  const alpha  = useSharedValue(0);

  useEffect(() => {
    if (!active) { cancelAnimation(angle); cancelAnimation(alpha); return; }

    let alive = true;
    const schedule = () => {
      if (!alive) return;
      const delay = 20_000 + Math.random() * 20_000;
      setTimeout(() => {
        if (!alive) return;
        const startFrac = 0.05 + Math.random() * 0.3;
        angle.value = startFrac;
        // Fade in, sweep, fade out
        alpha.value = withSequence(
          withTiming(0.06, { duration: 600 }),
          withTiming(0.06, { duration: 3000 }),
          withTiming(0, { duration: 600 }),
        );
        angle.value = withTiming(startFrac + 0.4 + Math.random() * 0.3, { duration: 4200, easing: Easing.inOut(Easing.quad) });
        setTimeout(schedule, 5000);
      }, delay);
    };
    schedule();
    return () => { alive = false; cancelAnimation(angle); cancelAnimation(alpha); };
  }, [active, angle, alpha]);

  const coneTransform = useDerivedValue(
    () => [{
      translateX: angle.value * SCREEN_W - SCREEN_W * 0.08,
    }],
    [angle],
  );

  // Cone: a triangle originating from roughly top-center, spreading downward
  const coneW = SCREEN_W * 0.16;
  const conePath = `M0 0 L${-coneW / 2} ${SCREEN_H * 0.55} L${coneW / 2} ${SCREEN_H * 0.55} Z`;

  return (
    <Group opacity={alpha} transform={coneTransform}>
      <Path path={conePath} color="#C0D8F0">
        <BlurMask blur={30} style="normal" />
      </Path>
    </Group>
  );
}

interface TechNoirWorldProps {
  active?: boolean;
}

export function TechNoirWorld({ active = true }: TechNoirWorldProps) {
  const skylinePath = useMemo(buildSkylinePath, []);

  return (
    <View style={styles.root} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Noir gradient — deep black fading into cold navy at the horizon */}
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H * 1.25}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, SCREEN_H)}
            colors={["#010308", "#02060F", "#040C1C", "#0A1428"]}
          />
        </Rect>

        {/* Rain layers — slow/medium/fast for depth parallax */}
        <RainLayer active={active} cycleDuration={RAIN_SLOW_MS} count={22} seed={7} strokeWidth={0.6} opacity={0.14} />
        <RainLayer active={active} cycleDuration={RAIN_MED_MS}  count={28} seed={31} strokeWidth={0.8} opacity={0.22} />
        <RainLayer active={active} cycleDuration={RAIN_FAST_MS} count={18} seed={97} strokeWidth={1.0} opacity={0.32} />

        {/* Searchlight sweep */}
        <Searchlight active={active} />

        {/* City skyline — solid noir-black silhouette */}
        <Path path={skylinePath} color="#000A14" />
        {/* Skyline top edge glow — thin cold reflection on the roofline */}
        <Path
          path={skylinePath}
          color="#1A3A5C"
          style="stroke"
          strokeWidth={1.2}
        />

        {/* Ground reflection — puddle shimmer at the very bottom */}
        <Rect x={0} y={SCREEN_H - 18} width={SCREEN_W} height={18}>
          <LinearGradient
            start={vec(0, SCREEN_H - 18)}
            end={vec(0, SCREEN_H)}
            colors={["rgba(20,60,100,0.18)", "rgba(10,30,60,0.08)"]}
          />
        </Rect>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject },
});
