/**
 * FrostGroveWorld — gradient backdrop with snowflakes that fall, tumble, and
 * naturally stack into a pile at the bottom of the screen.
 *
 * Reskin of BananaGroveWorld's pile mechanic (lanes/stacking/fall physics
 * kept verbatim) with a winter palette and no MonkeMower coupling — that
 * system renders a bespoke PNG vehicle asset and its crate-count is a
 * non-persisted, BananaGrove-exclusive UI counter with no economy tie-in, so
 * reusing it here would mean commissioning new art rather than a cheap
 * reskin. Instead, when a lane's stack crosses the threshold, the whole pile
 * simply fades out and restarts.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import { Canvas, Rect, LinearGradient, vec, Path, Group, Circle, BlurMask } from "@shopify/react-native-skia";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
  withDelay,
  withRepeat,
  cancelAnimation,
  runOnJS,
  Easing,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// ── Layout constants ────────────────────────────────────────────────────────
// Approximate height of the chat input bar's content; safe-area inset is
// added at render time. Used to compute the pile reset threshold so the pile
// fades just as it visually reaches the bottom of the latest message bubble.
const INPUT_BAR_HEIGHT = 96;

// Spawn cadence — every TICK_MS one snowflake drops.
const TICK_MS = 870;

// Stacking — each new flake in a lane adds STACK_LIFT_PX to that lane's
// stack height. 8px gives a tighter overlap than the visual size of the
// flake, so the pile reads as a compact drift rather than a tall stack.
const NUM_LANES = 20;
const LANE_WIDTH = SCREEN_W / NUM_LANES;
const STACK_LIFT_PX = 8;
const FLAKE_BASE_SIZE = 24;
const FLAKE_SIZE_VARIANCE = 8;

// Animation durations
const FALL_DURATION_MIN_MS = 1100;
const FALL_DURATION_MAX_MS = 1700;

const random = () => Math.random();

// ── Per-flake data ──────────────────────────────────────────────────────────

interface PileFlake {
  id: number;
  lane: number;          // 0..NUM_LANES-1
  stackIndex: number;    // 0 = floor, 1 = on top of one flake, etc.
  finalRot: number;      // settled rotation when landed (-50..50 deg)
  size: number;          // font size (FLAKE_BASE_SIZE..+VARIANCE)
  lateralJitter: number; // small ± offset within the lane (-4..4 px)
  fallDurationMs: number;
  tumbleSpins: number;   // total 360° rotations during fall (1-3)
}

// ── Falling flake component ─────────────────────────────────────────────────

interface FallingFlakeProps {
  flake: PileFlake;
  pileBottomPx: number;
}

function FallingFlake({ flake, pileBottomPx }: FallingFlakeProps) {
  const fall = useSharedValue(0);

  useEffect(() => {
    fall.value = withTiming(1, {
      duration: flake.fallDurationMs,
      easing: Easing.in(Easing.cubic), // accelerate as it falls — gravity feel
    });
  }, [fall, flake.fallDurationMs]);

  const laneCenterX = flake.lane * LANE_WIDTH + LANE_WIDTH / 2;
  const flakeScreenX = laneCenterX + flake.lateralJitter;

  const animStyle = useAnimatedStyle(() => {
    const tFall = fall.value;
    const fallY = interpolate(tFall, [0, 1], [-SCREEN_H * 0.95, 0]);
    const tumble = tFall * flake.tumbleSpins * 360;
    const settle = interpolate(tFall, [0.85, 1], [0, 1], Extrapolation.CLAMP);
    const rot = (1 - settle) * tumble + settle * flake.finalRot;
    return {
      transform: [
        { translateY: fallY },
        { rotate: `${rot}deg` },
      ],
    };
  });

  // Landed pixel position — left edge based on lane center + jitter, bottom
  // based on stackIndex. The translateY in animStyle handles "in flight".
  const leftPx = flakeScreenX - flake.size / 2;
  const bottomPx = pileBottomPx + flake.stackIndex * STACK_LIFT_PX;

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
      <Text style={{ fontSize: flake.size, opacity: 0.9 }}>❄️</Text>
    </Animated.View>
  );
}

// ── Pile manager ───────────────────────────────────────────────────────────

interface SnowPileProps {
  active: boolean;
}

function SnowPile({ active }: SnowPileProps) {
  // Pile sits at the very bottom edge of the screen, same as Banana Grove's
  // pile — the translucent input bar lets it be seen building up through it.
  const pileBottomPx = 0;
  const [flakes, setFlakes] = useState<PileFlake[]>([]);
  const idRef = useRef(0);
  const laneHeightsRef = useRef<number[]>(new Array(NUM_LANES).fill(0));
  const resettingRef = useRef(false);
  const pileOpacity = useSharedValue(1);

  useEffect(() => {
    if (!active) return;
    const intervalId = setInterval(() => {
      // Spawning is paused while the pile is fading out for reset.
      if (resettingRef.current) return;
      // Pick a random lane, look up its current stack count, and spawn a
      // flake destined for the top of that lane's stack.
      const lane = Math.floor(random() * NUM_LANES);
      const stackIndex = laneHeightsRef.current[lane];

      const prospectiveLaneHeight = (stackIndex + 1) * STACK_LIFT_PX;
      const triggerThreshold = INPUT_BAR_HEIGHT * 0.35;
      if (prospectiveLaneHeight >= triggerThreshold) {
        triggerReset();
        return;
      }

      // Commit the lane height + push the flake with randomized cosmetics.
      laneHeightsRef.current[lane] = stackIndex + 1;
      const flake: PileFlake = {
        id: idRef.current++,
        lane,
        stackIndex,
        finalRot: -50 + random() * 100,
        size: FLAKE_BASE_SIZE + random() * FLAKE_SIZE_VARIANCE,
        lateralJitter: (random() - 0.5) * 8,
        fallDurationMs:
          FALL_DURATION_MIN_MS +
          random() * (FALL_DURATION_MAX_MS - FALL_DURATION_MIN_MS),
        tumbleSpins: 1 + Math.floor(random() * 3),
      };
      setFlakes((prev) => [...prev, flake]);
    }, TICK_MS);
    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const triggerReset = () => {
    if (resettingRef.current) return;
    resettingRef.current = true;
    pileOpacity.value = withTiming(
      0,
      { duration: 450, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(handleResetComplete)();
      },
    );
  };

  const handleResetComplete = () => {
    laneHeightsRef.current = new Array(NUM_LANES).fill(0);
    setFlakes([]);
    resettingRef.current = false;
    pileOpacity.value = withTiming(1, { duration: 350, easing: Easing.in(Easing.cubic) });
  };

  const pileAnimStyle = useAnimatedStyle(() => ({ opacity: pileOpacity.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, pileAnimStyle]} pointerEvents="none">
      {flakes.map((f) => (
        <FallingFlake key={f.id} flake={f} pileBottomPx={pileBottomPx} />
      ))}
    </Animated.View>
  );
}

// ── Ambient drifting snow ────────────────────────────────────────────────
// Counterpart to Banana Grove's leaf drift — ❄️/✦ glyphs drift DOWN from the
// top with rotation, gentle horizontal sway, and a gradual fade. ~5 active
// at a time, independent of the pile mechanic above.

interface SnowDriftConfig {
  key: number;
  glyph: string;
  startX: number;
  size: number;
  durationMs: number;
  delayMs: number;
  driftX: number;
  spinDeg: number;
}

const SNOW_DRIFT_GLYPHS = ["❄️", "✦"];
const NUM_AMBIENT_FLAKES = 5;
const DRIFT_DURATION_MIN_MS = 9000;
const DRIFT_DURATION_MAX_MS = 16_000;

let snowDriftKeyCounter = 0;
function makeSnowDriftConfig(): SnowDriftConfig {
  return {
    key: ++snowDriftKeyCounter,
    glyph: SNOW_DRIFT_GLYPHS[Math.floor(Math.random() * SNOW_DRIFT_GLYPHS.length)],
    startX: Math.random() * (SCREEN_W - 32) + 16,
    size: 14 + Math.random() * 10,
    durationMs:
      DRIFT_DURATION_MIN_MS +
      Math.random() * (DRIFT_DURATION_MAX_MS - DRIFT_DURATION_MIN_MS),
    delayMs: Math.random() * 4000,
    driftX: (Math.random() - 0.5) * 90,
    spinDeg: (Math.random() - 0.5) * 720,
  };
}

interface SnowDriftProps {
  active: boolean;
  initialDelayMs: number;
}

function SnowDrift({ active, initialDelayMs }: SnowDriftProps) {
  const [config, setConfig] = useState<SnowDriftConfig>(() => makeSnowDriftConfig());
  const t = useSharedValue(0);

  const respawn = useCallback(() => setConfig(makeSnowDriftConfig()), []);

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

// ── Frost skyline silhouette ────────────────────────────────────────────
// Black-blue silhouette horizon — irregular snowy floor with two flanking
// pine-tree silhouettes. Sits in front of the gradient but behind everything
// else so the world reads as "moonlit winter grove" instead of a flat void.
const SKYLINE_BASE_Y = SCREEN_H - 50;
const SKYLINE_COLOR = "rgba(10, 16, 26, 0.90)"; // slightly translucent so gradient bleeds through

const SNOWY_FLOOR_PATH = (() => {
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

// Pine tree — short trunk + a canopy built from stacked triangular tiers,
// narrowing upward, each overlapping the tier below so it reads as one
// continuous conifer silhouette. Two trees flank the screen, mirroring
// Banana Grove's flanking-palms layout.
function buildPinePaths(baseX: number, mirror: boolean, height: number): { trunk: string; tiers: string[] } {
  const m = mirror ? -1 : 1;
  const trunkBottomY = SKYLINE_BASE_Y + 6;
  const trunkTopY = trunkBottomY - height * 0.18;
  const trunkTopX = baseX + 3 * m;
  const trunk = `M ${baseX} ${trunkBottomY} L ${trunkTopX} ${trunkTopY}`;

  const numTiers = 4;
  const canopyBottomY = trunkTopY + height * 0.12; // slight overlap with trunk top
  const canopyTopY = trunkBottomY - height;
  const tierSpan = canopyBottomY - canopyTopY;
  const tiers: string[] = [];
  for (let i = 0; i < numTiers; i++) {
    const bottomFrac = i / numTiers;
    const topFrac = (i + 1) / numTiers;
    const tierBottomY = canopyBottomY - bottomFrac * tierSpan;
    const tierTopY = canopyBottomY - topFrac * tierSpan - 10; // small overlap between tiers
    const widthAtBottom = 28 - i * 5; // narrower each tier up
    const jitter = (Math.abs(Math.sin(i * 7.3)) % 1 - 0.5) * 6 * m; // small organic offset, mirrored per tree
    const apexX = trunkTopX + jitter;
    tiers.push(
      `M ${apexX - widthAtBottom} ${tierBottomY} L ${apexX} ${tierTopY} L ${apexX + widthAtBottom} ${tierBottomY} Z`,
    );
  }
  return { trunk, tiers };
}

// Same heights as Banana Grove's flanking palms — towers well up into the
// chat scroll area.
const PINE_LEFT = buildPinePaths(SCREEN_W * 0.16, false, 300);
const PINE_RIGHT = buildPinePaths(SCREEN_W * 0.84, true, 338);

function FrostSkyline() {
  return (
    <Group>
      {/* Solid snowy-floor silhouette */}
      <Path path={SNOWY_FLOOR_PATH} color={SKYLINE_COLOR} />
      {/* Pine trunks — short rounded strokes */}
      <Path path={PINE_LEFT.trunk} color={SKYLINE_COLOR} style="stroke" strokeWidth={7} strokeCap="round" />
      <Path path={PINE_RIGHT.trunk} color={SKYLINE_COLOR} style="stroke" strokeWidth={8} strokeCap="round" />
      {/* Canopy tiers — filled triangles, drawn after trunks so they sit on top */}
      {PINE_LEFT.tiers.map((t, i) => (
        <Path key={`pl-${i}`} path={t} color={SKYLINE_COLOR} />
      ))}
      {PINE_RIGHT.tiers.map((t, i) => (
        <Path key={`pr-${i}`} path={t} color={SKYLINE_COLOR} />
      ))}
    </Group>
  );
}

// ── Drifting ice-light orbs ──────────────────────────────────────────────
// Counterpart to Banana Grove's dappled sunlight — 4 soft cool-blue blurred
// circles drift slowly across the upper sky simulating cold moonlight/ice
// glimmer. Same drift config as Banana Grove, only the color changes.
interface OrbConfig {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  radius: number;
  durationMs: number;
  delayMs: number;
}

const ORB_COLOR = "rgba(200, 230, 255, 0.16)";

const ORB_CONFIGS: OrbConfig[] = [
  { startX: -40,            startY: SCREEN_H * 0.18, endX: SCREEN_W + 40, endY: SCREEN_H * 0.30, radius: 50, durationMs: 22000, delayMs: 0 },
  { startX: SCREEN_W + 40,  startY: SCREEN_H * 0.42, endX: -40,           endY: SCREEN_H * 0.32, radius: 38, durationMs: 26000, delayMs: 5000 },
  { startX: SCREEN_W * 0.3, startY: -30,             endX: SCREEN_W * 0.65, endY: SCREEN_H * 0.55, radius: 28, durationMs: 30000, delayMs: 11000 },
  { startX: SCREEN_W * 0.85, startY: SCREEN_H * 0.10, endX: SCREEN_W * 0.10, endY: SCREEN_H * 0.45, radius: 44, durationMs: 28000, delayMs: 3000 },
];

function IceLightOrb({ config }: { config: OrbConfig }) {
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

function IceLightOrbs() {
  return (
    <Group>
      {ORB_CONFIGS.map((c, i) => (
        <IceLightOrb key={i} config={c} />
      ))}
    </Group>
  );
}

// ── World root ─────────────────────────────────────────────────────────────

interface FrostGroveWorldProps {
  active?: boolean;
}

export function FrostGroveWorld({ active = true }: FrostGroveWorldProps) {
  // Stagger flake start times so they don't all fall on frame 0.
  const driftFlakes = useMemo(
    () =>
      Array.from({ length: NUM_AMBIENT_FLAKES }, (_, i) => ({
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
            Winter-night palette: deep midnight blue → cold steel-blue →
            near-black navy floor. */}
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H * 1.25}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, SCREEN_H)}
            colors={["#0B1A2E", "#1C3A5C", "#0A1420"]}
          />
        </Rect>

        {/* Ice-light orbs — soft cold moonlight drifting through the sky */}
        <IceLightOrbs />

        {/* Frost skyline — flanking pine silhouettes + irregular snowy floor */}
        <FrostSkyline />
      </Canvas>

      {/* Drifting snow — ambient counterpart to Banana Grove's leaf drift */}
      {active && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {driftFlakes.map((f) => (
            <SnowDrift key={f.id} active={active} initialDelayMs={f.delay} />
          ))}
        </View>
      )}

      {/* Falling + stacking pile — fades and restarts on threshold instead
          of the MonkeMower harvest mechanic (see file docblock). */}
      <SnowPile active={active} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject },
});
