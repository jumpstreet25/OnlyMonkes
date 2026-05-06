/**
 * MonkeMower — drives across the bottom of the chat sucking up the banana
 * pile. Replaces the BananaGroveWorld fade-reset entirely.
 *
 * Behaviour:
 *   - Spawned by BananaPile when the pile reaches its reset threshold.
 *   - Drives left-to-right at constant speed over DRIVE_DURATION_MS, with a
 *     subtle vertical bounce to suggest crossing the lumpy pile.
 *   - Exposes its intake-X position via a Reanimated SharedValue
 *     (`intakeX`). FallingBanana components watch that value and trigger
 *     their own suction animation when it passes their lane.
 *   - User's verifiedNft.image is overlaid as a small circular PFP on the
 *     driver seat — every Monke holder sees themselves driving.
 *   - When the drive completes (mower exits stage right), `onComplete` is
 *     called so the parent can clear the pile state.
 *
 * The static asset (assets/MonkeMower.png) keeps its voxel driver visible
 * UNDER the PFP overlay for now — if the asset is later edited to remove
 * the driver entirely (transparent gap in the seat), the PFP overlay will
 * read cleaner without any other code change.
 */

import React, { useEffect, useMemo } from "react";
import { View, Image, Text, StyleSheet, Dimensions } from "react-native";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MOWER_IMG = require("../../../assets/MonkeMower.png");
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  useDerivedValue,
  withTiming,
  cancelAnimation,
  runOnJS,
  Easing,
  type SharedValue,
} from "react-native-reanimated";

const { width: SCREEN_W } = Dimensions.get("window");

// ── Asset geometry ─────────────────────────────────────────────────────────
// Native asset is 1360×768 (≈1.77:1). Mower faces RIGHT; basket trails on
// the LEFT. Driving L→R, the deck on the right is the leading edge.
const MOWER_HEIGHT = 200;
const MOWER_ASPECT = 1360 / 768;
const MOWER_WIDTH = MOWER_HEIGHT * MOWER_ASPECT;
// New asset has wheels at the asset's bottom edge — negligible padding.
const ASSET_WHEEL_OFFSET_PX = 2;

// PFP overlay disabled per user feedback — voxel driver shows as-is.
// Constants retained so we can re-enable easily later.
const PFP_SEAT_X_PCT = 0.55;
const PFP_SEAT_Y_PCT = 0.18;
const PFP_SIZE = 44;
const SHOW_PFP = false;
// Intake = front-RIGHT of asset (the mowing deck). When driving L→R the
// deck on the right is the LEADING edge, so intake reaches bananas first.
const INTAKE_X_PCT = 0.93;
const INTAKE_Y_PCT = 0.85;
// Crate banana render region — basket sits at the LEFT side of the new
// asset. Region extends from y=0 (top of mower) DOWN to the basket rim
// (~y_pct = 0.40). Slot y values map within this region; y close to 1.0
// means at the rim, y close to 0 means high mound apex above the rim.
const CRATE_X_PCT = 0.06;
const CRATE_Y_PCT = 0.00;
const CRATE_W_PCT = 0.24;
const CRATE_H_PCT = 0.40;
// First N sucked bananas are conceptually "inside" the basket — hidden
// behind the OPAQUE basket walls (basket is solid black, not transparent).
// Only after this threshold do bananas start piling visibly above the rim
// in a tight pyramid.
const HIDDEN_INSIDE_BASKET = 5;

// ── Drive parameters ───────────────────────────────────────────────────────
const DRIVE_DURATION_MS = 5500;     // off-screen-left → off-screen-right
const BOUNCE_AMPLITUDE_PX = 2;      // subtle vertical wobble
const BOUNCE_FREQUENCY = 0.04;      // higher = more bounces per pixel of drive

// Sentinel value for intakeX when the mower is NOT active. Far enough off-
// screen that no banana's suction trigger accidentally fires while the mower
// is in its idle state.
const INTAKE_IDLE_X = -100_000;

// ── Crate fill positions ───────────────────────────────────────────────────
// Tight makeshift pyramid — bananas overlap with no gaps between them, like
// a real fruit pile mounding above the basket rim. Each row offset and one
// banana shorter than the row below, building toward an apex.
//
// Coords:
//  - x: fraction of CRATE_W_PCT (0=left edge of basket interior, 1=right)
//  - y: fraction of CRATE_H_PCT (1.0=at the rim, decreasing = higher mound)
//  - size: 24-30 px to match in-pile banana sizes (user wanted "same size
//    in the basket as on the screen")
//
// Slot ORDER matters: bottom row first (filled as visible count goes 1, 2,
// 3, 4, 5...), stacking up to apex. Pile grows visibly with each suck.
const CRATE_BANANA_SLOTS = [
  // Row 1 — 5 bananas at the rim, tightly overlapping (centers ~17% apart,
  // size 28 → ~10px overlap between neighbors)
  { x: 0.10, y: 0.92, rot: -10, size: 28 },
  { x: 0.30, y: 0.95, rot:   8, size: 28 },
  { x: 0.50, y: 0.92, rot: -14, size: 30 },
  { x: 0.70, y: 0.95, rot:  12, size: 28 },
  { x: 0.90, y: 0.92, rot:  -6, size: 26 },
  // Row 2 — 4 bananas, offset between row-1 centers, ~20% lifted
  { x: 0.20, y: 0.72, rot:  14, size: 28 },
  { x: 0.40, y: 0.74, rot: -10, size: 28 },
  { x: 0.60, y: 0.72, rot:  16, size: 28 },
  { x: 0.80, y: 0.74, rot:  -8, size: 26 },
  // Row 3 — 3 bananas
  { x: 0.30, y: 0.50, rot: -12, size: 26 },
  { x: 0.50, y: 0.52, rot:  10, size: 28 },
  { x: 0.70, y: 0.50, rot: -18, size: 26 },
  // Row 4 — 2 bananas
  { x: 0.40, y: 0.28, rot:  14, size: 26 },
  { x: 0.60, y: 0.30, rot: -10, size: 26 },
  // Apex — 1 banana, slightly offset
  { x: 0.50, y: 0.08, rot:  -8, size: 24 },
];
const MAX_CRATE_VISIBLE = CRATE_BANANA_SLOTS.length;

interface MonkeMowerProps {
  /** Render + start drive when true. Reset to false to allow next cycle. */
  active: boolean;
  /** User's NFT image (data URI or remote URL). Rendered as circle on seat. */
  pfpUri: string | null;
  /** Bottom offset for the mower's bottom edge (matches pile bottom). */
  bottomPx: number;
  /** SharedValue published by parent — mower writes its current intake X. */
  intakeX: SharedValue<number>;
  /** Suction count — drives the visible crate fill. */
  crateCount: number;
  /** Called once the mower has fully driven off-screen right. */
  onComplete: () => void;
}

export function MonkeMower({
  active,
  pfpUri,
  bottomPx,
  intakeX,
  crateCount,
  onComplete,
}: MonkeMowerProps) {
  // Mower drives LEFT-TO-RIGHT. New asset shows the vehicle facing RIGHT
  // (deck on the right, basket trailing on the left). Driving right = facing
  // forward. driveX = mower's LEFT edge. Starts off-screen LEFT, ends
  // off-screen RIGHT.
  const DRIVE_START_X = -MOWER_WIDTH - 20;
  const DRIVE_END_X = SCREEN_W + 20;
  const driveX = useSharedValue(DRIVE_START_X);
  // Subtle vertical bounce derived from drive distance — gives "crossing
  // lumpy pile" feel without any per-banana collision math.
  const bounceY = useDerivedValue(() => {
    return Math.sin(driveX.value * BOUNCE_FREQUENCY) * BOUNCE_AMPLITUDE_PX;
  });

  // Sync intakeX with driveX. When the mower is at rest (active=false), we
  // park intakeX at INTAKE_IDLE_X so no banana triggers its suction.
  useAnimatedReaction(
    () => ({ x: driveX.value, on: active }),
    ({ x, on }) => {
      intakeX.value = on ? x + MOWER_WIDTH * INTAKE_X_PCT : INTAKE_IDLE_X;
    },
    [active],
  );

  useEffect(() => {
    if (!active) {
      cancelAnimation(driveX);
      driveX.value = DRIVE_START_X;
      intakeX.value = INTAKE_IDLE_X;
      return;
    }
    // Reset to off-screen-right, then drive across leftward.
    driveX.value = DRIVE_START_X;
    driveX.value = withTiming(
      DRIVE_END_X,
      { duration: DRIVE_DURATION_MS, easing: Easing.linear },
      (finished) => {
        if (finished) runOnJS(onComplete)();
      },
    );
    return () => cancelAnimation(driveX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: driveX.value },
      { translateY: bounceY.value },
    ],
  }));

  const visibleCrateSlots = useMemo(() => {
    // First HIDDEN_INSIDE_BASKET sucks fill the basket "internally" without
    // any visible bananas — they're behind the wireframe walls. After the
    // threshold, surplus bananas pile UP above the rim using slots in order.
    const visibleCount = Math.max(
      0,
      Math.min(crateCount - HIDDEN_INSIDE_BASKET, MAX_CRATE_VISIBLE),
    );
    return CRATE_BANANA_SLOTS.slice(0, visibleCount);
  }, [crateCount]);

  if (!active) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        // Shift container DOWN by ASSET_WHEEL_OFFSET_PX so the wheels visually
        // sit on the banana floor (instead of hovering above it).
        { bottom: bottomPx - ASSET_WHEEL_OFFSET_PX, width: MOWER_WIDTH, height: MOWER_HEIGHT },
        containerStyle,
      ]}
    >
      <Image
        source={MOWER_IMG}
        style={{ width: MOWER_WIDTH, height: MOWER_HEIGHT }}
        resizeMode="contain"
      />

      {/* User PFP overlay — disabled per design pass. Voxel driver stands
          in for now. To re-enable: set SHOW_PFP = true at the top. */}
      {SHOW_PFP && pfpUri ? (
        <Image
          source={{ uri: pfpUri }}
          style={{
            position: "absolute",
            left: MOWER_WIDTH * PFP_SEAT_X_PCT - PFP_SIZE / 2,
            top: MOWER_HEIGHT * PFP_SEAT_Y_PCT - PFP_SIZE / 2,
            width: PFP_SIZE,
            height: PFP_SIZE,
            borderRadius: PFP_SIZE / 2,
          }}
          resizeMode="cover"
        />
      ) : null}

      {/* Crate fill — bananas appear in order as the mower picks them up. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: MOWER_WIDTH * CRATE_X_PCT,
          top: MOWER_HEIGHT * CRATE_Y_PCT,
          width: MOWER_WIDTH * CRATE_W_PCT,
          height: MOWER_HEIGHT * CRATE_H_PCT,
        }}
      >
        {visibleCrateSlots.map((slot, i) => (
          <Text
            key={i}
            style={{
              position: "absolute",
              left: (MOWER_WIDTH * CRATE_W_PCT) * slot.x - slot.size / 2,
              top: (MOWER_HEIGHT * CRATE_H_PCT) * slot.y,
              fontSize: slot.size,
              transform: [{ rotate: `${slot.rot}deg` }],
            }}
          >
            🍌
          </Text>
        ))}
      </View>
    </Animated.View>
  );
}

/** Constants exported so BananaPile / FallingBanana can compute the same
 * intake Y on the JS side without duplicating the geometry numbers. */
export const MOWER_GEOMETRY = {
  height: MOWER_HEIGHT,
  width: MOWER_WIDTH,
  intakeYFromBottom: MOWER_HEIGHT * (1 - INTAKE_Y_PCT), // px above mower's bottom edge
  driveDurationMs: DRIVE_DURATION_MS,
  intakeIdleX: INTAKE_IDLE_X,
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
  },
});
