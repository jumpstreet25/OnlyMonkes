/**
 * BananaGroveWorld — dark gradient with banana emojis drifting downward into
 * a static pile at the bottom of the screen.
 *
 * Skia Canvas paints the gradient. Banana particles use Reanimated shared
 * values driven by a single `withRepeat` clock so animation runs on the UI
 * thread (no JS-thread RAF, no setState per frame). Each particle reads the
 * same clock with a phase offset.
 *
 * Falling bananas fade out as they approach the static pile (between t=0.75
 * and t=0.85), creating the illusion of "landing" on the pile without the
 * pile actually growing. Pile sits ~110px above the world's bottom edge so
 * it clears the chat input bar that renders on top of this layer.
 *
 * When `active=false` the clock animation cancels — only the gradient + pile
 * remain.
 */

import React, { useEffect, useMemo } from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import { Canvas, Rect, LinearGradient, vec } from "@shopify/react-native-skia";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
  interpolate,
} from "react-native-reanimated";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

const PARTICLE_COUNT = 10;
const FALL_DURATION_MS = 9_000;

interface Particle {
  lane: number;       // 0..1 — horizontal lane (with slight jitter)
  phase: number;      // 0..1 phase offset
  size: number;       // px
  swayAmp: number;    // horizontal sway amplitude
}

function buildParticles(): Particle[] {
  const arr: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    arr.push({
      lane: (i + 0.5) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.06,
      phase: Math.random(),
      size: 22 + Math.random() * 14,
      swayAmp: 10 + Math.random() * 14,
    });
  }
  return arr;
}

// ─── Static banana pile at the bottom of the screen ─────────────────────────
// Sits above the chat input bar (clears ~110px from world bottom for input +
// safe area). Three layers: bottom row largest/brightest (foreground), middle
// row partially behind, top row smallest (tip of pile). Bananas never grow or
// move — falling particles fade out before reaching pile-top to give the
// illusion of "landing" on it.

const PILE_BOTTOM = 110;

interface PileBanana {
  xPct: number;     // 0..1 — horizontal center as fraction of screen width
  yOffset: number;  // px upward from pile base
  size: number;     // font size
  rot: number;      // rotation degrees
  opacity: number;
}

const PILE_BANANAS: PileBanana[] = [
  // Bottom row — foreground, brightest, largest
  { xPct: 0.15, yOffset: 0,  size: 32, rot: -22, opacity: 0.95 },
  { xPct: 0.36, yOffset: 4,  size: 36, rot: 14,  opacity: 0.95 },
  { xPct: 0.56, yOffset: 0,  size: 34, rot: -10, opacity: 0.95 },
  { xPct: 0.78, yOffset: 6,  size: 30, rot: 24,  opacity: 0.92 },
  // Middle row — partially behind bottom
  { xPct: 0.25, yOffset: 18, size: 28, rot: 30,  opacity: 0.85 },
  { xPct: 0.46, yOffset: 22, size: 30, rot: -18, opacity: 0.85 },
  { xPct: 0.66, yOffset: 16, size: 26, rot: 6,   opacity: 0.82 },
  { xPct: 0.87, yOffset: 18, size: 24, rot: -28, opacity: 0.78 },
  // Top row — tip of the pile, smallest
  { xPct: 0.30, yOffset: 38, size: 22, rot: -16, opacity: 0.75 },
  { xPct: 0.50, yOffset: 42, size: 24, rot: 12,  opacity: 0.78 },
  { xPct: 0.70, yOffset: 36, size: 20, rot: 26,  opacity: 0.72 },
  { xPct: 0.10, yOffset: 26, size: 22, rot: 8,   opacity: 0.75 },
];

function BananaPile() {
  return (
    <View style={styles.pile} pointerEvents="none">
      {PILE_BANANAS.map((b, i) => (
        <Text
          key={i}
          style={{
            position: "absolute",
            left: SCREEN_W * b.xPct - b.size / 2,
            bottom: b.yOffset,
            fontSize: b.size,
            opacity: b.opacity,
            transform: [{ rotate: `${b.rot}deg` }],
          }}
        >
          🍌
        </Text>
      ))}
    </View>
  );
}

interface BananaGroveWorldProps {
  active?: boolean;
}

export function BananaGroveWorld({ active = true }: BananaGroveWorldProps) {
  const particles = useMemo(buildParticles, []);
  const progress = useSharedValue(0); // loops 0 → 1 over FALL_DURATION_MS

  useEffect(() => {
    if (!active) {
      cancelAnimation(progress);
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: FALL_DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [active, progress]);

  return (
    <View style={styles.root} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, SCREEN_H)}
            colors={["#0A0A0F", "#070708", "#000000"]}
          />
        </Rect>
      </Canvas>

      {active &&
        particles.map((p, i) => (
          <BananaParticle key={i} particle={p} progress={progress} />
        ))}

      {/* Static pile renders LAST so it sits on top of any falling particle
          that hasn't fully faded by the time it overlaps the pile. */}
      <BananaPile />
    </View>
  );
}

interface BananaParticleProps {
  particle: Particle;
  progress: Animated.SharedValue<number>;
}

function BananaParticle({ particle, progress }: BananaParticleProps) {
  const animStyle = useAnimatedStyle(() => {
    const t = (progress.value + particle.phase) % 1;
    const y = interpolate(t, [0, 1], [-40, SCREEN_H + 40]);
    const sway = Math.sin(t * Math.PI * 2) * particle.swayAmp;
    const x = particle.lane * SCREEN_W + sway - particle.size / 2;
    const rot = Math.sin(t * Math.PI * 2 + particle.phase * 6) * 25;
    // Fade in from the top (0 → 1 over t=0..0.08), full opacity in the middle,
    // then fade to 0 between t=0.75 and t=0.85 — i.e. just before the banana
    // would reach the static pile's top. After t=0.85 the particle is invisible
    // until the cycle wraps. This gives the illusion of "landing" on the pile.
    const opacity =
      t < 0.08 ? t * 12 :
      t > 0.85 ? 0 :
      t > 0.75 ? (0.85 - t) * 10 :
      1;
    return {
      transform: [
        { translateX: x },
        { translateY: y },
        { rotate: `${rot}deg` },
      ],
      opacity: Math.min(1, opacity) * 0.85,
    };
  }, [particle.lane, particle.phase, particle.size, particle.swayAmp]);

  return (
    <Animated.View pointerEvents="none" style={[styles.particle, animStyle]}>
      <Text style={{ fontSize: particle.size }}>🍌</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject },
  particle: { position: "absolute", left: 0, top: 0 },
  pile: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: PILE_BOTTOM,
    height: 80,
  },
});
