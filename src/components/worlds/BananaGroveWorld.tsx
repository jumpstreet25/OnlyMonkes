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
import { Canvas, Rect, LinearGradient, vec, Path, Group, Circle, BlurMask } from "@shopify/react-native-skia";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  useDerivedValue,
  withTiming,
  withDelay,
  withRepeat,
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

// ── Lower-third clutter — drifting leaves only ─────────────────────────────
// (Vine drape removed 2026-05-08 — read as cluttered/odd against the new
//  Tier 1 background; replaced by the cleaner palm silhouettes that already
//  carry the foliage identity from the top-down jungle horizon.)
// (Barrel prop removed 2026-05-07 — read as a flat brown board next to
// the input-bar PFP rather than as a 3D barrel. Will revisit with a
// proper curved silhouette if we want a scenery prop in this world.)

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

// ── Jungle skyline silhouette (Tier 1 foundation, 2026-05-08) ──────────────
// Black-green silhouette horizon at SCREEN_H * ~0.7 — irregular jungle floor
// with two flanking palm-tree silhouettes. Sits in front of the gradient but
// behind everything else so the world reads as "tropical scene at dusk"
// instead of "near-black void with chrome."
// v3 2026-05-08 — raised so the floor visibly meets the banana pile (user
// asked for floor at "top of the banana pile so the bananas are on the
// jungle floor"). Pile + mower live at the very bottom of the screen
// (pileBottomPx=0); raising SKYLINE_BASE_Y to SCREEN_H - 50 puts the
// floor's TOP edge at SCREEN_H - 46 to SCREEN_H - 24 (varying with the
// bump pattern), so the bananas appear to be resting on the visible
// jungle floor when seen through the translucent input bar.
const SKYLINE_BASE_Y = SCREEN_H - 50;
const SKYLINE_COLOR = "rgba(8, 18, 12, 0.92)"; // slightly translucent so gradient bleeds through

const JUNGLE_FLOOR_PATH = (() => {
  const segments = 18;
  const step = SCREEN_W / segments;
  const variance = 22;
  let p = `M 0 ${SKYLINE_BASE_Y + 12}`;
  for (let i = 1; i <= segments; i++) {
    const x = step * i;
    const h = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = SKYLINE_BASE_Y + 4 + h * variance;
    p += ` L ${x} ${y}`;
  }
  p += ` L ${SCREEN_W} ${SCREEN_H} L 0 ${SCREEN_H} Z`;
  return p;
})();

// Palm tree — curved trunk + radiating fronds. Two trees flank the screen so
// the foreground frames the chat instead of being a single isolated tree.
function buildPalmPaths(baseX: number, mirror: boolean, height: number): { trunk: string; fronds: string[] } {
  const m = mirror ? -1 : 1;
  const trunkBottomY = SKYLINE_BASE_Y + 6;
  const trunkTopX = baseX + 14 * m;
  const trunkTopY = trunkBottomY - height;
  const trunk = `M ${baseX} ${trunkBottomY} Q ${baseX + 6 * m} ${trunkBottomY - height / 2} ${trunkTopX} ${trunkTopY}`;
  const angles = [-150, -118, -85, -55, -30, 0]; // 6 fronds — fan covering the canopy hemisphere
  const fronds: string[] = [];
  for (const a of angles) {
    const rad = (a * Math.PI) / 180;
    const len = 52 + (Math.abs(Math.sin(a * 4.7)) % 1) * 14; // small variance per frond
    const endX = trunkTopX + Math.cos(rad) * len * m; // mirror flips horizontal direction
    const endY = trunkTopY + Math.sin(rad) * len;
    const ctrlX = trunkTopX + (Math.cos(rad) * len * 0.5 + Math.sin(rad) * 14) * m;
    const ctrlY = trunkTopY + Math.sin(rad) * len * 0.5 - Math.cos(rad) * 14;
    fronds.push(`M ${trunkTopX} ${trunkTopY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`);
  }
  return { trunk, fronds };
}

// Taller trees (v4 2026-05-08) — bumped 50% from v3's 200/225 to 300/338,
// reading as towering jungle palms whose fronds reach well up into the
// chat scroll area.
const PALM_LEFT = buildPalmPaths(SCREEN_W * 0.16, false, 300);
const PALM_RIGHT = buildPalmPaths(SCREEN_W * 0.84, true, 338);

function JungleSkyline() {
  return (
    <Group>
      {/* Solid jungle-floor silhouette */}
      <Path path={JUNGLE_FLOOR_PATH} color={SKYLINE_COLOR} />
      {/* Palm trunks — thick rounded strokes */}
      <Path path={PALM_LEFT.trunk} color={SKYLINE_COLOR} style="stroke" strokeWidth={9} strokeCap="round" />
      <Path path={PALM_RIGHT.trunk} color={SKYLINE_COLOR} style="stroke" strokeWidth={10} strokeCap="round" />
      {/* Fronds — lighter strokes, drawn after trunks so they sit on top */}
      {PALM_LEFT.fronds.map((f, i) => (
        <Path key={`pl-${i}`} path={f} color={SKYLINE_COLOR} style="stroke" strokeWidth={5} strokeCap="round" />
      ))}
      {PALM_RIGHT.fronds.map((f, i) => (
        <Path key={`pr-${i}`} path={f} color={SKYLINE_COLOR} style="stroke" strokeWidth={5} strokeCap="round" />
      ))}
    </Group>
  );
}

// ── Drifting dappled-light orbs (Tier 1 atmosphere, 2026-05-08) ────────────
// Counterpart to Cyberpunk's lightning storms — 4 soft yellow blurred circles
// drift slowly across the upper canopy region simulating sunlight filtering
// through leaves. Warm continuous instead of violent episodic. Animated on
// the UI thread via Reanimated SharedValues fed into Skia.
interface OrbConfig {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  radius: number;
  durationMs: number;
  delayMs: number;
}

const ORB_COLOR = "rgba(255, 220, 130, 0.18)";

const ORB_CONFIGS: OrbConfig[] = [
  { startX: -40,            startY: SCREEN_H * 0.18, endX: SCREEN_W + 40, endY: SCREEN_H * 0.30, radius: 50, durationMs: 22000, delayMs: 0 },
  { startX: SCREEN_W + 40,  startY: SCREEN_H * 0.42, endX: -40,           endY: SCREEN_H * 0.32, radius: 38, durationMs: 26000, delayMs: 5000 },
  { startX: SCREEN_W * 0.3, startY: -30,             endX: SCREEN_W * 0.65, endY: SCREEN_H * 0.55, radius: 28, durationMs: 30000, delayMs: 11000 },
  { startX: SCREEN_W * 0.85, startY: SCREEN_H * 0.10, endX: SCREEN_W * 0.10, endY: SCREEN_H * 0.45, radius: 44, durationMs: 28000, delayMs: 3000 },
];

function DappledLightOrb({ config }: { config: OrbConfig }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(
      config.delayMs,
      withRepeat(
        withTiming(1, { duration: config.durationMs, easing: Easing.inOut(Easing.sin) }),
        -1,
        true, // reverse — orb drifts back along the same path, like wind
      ),
    );
    return () => cancelAnimation(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cx = useDerivedValue(() => config.startX + (config.endX - config.startX) * t.value);
  const cy = useDerivedValue(() => config.startY + (config.endY - config.startY) * t.value);

  return (
    <Circle cx={cx} cy={cy} r={config.radius} color={ORB_COLOR}>
      <BlurMask blur={config.radius * 0.85} style="solid" />
    </Circle>
  );
}

function DappledLightOrbs() {
  return (
    <Group>
      {ORB_CONFIGS.map((c, i) => (
        <DappledLightOrb key={i} config={c} />
      ))}
    </Group>
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
            bar zones where Dimensions.get("window") may underreport.
            Tropical dusk palette (Tier 1, 2026-05-08): twilight sky → sunset
            orange band at the horizon → deep jungle floor. The mid-band orange
            sits right around the skyline silhouette so the foreground reads as
            silhouetted jungle against a setting sun. */}
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H * 1.25}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, SCREEN_H)}
            colors={["#3A2418", "#7A4A20", "#0D2818"]}
          />
        </Rect>

        {/* Dappled-light orbs — soft warm sunlight filtering through canopy */}
        <DappledLightOrbs />

        {/* Jungle skyline — flanking palm silhouettes + irregular jungle floor */}
        <JungleSkyline />
      </Canvas>

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
