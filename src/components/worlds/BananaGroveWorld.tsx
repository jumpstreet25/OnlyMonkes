/**
 * BananaGroveWorld — green→gold gradient with banana emojis drifting downward.
 *
 * Skia Canvas paints the gradient. Banana particles use Reanimated shared
 * values driven by a single `withRepeat` clock so animation runs on the UI
 * thread (no JS-thread RAF, no setState per frame). Each particle reads the
 * same clock with a phase offset.
 *
 * When `active=false` the clock animation cancels — only the gradient remains.
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
            colors={["#0d2818", "#1a3d22", "#2d5a18", "#5e7a1a"]}
          />
        </Rect>
      </Canvas>

      {active &&
        particles.map((p, i) => (
          <BananaParticle key={i} particle={p} progress={progress} />
        ))}
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
    const opacity =
      t < 0.08 ? t * 12 : t > 0.92 ? (1 - t) * 12 : 1;
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
});
