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
// Native asset is roughly 384×256 voxel render (3:2). We render at a fixed
// height; width follows aspect.
const MOWER_HEIGHT = 200;
const MOWER_ASPECT = 1.5;
const MOWER_WIDTH = MOWER_HEIGHT * MOWER_ASPECT;

// PFP anchor — sits ON the voxel monke's head in the original asset (native
// pixels ~x=790, y=332 → fractional 0.515, 0.324). Sized to roughly cover
// just the head; circle crop pulls the head shape out of the square NFT
// without dragging the NFT's surrounding background into view.
const PFP_SEAT_X_PCT = 0.515;
const PFP_SEAT_Y_PCT = 0.324;
const PFP_SIZE = 44;
const INTAKE_X_PCT = 0.10;          // intake = front-left (mowing deck)
const INTAKE_Y_PCT = 0.85;
const CRATE_X_PCT = 0.74;           // top-left of crate banana area
const CRATE_Y_PCT = 0.22;
const CRATE_W_PCT = 0.22;
const CRATE_H_PCT = 0.32;

// ── Drive parameters ───────────────────────────────────────────────────────
const DRIVE_DURATION_MS = 5500;     // off-screen-left → off-screen-right
const BOUNCE_AMPLITUDE_PX = 2;      // subtle vertical wobble
const BOUNCE_FREQUENCY = 0.04;      // higher = more bounces per pixel of drive

// Sentinel value for intakeX when the mower is NOT active. Far enough off-
// screen that no banana's suction trigger accidentally fires while the mower
// is in its idle state.
const INTAKE_IDLE_X = -100_000;

// ── Crate fill positions ───────────────────────────────────────────────────
// Stable random-looking positions inside the crate area. Bananas appear at
// these slots in order as `crateCount` grows.
const CRATE_BANANA_SLOTS = [
  { x: 0.10, y: 0.85, rot: -12, size: 14 },
  { x: 0.55, y: 0.80, rot: 18, size: 13 },
  { x: 0.30, y: 0.75, rot: -6, size: 14 },
  { x: 0.75, y: 0.70, rot: 22, size: 12 },
  { x: 0.18, y: 0.62, rot: 8, size: 13 },
  { x: 0.50, y: 0.55, rot: -20, size: 12 },
  { x: 0.85, y: 0.55, rot: 4, size: 11 },
  { x: 0.30, y: 0.42, rot: -14, size: 12 },
  { x: 0.65, y: 0.40, rot: 16, size: 11 },
  { x: 0.10, y: 0.30, rot: 10, size: 11 },
  { x: 0.45, y: 0.22, rot: -8, size: 11 },
  { x: 0.78, y: 0.20, rot: 14, size: 10 },
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
  // driveX = mower's LEFT edge x-coordinate. Starts off-screen left.
  const driveX = useSharedValue(-MOWER_WIDTH);
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
      driveX.value = -MOWER_WIDTH;
      intakeX.value = INTAKE_IDLE_X;
      return;
    }
    // Reset to off-screen-left, then drive across.
    driveX.value = -MOWER_WIDTH;
    driveX.value = withTiming(
      SCREEN_W + 20,
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

  const visibleCrateSlots = useMemo(
    () => CRATE_BANANA_SLOTS.slice(0, Math.min(crateCount, MAX_CRATE_VISIBLE)),
    [crateCount],
  );

  if (!active) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        { bottom: bottomPx, width: MOWER_WIDTH, height: MOWER_HEIGHT },
        containerStyle,
      ]}
    >
      <Image
        source={MOWER_IMG}
        style={{ width: MOWER_WIDTH, height: MOWER_HEIGHT }}
        resizeMode="contain"
      />

      {/* User's NFT head, circle-cropped to drop the surrounding NFT
          background. Sits on top of the voxel monke's head in the asset —
          replaces the head only, leaves the voxel body + arms untouched.
          No border / no glow / no decoration. */}
      {pfpUri ? (
        <Image
          source={{ uri: pfpUri }}
          style={{
            position: "absolute",
            left: MOWER_WIDTH * PFP_SEAT_X_PCT - PFP_SIZE / 2,
            top: MOWER_HEIGHT * PFP_SEAT_Y_PCT - PFP_SIZE / 2,
            width: PFP_SIZE,
            height: PFP_SIZE,
            borderRadius: PFP_SIZE / 2, // circle crop pulls just the head
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
