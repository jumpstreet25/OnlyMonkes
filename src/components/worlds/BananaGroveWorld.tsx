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

import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import { Canvas, Rect, LinearGradient, vec } from "@shopify/react-native-skia";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withTiming,
  runOnJS,
  Easing,
  interpolate,
  Extrapolation,
  type SharedValue,
} from "react-native-reanimated";
import { latestBubbleHeightSV } from "@/lib/chatViewport";
import { useAppStore } from "@/store/appStore";
import { MOWER_GEOMETRY } from "@/components/worlds/MonkeMower";
import {
  mowerIntakeXSV,
  MOWER_INTAKE_IDLE_X,
  useMowerStore,
} from "@/lib/bananaMowerState";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// ── Layout constants ────────────────────────────────────────────────────────
// Approximate height of the chat input bar's content; safe-area inset is
// added at render time. Used to compute the pile reset threshold so the pile
// fades just as it visually reaches the bottom of the latest message bubble.
const INPUT_BAR_HEIGHT = 96;

// Spawn cadence — every TICK_MS one banana drops. 870ms = previous 700ms
// slowed 20% per design pass (mower cycle slows proportionally since pile
// takes correspondingly longer to fill).
const TICK_MS = 870;

// Stacking — each new banana in a lane adds STACK_LIFT_PX to that lane's
// stack height. 8px gives a tighter overlap than the visual size of the
// banana, so the pile reads as a compact heap (rather than a tall stack)
// and the MonkeMower's intake comfortably clears the pile top.
const NUM_LANES = 20;
const LANE_WIDTH = SCREEN_W / NUM_LANES;
const STACK_LIFT_PX = 8;
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

const SUCTION_DURATION_MS = 420;
const SUCTION_TRIGGER_RANGE_PX = 18; // intake catches bananas within ±this px
const SUCTION_INTAKE_Y_FROM_PILE_BOTTOM_PX = MOWER_GEOMETRY.intakeYFromBottom;
// Approach wobble — banana shakes when the mower's intake is heading toward
// it but hasn't quite reached suction range. APPROACH_RANGE_PX is the max
// distance (pixels, intake to banana) at which the wobble starts; intensity
// grows linearly from 0 → 1 as the intake closes the gap.
const APPROACH_RANGE_PX = 90;
const WOBBLE_AMPLITUDE_PX = 3;
const WOBBLE_ROTATION_DEG = 6;

interface FallingBananaProps {
  banana: PileBanana;
  pileBottomPx: number;
  /** Mower's current intake X — written by MonkeMower, read here. Far off-
   * screen sentinel value when the mower is inactive (no suction triggers). */
  mowerIntakeX: SharedValue<number>;
  /** Called when this banana has been fully sucked into the mower. Parent
   * removes it from the pile + increments the crate count. */
  onSucked: (id: number) => void;
}

function FallingBanana({ banana, pileBottomPx, mowerIntakeX, onSucked }: FallingBananaProps) {
  const fall = useSharedValue(0);
  // 0 = not being sucked, animates to 1 as the banana is pulled into the
  // mower's intake. Triggered exactly once when the mower's intake passes
  // this banana's lane.
  const suction = useSharedValue(0);
  // Capture mower's X at the MOMENT suction starts so the banana's curved
  // path has a concrete starting reference for the moving target. Without
  // this, the banana would chase the mower forever.
  const suctionStartMowerX = useSharedValue(0);

  useEffect(() => {
    fall.value = withTiming(1, {
      duration: banana.fallDurationMs,
      easing: Easing.in(Easing.cubic), // accelerate as it falls — gravity feel
    });
  }, [fall, banana.fallDurationMs]);

  const laneCenterX = banana.lane * LANE_WIDTH + LANE_WIDTH / 2;
  const bananaScreenX = laneCenterX + banana.lateralJitter;

  // Watch mower's intake X. When it crosses this banana's lane (within a
  // small range), trigger the one-shot suction animation.
  useAnimatedReaction(
    () => mowerIntakeX.value,
    (curr) => {
      if (suction.value !== 0) return;
      if (curr === MOWER_INTAKE_IDLE_X) return;
      if (
        curr >= bananaScreenX - SUCTION_TRIGGER_RANGE_PX &&
        curr <= bananaScreenX + SUCTION_TRIGGER_RANGE_PX
      ) {
        suctionStartMowerX.value = curr;
        suction.value = withTiming(
          1,
          { duration: SUCTION_DURATION_MS, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (finished) runOnJS(onSucked)(banana.id);
          },
        );
      }
    },
  );

  const animStyle = useAnimatedStyle(() => {
    const tFall = fall.value;
    const tSuck = suction.value;

    // Base falling translation: from -SCREEN_H * 0.95 to 0 (the resting
    // landed position, anchored by the parent's bottom: pileBottom + stack).
    const fallY = interpolate(tFall, [0, 1], [-SCREEN_H * 0.95, 0]);
    const tumble = tFall * banana.tumbleSpins * 360;
    const settle = interpolate(tFall, [0.85, 1], [0, 1], Extrapolation.CLAMP);
    let rot = (1 - settle) * tumble + settle * banana.finalRot;

    let translateX = 0;
    let translateY = fallY;
    let scale = 1;
    let opacity = 1;

    if (tSuck > 0) {
      // Suction = banana drops DOWN under the mower (vacuum-style), drifts
      // slightly leftward toward the mower's intake/center as it descends,
      // and fades out before reaching the bottom. Reappears (counted) in
      // the basket via the crate fill render. NO spin, NO scale change —
      // the banana keeps its size and orientation as it gets pulled under.
      const intakeNowX = mowerIntakeX.value;
      // Drift horizontally toward the mower's intake X (small inward pull).
      const dx = (intakeNowX - bananaScreenX) * 0.4;
      // Drop downward — distance enough to clear the mower bottom + safe
      // area. Going positive in translateY means moving DOWN the screen.
      const SUCK_DROP_PX = 80;
      translateX = dx * tSuck;
      translateY = fallY + SUCK_DROP_PX * tSuck;
      // Fade to 0 — most of the fade happens in the first half so the
      // banana is invisible by the time it would visually leave the mower.
      opacity = 1 - tSuck;
      // Keep base rotation (no spin during suction).
    } else {
      // Approach wobble — mower's intake is nearby but hasn't sucked yet.
      // Mower drives L→R so the intake is to the LEFT of the banana when
      // approaching (negative distance = intake to the left of banana).
      const intakeNow = mowerIntakeX.value;
      if (intakeNow !== MOWER_INTAKE_IDLE_X) {
        const distance = intakeNow - bananaScreenX;
        if (distance < -SUCTION_TRIGGER_RANGE_PX && distance > -APPROACH_RANGE_PX) {
          // proximity: 0 just entering range → 1 about to be sucked
          const absDist = -distance;
          const proximity =
            1 - (absDist - SUCTION_TRIGGER_RANGE_PX) /
            (APPROACH_RANGE_PX - SUCTION_TRIGGER_RANGE_PX);
          // Use intake X as the time variable for the sin wave so the
          // wobble oscillates continuously as the mower closes the gap
          // (intake X changes linearly with time during the drive).
          const phase = intakeNow * 0.45;
          translateX += Math.sin(phase) * WOBBLE_AMPLITUDE_PX * proximity;
          rot += Math.sin(phase * 1.3) * WOBBLE_ROTATION_DEG * proximity;
        }
      }
    }

    return {
      transform: [
        { translateX },
        { translateY },
        { rotate: `${rot}deg` },
        { scale },
      ],
      opacity,
    };
  });

  // Landed pixel position — left edge based on lane center + jitter, bottom
  // based on stackIndex. The translateX/Y in animStyle handles "in flight".
  const leftPx = bananaScreenX - banana.size / 2;
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
  // Pile + mower sit at the very bottom edge of the screen — under the
  // Android nav bar (App Switcher area) and iOS home indicator. Previously
  // this was offset by `insets.bottom` to clear those bars; user pulled it
  // down so the mower visibly hugs the App Switcher bar. The Android system
  // bar is translucent over edge-to-edge content, so the mower silhouette
  // reads cleanly against it.
  const pileBottomPx = 0;
  const [bananas, setBananas] = useState<PileBanana[]>([]);
  const idRef = useRef(0);
  const laneHeightsRef = useRef<number[]>(new Array(NUM_LANES).fill(0));
  const mowerActiveRef = useRef(false);

  // User's NFT image — drawn on the mower's driver seat so every Monke
  // holder sees themselves driving when the cleanup happens.
  const verifiedNft = useAppStore((s) => s.verifiedNft);
  const pfpUri = verifiedNft?.image ?? null;

  useEffect(() => {
    if (!active) return;
    const intervalId = setInterval(() => {
      // Spawning is paused while the mower is on its run.
      if (mowerActiveRef.current) return;
      // Pick a random lane, look up its current stack count, and spawn a
      // banana destined for the top of that lane's stack.
      const lane = Math.floor(random() * NUM_LANES);
      const stackIndex = laneHeightsRef.current[lane];

      // Mower trigger: pile crosses ~half the input-bar height. Lower than
      // the previous "bubble bottom" threshold — fires sooner so the
      // cleanup is a regular delight rather than rare.
      const prospectiveLaneHeight = (stackIndex + 1) * STACK_LIFT_PX;
      // Lower threshold so the pile stays short — mower's intake (about
      // ~22px above ground at the new MOWER_HEIGHT=150) is comfortably
      // taller than the pile top, which sells the "sucking it up" visual.
      const triggerThreshold = INPUT_BAR_HEIGHT * 0.35;
      if (prospectiveLaneHeight >= triggerThreshold) {
        triggerMower();
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

  const triggerMower = () => {
    if (mowerActiveRef.current) return;
    mowerActiveRef.current = true;
    // Hand off to the chat-screen-level overlay (BananaMowerOverlay reads
    // the same store and renders MonkeMower above the chat content).
    useMowerStore.getState().trigger({
      pileBottomPx,
      pfpUri,
      onSucked: handleBananaSucked,
      onComplete: handleMowerComplete,
    });
  };

  const handleBananaSucked = (id: number) => {
    setBananas((prev) => prev.filter((b) => b.id !== id));
    useMowerStore.getState().bumpCrate();
  };

  const handleMowerComplete = () => {
    laneHeightsRef.current = new Array(NUM_LANES).fill(0);
    setBananas([]);
    mowerActiveRef.current = false;
    useMowerStore.getState().reset();
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {bananas.map((b) => (
        <FallingBanana
          key={b.id}
          banana={b}
          pileBottomPx={pileBottomPx}
          mowerIntakeX={mowerIntakeXSV}
          onSucked={handleBananaSucked}
        />
      ))}
    </View>
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
