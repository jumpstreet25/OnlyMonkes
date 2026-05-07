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

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import { Canvas, Rect, LinearGradient, vec, Path, Group } from "@shopify/react-native-skia";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withTiming,
  withDelay,
  cancelAnimation,
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

const SUCTION_DURATION_MS = 650;
const SUCTION_TRIGGER_RANGE_PX = 22; // intake catches bananas within ±this px
const SUCTION_INTAKE_Y_FROM_PILE_BOTTOM_PX = MOWER_GEOMETRY.intakeYFromBottom;
// Approach wobble — banana shakes when the mower's intake is heading toward
// it but hasn't quite reached suction range. APPROACH_RANGE_PX is the max
// distance (pixels, intake to banana) at which the wobble starts; intensity
// grows linearly from 0 → 1 as the intake closes the gap.
const APPROACH_RANGE_PX = 120;
const WOBBLE_AMPLITUDE_PX = 5;
const WOBBLE_ROTATION_DEG = 14;

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
      // Phase 1 (0 → 0.55): banana yanked toward the mower's intake at the
      // front-right of the deck — full horizontal slide with a violent
      // wiggle + fast spin so it reads as "sucked with force". Slight
      // upward lift, like the vacuum lifts it off the pile.
      // Phase 2 (0.55 → 1.0): banana dives UNDER the mower deck — small
      // downward dip, shrink, fade. The mower image renders above the
      // banana layer so the body visually swallows it. After fade-out
      // onSucked fires → banana removed → crateCount bumps → banana
      // reappears in the basket via the mower's crate-fill render.
      const intakeNowX = mowerIntakeX.value;
      const dx = intakeNowX - bananaScreenX;

      const slideT = Math.min(tSuck / 0.55, 1);
      const slideEased = 1 - Math.pow(1 - slideT, 2.2); // ease-out, snaps to intake
      translateX = dx * slideEased;

      // Wiggle — strongest at start, decays as banana reaches intake.
      const wobbleStrength = Math.max(0, 1 - slideT);
      const wobblePhase = tSuck * 65;
      translateX += Math.sin(wobblePhase) * 7 * wobbleStrength;

      // Force spin throughout suction + extra jitter spin during wiggle phase.
      rot += tSuck * 540 + Math.sin(wobblePhase * 1.3) * 30 * wobbleStrength;

      // Slight upward lift during phase 1 (vacuum picks it up off pile).
      const liftCurve = Math.sin(slideT * Math.PI); // 0 → 1 → 0
      let suctionDeltaY = -10 * liftCurve;

      // Phase 2 — dive under the deck.
      if (tSuck > 0.55) {
        const diveT = (tSuck - 0.55) / 0.45;
        suctionDeltaY += 16 * diveT;
        scale = 1 - 0.4 * diveT;
        opacity = 1 - diveT;
      }
      translateY = fallY + suctionDeltaY;
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

// ── Lower-third clutter — barrel, vine drape, drifting leaves ──────────────
// Decorative props that give Banana Grove a "rural jungle" tier of
// premium polish, paralleling Cyberpunk's embers + lightning.

// ── Vine drape (Skia path) ──
// Static vine hanging from the top-left edge, curving slightly down. Plant-
// stem green. Anchored ~14px from the left edge so it doesn't crowd
// chat-message left margins.
const VINE_PATH = (() => {
  // Quadratic bezier curve down with gentle sway
  const x0 = 14;
  return `M ${x0} 0
          Q ${x0 + 8} 40 ${x0 - 2} 80
          Q ${x0 - 6} 130 ${x0 + 4} 175
          Q ${x0 + 9} 220 ${x0 + 2} 260
          Q ${x0 - 3} 300 ${x0 + 5} 340`;
})();

function VineDrape() {
  return (
    <Group>
      {/* Stem outer (slightly translucent darker green) */}
      <Path
        path={VINE_PATH}
        color="rgba(35, 70, 30, 0.55)"
        style="stroke"
        strokeWidth={3.5}
      />
      {/* Stem core — brighter green */}
      <Path
        path={VINE_PATH}
        color="rgba(70, 130, 60, 0.85)"
        style="stroke"
        strokeWidth={1.5}
      />
    </Group>
  );
}

// Static leaves attached to the vine — emoji-based for visual richness.
// Positions are deliberately along the vine's general curve.
const VINE_LEAVES: Array<{ x: number; y: number; size: number; rot: number; glyph: string }> = [
  { x: 4,  y: 28,  size: 18, rot: -28, glyph: "🌿" },
  { x: 22, y: 75,  size: 16, rot: 18,  glyph: "🍃" },
  { x: 0,  y: 122, size: 19, rot: -42, glyph: "🌿" },
  { x: 18, y: 168, size: 15, rot: 24,  glyph: "🍃" },
  { x: 6,  y: 215, size: 17, rot: -18, glyph: "🌿" },
  { x: 20, y: 260, size: 14, rot: 35,  glyph: "🍃" },
  { x: 2,  y: 305, size: 16, rot: -22, glyph: "🌿" },
];

// ── Barrel (Skia rects) ──
// Wooden barrel sitting at the bottom-left, just above the pile floor.
// 7-stripe rendering with darker hoops at top/middle/bottom.
function Barrel() {
  // Anchored bottom-left, 14px in from the edge so it doesn't crowd the
  // very corner. Height 44 + sits 96px above screen bottom (above the
  // input-bar zone) so it reads as a prop on the ground floor.
  const w = 38;
  const h = 44;
  const x = 14;
  const y = SCREEN_H - 96 - h - 4; // 4px gap above input bar top
  const wood1 = "#7A4F28";
  const wood2 = "#6E4720";
  const hoopDark = "#3F2710";
  const woodHi = "#9C6E45";
  return (
    <Group>
      {/* Top hoop — darker, slightly wider than body */}
      <Rect x={x - 1} y={y} width={w + 2} height={4} color={hoopDark} />
      {/* Body planks */}
      <Rect x={x} y={y + 4}  width={w} height={5} color={wood1} />
      <Rect x={x} y={y + 9}  width={w} height={5} color={wood2} />
      <Rect x={x} y={y + 14} width={w} height={4} color={wood1} />
      {/* Mid hoop */}
      <Rect x={x - 1} y={y + 18} width={w + 2} height={3} color={hoopDark} />
      {/* More planks */}
      <Rect x={x} y={y + 21} width={w} height={5} color={wood2} />
      <Rect x={x} y={y + 26} width={w} height={5} color={wood1} />
      <Rect x={x} y={y + 31} width={w} height={5} color={wood2} />
      {/* Bottom hoop */}
      <Rect x={x - 1} y={y + 36} width={w + 2} height={4} color={hoopDark} />
      {/* Top rim highlight (subtle) */}
      <Rect x={x + 1} y={y + 4}  width={w - 2} height={1} color={woodHi} />
    </Group>
  );
}

// ── Drifting leaves ──
// Counterpart to Cyberpunk's embers — leaves drift DOWN from the top with
// rotation, gentle horizontal sway, and a gradual fade. ~5 active at a time.

interface LeafConfig {
  key: number;
  glyph: string;
  startX: number;
  size: number;
  durationMs: number;
  delayMs: number;
  driftX: number;
  spinDeg: number;
}

const LEAF_GLYPHS = ["🍃", "🌿"];
const NUM_LEAVES = 5;
const LEAF_DURATION_MIN_MS = 9000;
const LEAF_DURATION_MAX_MS = 16_000;

let leafKeyCounter = 0;
function makeLeafConfig(): LeafConfig {
  return {
    key: ++leafKeyCounter,
    glyph: LEAF_GLYPHS[Math.floor(Math.random() * LEAF_GLYPHS.length)],
    startX: Math.random() * (SCREEN_W - 32) + 16,
    size: 14 + Math.random() * 10,
    durationMs:
      LEAF_DURATION_MIN_MS +
      Math.random() * (LEAF_DURATION_MAX_MS - LEAF_DURATION_MIN_MS),
    delayMs: Math.random() * 4000,
    driftX: (Math.random() - 0.5) * 90,
    spinDeg: (Math.random() - 0.5) * 720,
  };
}

interface LeafDriftProps {
  active: boolean;
  initialDelayMs: number;
}

function LeafDrift({ active, initialDelayMs }: LeafDriftProps) {
  const [config, setConfig] = useState<LeafConfig>(() => makeLeafConfig());
  const t = useSharedValue(0);

  const respawn = useCallback(() => setConfig(makeLeafConfig()), []);

  useEffect(() => {
    if (!active) {
      cancelAnimation(t);
      return;
    }
    t.value = 0;
    t.value = withDelay(
      initialDelayMs + config.delayMs,
      withTiming(
        1,
        { duration: config.durationMs, easing: Easing.linear },
        (finished) => {
          if (finished) runOnJS(respawn)();
        },
      ),
    );
    return () => cancelAnimation(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, active]);

  const animStyle = useAnimatedStyle(() => {
    const p = t.value;
    // Fall the full screen height (slightly past the bottom for clean exit).
    const translateY = p * SCREEN_H * 1.05;
    // Gentle horizontal sway via sin
    const translateX = config.driftX * Math.sin(p * Math.PI * 1.6);
    const rotate = p * config.spinDeg;
    let opacity = 0;
    if (p < 0.1) opacity = (p / 0.1) * 0.45;
    else if (p < 0.85) opacity = 0.45;
    else opacity = (1 - (p - 0.85) / 0.15) * 0.45;
    return {
      transform: [
        { translateX },
        { translateY },
        { rotate: `${rotate}deg` },
      ],
      opacity: Math.max(0, opacity),
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: "absolute", left: config.startX, top: -16 },
        animStyle,
      ]}
    >
      <Text style={{ fontSize: config.size }}>{config.glyph}</Text>
    </Animated.View>
  );
}

// ── World root ─────────────────────────────────────────────────────────────

interface BananaGroveWorldProps {
  active?: boolean;
}

export function BananaGroveWorld({ active = true }: BananaGroveWorldProps) {
  // Stagger leaf start times so they don't all fall on frame 0.
  const leaves = useMemo(
    () =>
      Array.from({ length: NUM_LEAVES }, (_, i) => ({
        id: i,
        delay: i * 1800,
      })),
    [],
  );

  return (
    <View style={styles.root} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Gradient height oversized 25% to cover Android edge-to-edge system
            bar zones where Dimensions.get("window") may underreport. */}
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H * 1.25}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, SCREEN_H)}
            colors={["#0A0A0F", "#070708", "#000000"]}
          />
        </Rect>

        {/* Vine drape — top-left edge, hanging down */}
        <VineDrape />

        {/* Barrel — bottom-left, sitting on the input-bar line */}
        <Barrel />
      </Canvas>

      {/* Vine leaves (RN text — outside Skia for proper emoji rendering). */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {VINE_LEAVES.map((leaf, i) => (
          <Text
            key={`vine-${i}`}
            style={{
              position: "absolute",
              left: leaf.x,
              top: leaf.y,
              fontSize: leaf.size,
              transform: [{ rotate: `${leaf.rot}deg` }],
              opacity: 0.85,
            }}
          >
            {leaf.glyph}
          </Text>
        ))}
      </View>

      {/* Drifting leaves — animated counterpart to Cyberpunk's embers */}
      {active && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {leaves.map((l) => (
            <LeafDrift key={l.id} active={active} initialDelayMs={l.delay} />
          ))}
        </View>
      )}

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
