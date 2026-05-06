/**
 * SolanaCyberpunkWorld — premium reactive layer.
 *
 * Composition:
 *   - Skia gradient backdrop (purple → teal).
 *   - Drifting neon grid (vertical scroll, infinite loop).
 *   - Lightning storms — primary bolt + after-shock on a slightly offset
 *     path every 8–20s, with a strong cyan full-screen flash and a
 *     residual neon trail that fades out over ~400ms.
 *   - Tiny $SOL/$SKR ember glyphs (◎ ◈ $SOL $SKR) drifting upward like
 *     embers — easter-egg level, mostly transparent.
 *
 * Animation runs on the UI thread via Reanimated SharedValues + Skia
 * derived values. The ember overlay is a separate RN Animated.View layer
 * because Skia text needs fonts pre-loaded into Skia and text rendering
 * quality is better via the native RN text path.
 *
 * The earlier "data packet" dots traveling along grid lines were removed
 * 2026-05-06 — too busy; the world reads cleaner with just the storms.
 */

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import {
  Canvas,
  Rect,
  LinearGradient,
  vec,
  Path,
  Group,
  BlurMask,
} from "@shopify/react-native-skia";
import Animated, {
  useSharedValue,
  useDerivedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  cancelAnimation,
  runOnJS,
  Easing,
} from "react-native-reanimated";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// ── Grid ───────────────────────────────────────────────────────────────────
const GRID_SPACING = 38;
const DRIFT_DURATION_MS = 14_000;

// ── Lightning ──────────────────────────────────────────────────────────────
const LIGHTNING_INTERVAL_MIN_MS = 8_000;
const LIGHTNING_INTERVAL_MAX_MS = 20_000;
const LIGHTNING_BOLT_FADE_MS = 400;       // bolt lingers after the flash
const LIGHTNING_AFTERSHOCK_DELAY_MS = 140; // secondary strike after main

// ── Embers ─────────────────────────────────────────────────────────────────
const NUM_EMBERS = 6;
const EMBER_DURATION_MIN_MS = 9000;
const EMBER_DURATION_MAX_MS = 15_000;
const EMBER_GLYPHS = ["◎", "◈", "▲", "$SOL", "$SKR", "◇"];
const EMBER_COLORS = ["#14F195", "#9945FF", "#00D4FF"];

const random = () => Math.random();
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(random() * arr.length)];

function buildGridPath(): string {
  const parts: string[] = [];
  for (let x = 0; x <= SCREEN_W; x += GRID_SPACING) {
    parts.push(`M${x} 0 L${x} ${SCREEN_H + GRID_SPACING}`);
  }
  for (let y = 0; y <= SCREEN_H + GRID_SPACING; y += GRID_SPACING) {
    parts.push(`M0 ${y} L${SCREEN_W} ${y}`);
  }
  return parts.join(" ");
}

// ── Lightning ──────────────────────────────────────────────────────────────
// Storm cycle: every 8-20s, fire a primary bolt + aftershock on a slightly
// offset path 140ms later. Each bolt has a punchy cyan full-screen flash and
// the bolt itself fades over ~400ms so the residual neon trail lingers.

function makeLightningPath(jitterScale = 1): string {
  const startX = SCREEN_W * (0.2 + random() * 0.6);
  const endX = SCREEN_W * (0.15 + random() * 0.7);
  const segments = 7 + Math.floor(random() * 3);
  const dy = SCREEN_H / segments;
  const parts: string[] = [`M${startX} 0`];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const baseX = startX + (endX - startX) * t;
    const jitter = (random() - 0.5) * 90 * jitterScale;
    parts.push(`L${baseX + jitter} ${i * dy}`);
  }
  return parts.join(" ");
}

interface BoltState {
  primaryPath: string;
  aftershockPath: string;
  key: number;
}

interface LightningProps {
  active: boolean;
}

function Lightning({ active }: LightningProps) {
  const [bolt, setBolt] = useState<BoltState | null>(null);
  // Primary bolt opacity — strong onset, slow ~400ms fade so the trail lingers.
  const primaryAlpha = useSharedValue(0);
  // Aftershock — fires 140ms after primary on the offset path, shorter fade.
  const aftershockAlpha = useSharedValue(0);
  // Cyan full-screen flash — strong (0.32) on primary, softer follow-up.
  const flashAlpha = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      setBolt(null);
      cancelAnimation(primaryAlpha);
      cancelAnimation(aftershockAlpha);
      cancelAnimation(flashAlpha);
      return;
    }

    let alive = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let clearTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const fire = () => {
      if (!alive) return;
      const next: BoltState = {
        primaryPath: makeLightningPath(1),
        aftershockPath: makeLightningPath(1.4),
        key: Date.now(),
      };
      setBolt(next);

      // Primary: punch in over 50ms, hold briefly, then linger-fade for ~350ms.
      primaryAlpha.value = 0;
      primaryAlpha.value = withSequence(
        withTiming(1, { duration: 50, easing: Easing.out(Easing.quad) }),
        withTiming(0.85, { duration: 40 }),
        withTiming(0, { duration: LIGHTNING_BOLT_FADE_MS - 90, easing: Easing.in(Easing.quad) }),
      );

      // Aftershock: same envelope, delayed.
      aftershockAlpha.value = 0;
      aftershockAlpha.value = withDelay(
        LIGHTNING_AFTERSHOCK_DELAY_MS,
        withSequence(
          withTiming(0.9, { duration: 40, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }),
        ),
      );

      // Flash: strong primary + softer secondary on aftershock.
      flashAlpha.value = 0;
      flashAlpha.value = withSequence(
        withTiming(0.32, { duration: 50 }),
        withTiming(0.05, { duration: 80 }),
        withDelay(
          LIGHTNING_AFTERSHOCK_DELAY_MS - 130,
          withTiming(0.18, { duration: 40 }),
        ),
        withTiming(0, { duration: 260 }),
      );

      const totalDuration =
        LIGHTNING_AFTERSHOCK_DELAY_MS + LIGHTNING_BOLT_FADE_MS + 80;
      clearTimeoutId = setTimeout(() => {
        if (alive) setBolt(null);
      }, totalDuration);

      const wait =
        LIGHTNING_INTERVAL_MIN_MS +
        random() * (LIGHTNING_INTERVAL_MAX_MS - LIGHTNING_INTERVAL_MIN_MS);
      timeoutId = setTimeout(fire, wait);
    };

    // First strike: 4-10s calm before the storm starts (was 8-20s).
    timeoutId = setTimeout(fire, 4000 + random() * 6000);

    return () => {
      alive = false;
      if (timeoutId) clearTimeout(timeoutId);
      if (clearTimeoutId) clearTimeout(clearTimeoutId);
      cancelAnimation(primaryAlpha);
      cancelAnimation(aftershockAlpha);
      cancelAnimation(flashAlpha);
    };
  }, [active, primaryAlpha, aftershockAlpha, flashAlpha]);

  if (!bolt) return null;
  return (
    <>
      {/* Cyan screen flash — covers the whole canvas */}
      <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H} color="#00D4FF" opacity={flashAlpha} />
      {/* Primary bolt — outer glow + inner bright core */}
      <Group opacity={primaryAlpha}>
        <Path path={bolt.primaryPath} color="#7DDFFF" style="stroke" strokeWidth={7} opacity={0.4}>
          <BlurMask blur={10} style="normal" />
        </Path>
        <Path path={bolt.primaryPath} color="#FFFFFF" style="stroke" strokeWidth={1.8} />
      </Group>
      {/* Aftershock — slightly offset path, thinner */}
      <Group opacity={aftershockAlpha}>
        <Path path={bolt.aftershockPath} color="#A6E8FF" style="stroke" strokeWidth={5} opacity={0.32}>
          <BlurMask blur={8} style="normal" />
        </Path>
        <Path path={bolt.aftershockPath} color="#FFFFFF" style="stroke" strokeWidth={1.2} />
      </Group>
    </>
  );
}

// ── Ember glyph ────────────────────────────────────────────────────────────
// Tiny $SOL/$SKR/◎/◈ glyphs drifting up from the bottom edge. RN Text +
// Reanimated translateY/opacity. Easter-egg subtle — rarely the first thing
// you notice, but adds warmth + layered depth.

interface EmberConfig {
  key: number;
  glyph: string;
  startX: number;
  size: number;
  color: string;
  durationMs: number;
  delayMs: number;
  driftX: number; // horizontal drift over the lifetime
  rotation: number;
}

let emberKeyCounter = 0;
function makeEmberConfig(): EmberConfig {
  return {
    key: ++emberKeyCounter,
    glyph: pick(EMBER_GLYPHS),
    startX: random() * (SCREEN_W - 40) + 20,
    size: 9 + random() * 6,
    color: pick(EMBER_COLORS),
    durationMs:
      EMBER_DURATION_MIN_MS +
      random() * (EMBER_DURATION_MAX_MS - EMBER_DURATION_MIN_MS),
    delayMs: random() * 4000,
    driftX: (random() - 0.5) * 60,
    rotation: (random() - 0.5) * 14,
  };
}

interface EmberProps {
  active: boolean;
  initialDelayMs: number;
}

function Ember({ active, initialDelayMs }: EmberProps) {
  const [config, setConfig] = useState<EmberConfig>(() => makeEmberConfig());
  const t = useSharedValue(0);

  const respawn = useCallback(() => {
    setConfig(makeEmberConfig());
  }, []);

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
        { duration: config.durationMs, easing: Easing.out(Easing.quad) },
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
    // Rise 75% of screen height, with horizontal drift.
    const translateY = -p * SCREEN_H * 0.75;
    const translateX = config.driftX * p;
    // Fade in over first 15%, hold at 0.32 max, fade out over last 30%.
    let opacity = 0;
    if (p < 0.15) opacity = (p / 0.15) * 0.32;
    else if (p < 0.7) opacity = 0.32;
    else opacity = (1 - (p - 0.7) / 0.3) * 0.32;
    return {
      transform: [
        { translateX },
        { translateY },
        { rotate: `${config.rotation}deg` },
      ],
      opacity: Math.max(0, opacity),
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: config.startX,
          bottom: -10,
        },
        animStyle,
      ]}
    >
      <Text style={{ fontSize: config.size, color: config.color, fontWeight: "600", letterSpacing: 0.5 }}>
        {config.glyph}
      </Text>
    </Animated.View>
  );
}

// ── World root ─────────────────────────────────────────────────────────────

interface SolanaCyberpunkWorldProps {
  active?: boolean;
}

export function SolanaCyberpunkWorld({ active = true }: SolanaCyberpunkWorldProps) {
  const gridPath = useMemo(buildGridPath, []);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(progress);
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: DRIFT_DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [active, progress]);

  const transform = useDerivedValue(
    () => [{ translateY: -GRID_SPACING + progress.value * GRID_SPACING }],
    [progress],
  );

  // Stagger ember start times so they don't all fire on frame 0.
  const embers = useMemo(
    () =>
      Array.from({ length: NUM_EMBERS }, (_, i) => ({
        id: i,
        delay: i * 1400,
      })),
    [],
  );

  return (
    <View style={styles.root} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Gradient backdrop — oversized to cover edge-to-edge Android system
            bars. Dimensions.get("window") may underreport on some devices
            (gesture nav, translucent status bar, etc.); painting a Rect
            larger than the screen guarantees no themeBg leaks at the bottom
            edge near the app switcher. The gradient end vector still points
            to (SCREEN_W, SCREEN_H) so the visible portion looks the same;
            beyond it the gradient saturates at the end color (#0f7a85). */}
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H * 1.25}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(SCREEN_W, SCREEN_H)}
            colors={["#1a0533", "#2a1561", "#0a4a5e", "#0f7a85"]}
          />
        </Rect>

        {/* Drifting grid */}
        {active ? (
          <Group transform={transform}>
            <Path
              path={gridPath}
              color="rgba(20,241,149,0.18)"
              style="stroke"
              strokeWidth={0.75}
            />
          </Group>
        ) : (
          <Path
            path={gridPath}
            color="rgba(20,241,149,0.18)"
            style="stroke"
            strokeWidth={0.75}
          />
        )}

        {/* Lightning storms */}
        <Lightning active={active} />
      </Canvas>

      {/* Ember overlay (RN text — outside Skia) */}
      {active && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {embers.map((e) => (
            <Ember key={e.id} active={active} initialDelayMs={e.delay} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject },
});
