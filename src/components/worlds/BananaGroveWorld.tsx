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
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { MonkeMower, MOWER_GEOMETRY } from "@/components/worlds/MonkeMower";

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
      if (curr === MOWER_GEOMETRY.intakeIdleX) return;
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
      // Compute target intake position in screen coords. We follow the
      // mower's CURRENT X so the banana visibly tracks the moving target —
      // but we anchor against the mower's X at suction-start so the curved
      // path stays a fixed shape (not infinitely chasing).
      const intakeNowX = mowerIntakeX.value;
      const intakeNowY = SCREEN_H - pileBottomPx - SUCTION_INTAKE_Y_FROM_PILE_BOTTOM_PX;
      // Banana's natural landed position in screen coords.
      const landedY = SCREEN_H - pileBottomPx - banana.stackIndex * STACK_LIFT_PX;

      const dx = intakeNowX - bananaScreenX;
      const dy = intakeNowY - landedY;
      translateX = dx * tSuck;
      translateY = fallY + dy * tSuck;

      // Spin while being pulled in — 2 full rotations on top of base rot.
      rot += tSuck * 720;
      // Scale down + fade out in the second half.
      scale = 1 - 0.6 * tSuck;
      opacity = interpolate(tSuck, [0.7, 1], [1, 0], Extrapolation.CLAMP);
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
  const insets = useSafeAreaInsets();
  // Pile sits at the absolute bottom (just clears Android nav bar / iOS home
  // indicator). The translucent chat input bar renders above this layer, so
  // bananas visibly stack up THROUGH it.
  const pileBottomPx = insets.bottom;
  const [bananas, setBananas] = useState<PileBanana[]>([]);
  const [mowerActive, setMowerActive] = useState(false);
  const [crateCount, setCrateCount] = useState(0);
  const idRef = useRef(0);
  const laneHeightsRef = useRef<number[]>(new Array(NUM_LANES).fill(0));
  const mowerActiveRef = useRef(false);
  // Mower writes its current intake X here; FallingBananas read it to know
  // when to trigger their suction animation. Parked at idle sentinel value
  // when mower is inactive.
  const mowerIntakeX = useSharedValue<number>(MOWER_GEOMETRY.intakeIdleX);

  // User's NFT image — drawn as a circle on the mower's driver seat so
  // every Monke holder sees themselves driving when the cleanup happens.
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

      // Mower trigger: any lane's stack is about to push the pile-top above
      // the latest message bubble's bottom edge. Compare prospective max
      // lane height (px) against the threshold.
      const prospectiveLaneHeight = (stackIndex + 1) * STACK_LIFT_PX;
      const bubbleH = latestBubbleHeightSV.value || 60;
      const dynamicThreshold = INPUT_BAR_HEIGHT + Math.min(bubbleH * 0.15, 12);
      if (prospectiveLaneHeight >= dynamicThreshold) {
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
    setCrateCount(0);
    setMowerActive(true);
  };

  // Called by FallingBanana when its suction animation finishes — banana
  // is fully consumed by the mower. Remove from pile, increment crate fill.
  const handleBananaSucked = (id: number) => {
    setBananas((prev) => prev.filter((b) => b.id !== id));
    setCrateCount((c) => c + 1);
  };

  const handleMowerComplete = () => {
    // Mower has driven off-screen right. Clear any bananas the suction
    // missed (edge cases — newly spawned mid-cycle, etc.) and reset lanes.
    laneHeightsRef.current = new Array(NUM_LANES).fill(0);
    setBananas([]);
    setMowerActive(false);
    mowerActiveRef.current = false;
    // Tiny delay before bananas start raining again — feels like a beat
    // of "all clear" before the next pile begins.
    setTimeout(() => {
      // Reset crate so next cycle starts empty (visual). The mower's render
      // is gated on `mowerActive`, so by now the crate display is unmounted —
      // resetting just keeps state tidy for next cycle.
      setCrateCount(0);
    }, 600);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {bananas.map((b) => (
        <FallingBanana
          key={b.id}
          banana={b}
          pileBottomPx={pileBottomPx}
          mowerIntakeX={mowerIntakeX}
          onSucked={handleBananaSucked}
        />
      ))}
      <MonkeMower
        active={mowerActive}
        pfpUri={pfpUri}
        bottomPx={pileBottomPx}
        intakeX={mowerIntakeX}
        crateCount={crateCount}
        onComplete={handleMowerComplete}
      />
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
