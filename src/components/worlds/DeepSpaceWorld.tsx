/**
 * DeepSpaceWorld — the infinite cosmos.
 *
 * Composition:
 *   - Near-black deep purple gradient backdrop.
 *   - 120 tiny static star dots at randomised positions.
 *   - 10 twinkling stars that pulse opacity on independent cycles.
 *   - 2 soft nebula clouds — Skia Rects with a blurred RadialGradient-like
 *     linear fill (purple, deep blue, magenta at very low alpha).
 *   - Shooting star: a thin angled streak that fires every 18-35s,
 *     with a bright head and fading trail.
 */

import React, { useEffect, useMemo } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import {
  Canvas,
  Rect,
  LinearGradient,
  RadialGradient,
  vec,
  Path,
  Group,
  BlurMask,
  Circle,
} from "@shopify/react-native-skia";
import Animated, {
  useSharedValue,
  useDerivedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  cancelAnimation,
  runOnJS,
  Easing,
} from "react-native-reanimated";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// ── Stars ───────────────────────────────────────────────────────────────────

interface StarData {
  x: number;
  y: number;
  r: number;  // radius
  a: number;  // base alpha
}

function genStars(count: number, seed: number): StarData[] {
  const stars: StarData[] = [];
  for (let i = 0; i < count; i++) {
    const h1 = ((seed * 1103515245 + i * 12345) & 0x7fffffff) / 0x7fffffff;
    const h2 = ((seed * 6764231 + i * 22695477) & 0x7fffffff) / 0x7fffffff;
    const h3 = ((seed * 214013 + i * 2531011) & 0x7fffffff) / 0x7fffffff;
    stars.push({
      x: h1 * SCREEN_W,
      y: h2 * SCREEN_H * 0.85, // stars only in upper 85% (city skyline equiv.)
      r: 0.5 + h3 * 1.2,
      a: 0.35 + h3 * 0.55,
    });
  }
  return stars;
}

// Static star field — renders as a single Skia canvas, no animation.
function StarField({ stars }: { stars: StarData[] }) {
  return (
    <>
      {stars.map((s, i) => (
        <Circle key={i} cx={s.x} cy={s.y} r={s.r} color={`rgba(220,230,255,${s.a})`} />
      ))}
    </>
  );
}

// Twinkling star — single shared value cycling 0→1→0 for opacity.
interface TwinkleProps {
  x: number;
  y: number;
  r: number;
  durationMs: number;
  phaseMs: number;
  active: boolean;
}

function TwinkleStar({ x, y, r, durationMs, phaseMs, active }: TwinkleProps) {
  const alpha = useSharedValue(0.2);

  useEffect(() => {
    if (!active) { cancelAnimation(alpha); alpha.value = 0.2; return; }
    alpha.value = withDelay(
      phaseMs,
      withRepeat(
        withSequence(
          withTiming(0.9, { duration: durationMs * 0.5, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.2, { duration: durationMs * 0.5, easing: Easing.inOut(Easing.sin) }),
        ),
        -1, false,
      ),
    );
    return () => cancelAnimation(alpha);
  }, [active, durationMs, phaseMs, alpha]);

  return <Circle cx={x} cy={y} r={r} color="#FFFFFF" opacity={alpha} />;
}

// ── Shooting star ───────────────────────────────────────────────────────────

function buildShotPath(sx: number, sy: number, len: number): string {
  const angle = 0.28; // radians ~16° diagonal
  const ex = sx + Math.cos(angle) * len;
  const ey = sy + Math.sin(angle) * len;
  return `M${sx} ${sy} L${ex} ${ey}`;
}

interface ShootingStarProps {
  active: boolean;
}

function ShootingStar({ active }: ShootingStarProps) {
  const alpha = useSharedValue(0);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const shotPath = useMemo(() => buildShotPath(0, 0, 140), []);

  useEffect(() => {
    if (!active) { cancelAnimation(alpha); cancelAnimation(translateX); cancelAnimation(translateY); return; }

    let alive = true;
    const fire = () => {
      if (!alive) return;
      const delay = 18_000 + Math.random() * 17_000;
      setTimeout(() => {
        if (!alive) return;
        // Start in upper-left quadrant, travel diagonally right-down
        const startX = Math.random() * SCREEN_W * 0.6;
        const startY = Math.random() * SCREEN_H * 0.35;
        const travelX = 80 + Math.random() * 120;
        const travelY = 30 + Math.random() * 50;
        const dur = 600 + Math.random() * 300;

        translateX.value = startX;
        translateY.value = startY;
        alpha.value = withSequence(
          withTiming(1, { duration: 60 }),
          withTiming(0, { duration: dur }),
        );
        translateX.value = withTiming(startX + travelX, { duration: dur + 60, easing: Easing.out(Easing.quad) });
        translateY.value = withTiming(startY + travelY, { duration: dur + 60, easing: Easing.out(Easing.quad) });
        setTimeout(fire, dur + 200);
      }, delay);
    };
    fire();
    return () => { alive = false; cancelAnimation(alpha); cancelAnimation(translateX); cancelAnimation(translateY); };
  }, [active, alpha, translateX, translateY]);

  const transform = useDerivedValue(
    () => [{ translateX: translateX.value }, { translateY: translateY.value }],
    [translateX, translateY],
  );

  return (
    <Group opacity={alpha} transform={transform}>
      {/* Head glow */}
      <Circle cx={0} cy={0} r={2.5} color="#FFFFFF">
        <BlurMask blur={5} style="normal" />
      </Circle>
      {/* Trail */}
      <Path path={shotPath} style="stroke" strokeWidth={1.5} color="#C8DEFF">
        <LinearGradient start={vec(0, 0)} end={vec(140, 40)} colors={["rgba(255,255,255,0.9)", "rgba(180,210,255,0)"]} />
      </Path>
    </Group>
  );
}

// ── World root ──────────────────────────────────────────────────────────────

interface DeepSpaceWorldProps {
  active?: boolean;
}

export function DeepSpaceWorld({ active = true }: DeepSpaceWorldProps) {
  const stars    = useMemo(() => genStars(120, 42), []);
  const twinkles = useMemo(() => [
    { x: SCREEN_W * 0.12, y: SCREEN_H * 0.08, r: 1.8, dur: 2800, phase: 0 },
    { x: SCREEN_W * 0.34, y: SCREEN_H * 0.14, r: 2.2, dur: 3600, phase: 900 },
    { x: SCREEN_W * 0.56, y: SCREEN_H * 0.06, r: 1.5, dur: 2200, phase: 400 },
    { x: SCREEN_W * 0.78, y: SCREEN_H * 0.20, r: 2.0, dur: 4100, phase: 1500 },
    { x: SCREEN_W * 0.88, y: SCREEN_H * 0.09, r: 1.6, dur: 3200, phase: 700 },
    { x: SCREEN_W * 0.22, y: SCREEN_H * 0.30, r: 2.4, dur: 5000, phase: 2000 },
    { x: SCREEN_W * 0.44, y: SCREEN_H * 0.25, r: 1.4, dur: 2600, phase: 300 },
    { x: SCREEN_W * 0.64, y: SCREEN_H * 0.32, r: 1.9, dur: 3800, phase: 1100 },
    { x: SCREEN_W * 0.06, y: SCREEN_H * 0.45, r: 1.7, dur: 4400, phase: 600 },
    { x: SCREEN_W * 0.92, y: SCREEN_H * 0.38, r: 2.1, dur: 3000, phase: 1800 },
  ], []);

  return (
    <View style={styles.root} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Deep space gradient — near-black with a subtle purple/indigo shift */}
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H * 1.25}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(SCREEN_W, SCREEN_H)}
            colors={["#010108", "#03020F", "#050218", "#080320"]}
          />
        </Rect>

        {/* Nebula cloud A — purple, upper-left */}
        <Rect x={-SCREEN_W * 0.2} y={SCREEN_H * 0.02} width={SCREEN_W * 0.7} height={SCREEN_H * 0.4}>
          <RadialGradient
            c={vec(SCREEN_W * 0.18, SCREEN_H * 0.15)}
            r={SCREEN_W * 0.38}
            colors={["rgba(100,40,180,0.08)", "rgba(60,20,120,0.04)", "rgba(0,0,0,0)"]}
          />
        </Rect>

        {/* Nebula cloud B — blue-magenta, right side */}
        <Rect x={SCREEN_W * 0.4} y={SCREEN_H * 0.1} width={SCREEN_W * 0.7} height={SCREEN_H * 0.5}>
          <RadialGradient
            c={vec(SCREEN_W * 0.72, SCREEN_H * 0.28)}
            r={SCREEN_W * 0.42}
            colors={["rgba(40,60,180,0.07)", "rgba(80,20,130,0.04)", "rgba(0,0,0,0)"]}
          />
        </Rect>

        {/* Static star field */}
        <StarField stars={stars} />

        {/* Twinkling stars */}
        {twinkles.map((t, i) => (
          <TwinkleStar key={i} x={t.x} y={t.y} r={t.r} durationMs={t.dur} phaseMs={t.phase} active={active} />
        ))}

        {/* Shooting star */}
        <ShootingStar active={active} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject },
});
