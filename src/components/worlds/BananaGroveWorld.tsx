/**
 * BananaGroveWorld — gradient backdrop with bananas that fall, tumble, and
 * naturally stack into a pile at the bottom of the screen.
 *
 * Design (per design pass 2026-05-06):
 *   - No separate decorative "ambient" stream. Every falling banana is a pile
 *     banana — it picks a random lane, falls from above the screen with a
 *     tumbling rotation, and lands on top of whatever's already stacked in
 *     that lane. Lanes are NUM_LANES-wide horizontal bands so the pile
 *     distributes across the screen instead of stacking in one spot.
 *   - When ANY lane's stack reaches RESET_THRESHOLD_PX (just enough to
 *     visually touch the bottom of the latest message bubble), the whole
 *     pile fades out and a new pile starts forming.
 *   - Pile sits at the absolute bottom (insets.bottom — clears Android nav
 *     bar / iOS home indicator). The translucent input bar lets the pile be
 *     seen building up THROUGH it.
 *   - Bananas tumble during fall (1-3 random spins) and settle to a final
 *     random rotation in the last 15% of the fall — gives a "rolled into
 *     place" feel.
 */

import React, { useEffect, useRef, useState, useMemo } from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import { Canvas, Rect, LinearGradient, vec } from "@shopify/react-native-skia";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { latestBubbleHeightSV } from "@/lib/chatViewport";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// ── Layout constants ────────────────────────────────────────────────────────
// Approximate height of the chat input bar's content; safe-area inset is
// added at render time. Used to compute the pile reset threshold so the pile
// fades just as it visually reaches the bottom of the latest message bubble.
const INPUT_BAR_HEIGHT = 96;

// Spawn cadence — every TICK_MS one banana drops. 700ms feels active without
// flooding the screen.
const TICK_MS = 700;

// Stacking — each new banana in a lane adds STACK_LIFT_PX to that lane's
// stack height (overlaps slightly so bananas pack tightly, like a real pile).
const NUM_LANES = 20;
const LANE_WIDTH = SCREEN_W / NUM_LANES;
const STACK_LIFT_PX = 14;
const BANANA_BASE_SIZE = 24;
const BANANA_SIZE_VARIANCE = 8;

// Reset threshold — when the tallest lane's pile reaches this many pixels
// (measured upward from the pile floor), trigger fade + reset. Tuned to
// just touch the bubble bottom (= top of input bar) plus a small breathing
// margin so the pile doesn't visually overlap the message itself.
const RESET_THRESHOLD_PX = INPUT_BAR_HEIGHT + 8;

// Animation durations
const FALL_DURATION_MIN_MS = 1100;
const FALL_DURATION_MAX_MS = 1700;
const FADE_OUT_MS = 1200;
const FADE_IN_MS = 500;
const RESET_COOLDOWN_MS = 250;

const random = () => Math.random();

// ── Per-banana data ────────────────────────────────────────────────────────

interface PileBanana {
  id: number;
  lane: number;          // 0..NUM_LANES-1
  stackIndex: number;    // 0 = floor, 1 = on top of one banana, etc.
  finalRot: number;      // settled rotation when landed (-50..50 deg)
  size: number;          // font size (BANANA_BASE_SIZE..+VARIANCE)
  lateralJitter: number; // small ± offset within the lane (-4..4 px)
  fallDurationMs: number;
  tumbleSpins: number;   // total 360° rotations during fall (1-3)
}

// ── Falling banana component ───────────────────────────────────────────────

interface FallingBananaProps {
  banana: PileBanana;
  pileBottomPx: number;
}

function FallingBanana({ banana, pileBottomPx }: FallingBananaProps) {
  const fall = useSharedValue(0);

  useEffect(() => {
    fall.value = withTiming(1, {
      duration: banana.fallDurationMs,
      easing: Easing.in(Easing.cubic), // accelerate as it falls — gravity feel
    });
  }, [fall, banana.fallDurationMs]);

  const animStyle = useAnimatedStyle(() => {
    const t = fall.value;
    // Falls from above the screen down to its target landed position. The
    // parent View positions the banana at `bottom: pileBottom + landedY`,
    // so translateY interpolates from -screen-height back to 0 (resting).
    const y = interpolate(t, [0, 1], [-SCREEN_H * 0.95, 0]);
    // Tumble during fall — total tumbleSpins full rotations — then settle
    // to finalRot in the last 15% of the fall. The blend factor `settle`
    // ramps 0→1 in that window so the transition reads as "rolled into place".
    const tumble = t * banana.tumbleSpins * 360;
    const settle = interpolate(
      t,
      [0.85, 1],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const rot = (1 - settle) * tumble + settle * banana.finalRot;
    return {
      transform: [{ translateY: y }, { rotate: `${rot}deg` }],
    };
  });

  // Landed pixel position — left edge based on lane center + jitter, bottom
  // based on stackIndex. The translateY in animStyle handles "in flight" Y.
  const laneCenterX = banana.lane * LANE_WIDTH + LANE_WIDTH / 2;
  const leftPx = laneCenterX + banana.lateralJitter - banana.size / 2;
  const bottomPx = pileBottomPx + banana.stackIndex * STACK_LIFT_PX;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: leftPx,
          bottom: bottomPx,
        },
        animStyle,
      ]}
    >
      <Text style={{ fontSize: banana.size, opacity: 0.9 }}>🍌</Text>
    </Animated.View>
  );
}

// ── Pile manager ───────────────────────────────────────────────────────────

interface BananaPileProps {
  active: boolean;
}

function BananaPile({ active }: BananaPileProps) {
  const insets = useSafeAreaInsets();
  // Pile sits at the absolute bottom (just clears Android nav bar / iOS home
  // indicator). The translucent chat input bar renders above this layer, so
  // bananas visibly stack up THROUGH it.
  const pileBottomPx = insets.bottom;
  const [bananas, setBananas] = useState<PileBanana[]>([]);
  const opacity = useSharedValue(1);
  const idRef = useRef(0);
  const cycleRef = useRef(0);
  const laneHeightsRef = useRef<number[]>(new Array(NUM_LANES).fill(0));
  const fadingRef = useRef(false); // suppress spawns mid-fade

  useEffect(() => {
    if (!active) return;
    const intervalId = setInterval(() => {
      if (fadingRef.current) return;
      // Pick a random lane, look up its current stack count, and spawn a
      // banana destined for the top of that lane's stack.
      const lane = Math.floor(random() * NUM_LANES);
      const stackIndex = laneHeightsRef.current[lane];

      // Reset trigger: any lane's stack is about to push the pile-top above
      // the latest message bubble's bottom edge. Compare the prospective max
      // lane height (in pixels) against the threshold.
      const prospectiveLaneHeight = (stackIndex + 1) * STACK_LIFT_PX;
      const bubbleH = latestBubbleHeightSV.value || 60;
      const dynamicThreshold = INPUT_BAR_HEIGHT + Math.min(bubbleH * 0.15, 12);
      if (prospectiveLaneHeight >= dynamicThreshold) {
        triggerReset();
        return;
      }

      // Commit the lane height + push the banana with randomized cosmetics.
      laneHeightsRef.current[lane] = stackIndex + 1;
      const banana: PileBanana = {
        id: idRef.current++,
        lane,
        stackIndex,
        finalRot: -50 + random() * 100,
        size: BANANA_BASE_SIZE + random() * BANANA_SIZE_VARIANCE,
        lateralJitter: (random() - 0.5) * 8,
        fallDurationMs:
          FALL_DURATION_MIN_MS +
          random() * (FALL_DURATION_MAX_MS - FALL_DURATION_MIN_MS),
        tumbleSpins: 1 + Math.floor(random() * 3),
      };
      setBananas((prev) => [...prev, banana]);
    }, TICK_MS);
    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const triggerReset = () => {
    if (fadingRef.current) return;
    fadingRef.current = true;
    const myCycle = cycleRef.current;
    opacity.value = withTiming(0, { duration: FADE_OUT_MS }, (finished) => {
      if (finished) {
        runOnJS(handleResetComplete)(myCycle);
      }
    });
  };

  const handleResetComplete = (forCycle: number) => {
    if (forCycle !== cycleRef.current) return;
    cycleRef.current += 1;
    laneHeightsRef.current = new Array(NUM_LANES).fill(0);
    setBananas([]);
    // Brief pause so the screen reads as "cleared" before bananas start
    // raining again — feels more like a discrete cycle than a constant
    // strobing reset.
    setTimeout(() => {
      fadingRef.current = false;
      opacity.value = withTiming(1, { duration: FADE_IN_MS });
    }, RESET_COOLDOWN_MS);
  };

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, animStyle]}
      pointerEvents="none"
    >
      {bananas.map((b) => (
        <FallingBanana key={b.id} banana={b} pileBottomPx={pileBottomPx} />
      ))}
    </Animated.View>
  );
}

// ── World root ─────────────────────────────────────────────────────────────

interface BananaGroveWorldProps {
  active?: boolean;
}

export function BananaGroveWorld({ active = true }: BananaGroveWorldProps) {
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

      {/* Falling + stacking pile. The decorative ambient particle stream from
          the previous design has been removed — every falling banana is now
          part of the pile (per design discussion 2026-05-06). */}
      <BananaPile active={active} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject },
});
