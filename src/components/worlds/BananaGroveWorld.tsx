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

import React, { useEffect, useMemo, useState, useRef } from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import { Canvas, Rect, LinearGradient, vec } from "@shopify/react-native-skia";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  runOnJS,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { latestBubbleHeightSV } from "@/lib/chatViewport";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// Approx height of the chat input bar's content (minHeight 44 + paddingTop 10
// + paddingBottom 8 + borderTop ≈ 65px), padded to ~96 to leave breathing room
// when the action row expands. Safe-area inset is added on top dynamically so
// the pile clears Android nav bar (48) + iOS home indicator (34) automatically.
const INPUT_BAR_HEIGHT = 96;

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

// ─── Dynamic banana pile at the bottom of the screen ────────────────────────
// Pile bananas accumulate one at a time on a tick (TICK_MS). Each new banana
// claims a precomputed PILE_SLOTS position, so the pile builds up in stable
// (looks-random) places. When the pile's top edge would overlap the bottom
// of the bottommost (newest) message bubble — read from chatViewport's
// latestBubbleHeightSV — the whole pile fades out, count resets to 0, and
// a new pile starts forming. MAX_PILE is a hard ceiling so the pile resets
// even when chat is empty / latest-bubble height isn't reported.
//
// Bottom offset = INPUT_BAR_HEIGHT + safe-area inset bottom so the pile
// clears Android nav bar / iOS home indicator on every device.

const TICK_MS = 850;          // banana lands every 850ms (~50 bananas/min)
const MAX_PILE = 60;          // hard cap — pile resets at this size regardless
const PER_BANANA_LIFT = 5;    // every banana adds ~5px to pile-top height
const FADE_OUT_MS = 1400;
const FADE_IN_MS = 600;
const RESET_PADDING = 12;     // breathing room above the latest message bubble

interface PileSlot {
  xPct: number;     // 0..1 horizontal center
  yOffset: number;  // px upward from pile base
  size: number;     // font size
  rot: number;      // rotation degrees
  opacity: number;
}

// Deterministic pseudo-random pile slots. Each slot's yOffset grows roughly
// linearly so the pile builds upward visibly. xPct cycles across the screen
// using a golden-ratio-ish multiplier for natural spread.
const PILE_SLOTS: PileSlot[] = Array.from({ length: MAX_PILE }, (_, i) => {
  // Cheap LCG-style pseudo-random for stable per-slot variance
  const seed = ((i * 9301 + 49297) % 233280) / 233280;
  const xCycle = (i * 0.1618) % 1;       // golden-ratio walk across screen
  const xJitter = (seed - 0.5) * 0.08;
  return {
    xPct: 0.05 + Math.min(0.9, Math.max(0, xCycle + xJitter)) * 0.9,
    yOffset: i * PER_BANANA_LIFT,
    size: 22 + seed * 14,                // 22..36
    rot: -28 + seed * 56,                // -28..28
    opacity: 0.75 + seed * 0.20,         // 0.75..0.95
  };
});

interface BananaPileProps {
  active: boolean;
}

function BananaPile({ active }: BananaPileProps) {
  const insets = useSafeAreaInsets();
  const pileBottomPx = INPUT_BAR_HEIGHT + insets.bottom;
  const [pileCount, setPileCount] = useState(0);
  const opacity = useSharedValue(1);
  const cycleRef = useRef(0); // bumps on each fade so stale callbacks no-op

  // Refs to avoid stale closures in the interval handler.
  const pileBottomRef = useRef(pileBottomPx);
  pileBottomRef.current = pileBottomPx;

  useEffect(() => {
    if (!active) return;
    const intervalId = setInterval(() => {
      setPileCount((prev) => {
        // Compute prospective pile top after adding one. Pile top Y in
        // screen coords = SCREEN_H - pileBottom - (next * PER_BANANA_LIFT).
        // Reset trigger: pile top reaches latest-bubble bottom edge.
        // Latest-bubble BOTTOM Y on screen ≈ SCREEN_H - pileBottom - <bubble height>
        // Latest-bubble TOP Y on screen ≈ that minus the bubble height.
        // We trigger when the pile's TOP would cross the bubble's TOP, so
        // threshold compares pile height vs latest-bubble height + padding.
        const next = prev + 1;
        const pileHeight = next * PER_BANANA_LIFT;
        const bubbleH = latestBubbleHeightSV.value || 60;
        const shouldReset = next >= MAX_PILE || pileHeight >= bubbleH + RESET_PADDING;
        if (shouldReset) {
          const myCycle = cycleRef.current;
          opacity.value = withTiming(0, { duration: FADE_OUT_MS }, (finished) => {
            if (finished) {
              runOnJS(handleResetComplete)(myCycle);
            }
          });
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(intervalId);
    // active toggles between focused / backgrounded chat — restart the cycle
    // on each transition. opacity is a stable SharedValue so excluding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const handleResetComplete = (forCycle: number) => {
    // Guard against races: if cycleRef advanced past forCycle, a newer reset
    // already fired — skip the JS-side bookkeeping.
    if (forCycle !== cycleRef.current) return;
    cycleRef.current += 1;
    setPileCount(0);
    opacity.value = withTiming(1, { duration: FADE_IN_MS });
  };

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const visibleSlots = PILE_SLOTS.slice(0, Math.min(pileCount, MAX_PILE));

  return (
    <Animated.View
      style={[styles.pile, { bottom: pileBottomPx }, animStyle]}
      pointerEvents="none"
    >
      {visibleSlots.map((b, i) => (
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
    </Animated.View>
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

      {/* Pile renders LAST so it sits on top of any falling particle that
          hasn't fully faded by the time it overlaps the pile. */}
      <BananaPile active={active} />
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
    // bottom set dynamically by BananaPile() from useSafeAreaInsets()
    position: "absolute",
    left: 0,
    right: 0,
    height: 80,
  },
});
