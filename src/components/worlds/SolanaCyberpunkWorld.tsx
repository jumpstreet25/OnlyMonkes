/**
 * SolanaCyberpunkWorld — premium reactive layer (Tier 3).
 *
 * Composition:
 *   - Skia gradient backdrop (purple → teal).
 *   - Drifting neon grid (vertical scroll, infinite loop).
 *   - Bright glyph particles ("data packets") that travel along grid lines —
 *     8 packets cycling neon colors, fading in/out at the line edges.
 *   - Rare lightning crack across the screen every 30–60s with a brief
 *     full-screen cyan flash.
 *   - Tiny $SOL/$SKR ember glyphs (◎ ◈ $SOL $SKR) drifting upward like
 *     embers — easter-egg level, mostly transparent.
 *
 * Everything that animates uses Reanimated SharedValues + Skia derived
 * values so it runs on the UI thread. The ember overlay is a separate RN
 * Animated.View layer because Skia text needs fonts pre-loaded into Skia
 * and text rendering quality is better via the native RN text path.
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
  Circle,
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

// ── Data packets ───────────────────────────────────────────────────────────
const NUM_PACKETS = 8;
const PACKET_DURATION_MIN_MS = 1800;
const PACKET_DURATION_MAX_MS = 3400;
const PACKET_COLORS = ["#14F195", "#00D4FF", "#FF3DFF", "#FFE066"];
const PACKET_CORE_RADIUS = 2.5;
const PACKET_GLOW_RADIUS = 7;

// ── Lightning ──────────────────────────────────────────────────────────────
const LIGHTNING_INTERVAL_MIN_MS = 30_000;
const LIGHTNING_INTERVAL_MAX_MS = 60_000;
const LIGHTNING_FLASH_DURATION_MS = 220;

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

// ── Data packet ────────────────────────────────────────────────────────────
// Travels along a single grid line (horizontal OR vertical), fading in/out
// at the edges. Respawns with new line + color when the timing completes.

interface PacketConfig {
  key: number;
  axis: "h" | "v";
  lineCoord: number; // y-pos for horizontal lines, x-pos for vertical
  fromStart: boolean; // true = travel forward, false = reverse
  color: string;
  durationMs: number;
}

let packetKeyCounter = 0;
function makePacketConfig(): PacketConfig {
  const axis: "h" | "v" = random() < 0.5 ? "h" : "v";
  const lines =
    axis === "h"
      ? Math.max(2, Math.floor(SCREEN_H / GRID_SPACING))
      : Math.max(2, Math.floor(SCREEN_W / GRID_SPACING));
  // Skip the very edge lines so packets stay visually inside the screen.
  const idx = 1 + Math.floor(random() * (lines - 1));
  return {
    key: ++packetKeyCounter,
    axis,
    lineCoord: idx * GRID_SPACING,
    fromStart: random() < 0.5,
    color: pick(PACKET_COLORS),
    durationMs:
      PACKET_DURATION_MIN_MS +
      random() * (PACKET_DURATION_MAX_MS - PACKET_DURATION_MIN_MS),
  };
}

interface DataPacketProps {
  active: boolean;
  initialDelayMs: number;
}

function DataPacket({ active, initialDelayMs }: DataPacketProps) {
  const [config, setConfig] = useState<PacketConfig>(() => makePacketConfig());
  const t = useSharedValue(0);

  const respawn = useCallback(() => {
    setConfig(makePacketConfig());
  }, []);

  useEffect(() => {
    if (!active) {
      cancelAnimation(t);
      return;
    }
    t.value = 0;
    t.value = withDelay(
      initialDelayMs,
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

  const cx = useDerivedValue(() => {
    if (config.axis === "h") {
      const start = config.fromStart ? 0 : SCREEN_W;
      const end = config.fromStart ? SCREEN_W : 0;
      return start + (end - start) * t.value;
    }
    return config.lineCoord;
  }, [config]);

  const cy = useDerivedValue(() => {
    if (config.axis === "v") {
      const start = config.fromStart ? 0 : SCREEN_H;
      const end = config.fromStart ? SCREEN_H : 0;
      return start + (end - start) * t.value;
    }
    return config.lineCoord;
  }, [config]);

  // Edge fade: 0 → 1 over first 12%, 1 → 0 over last 12%, hold in middle.
  const opacity = useDerivedValue(() => {
    const p = t.value;
    if (p < 0.12) return p / 0.12;
    if (p > 0.88) return (1 - p) / 0.12;
    return 1;
  });

  return (
    <Group opacity={opacity}>
      {/* Soft glow halo */}
      <Circle cx={cx} cy={cy} r={PACKET_GLOW_RADIUS} color={config.color} opacity={0.35}>
        <BlurMask blur={6} style="normal" />
      </Circle>
      {/* Bright core */}
      <Circle cx={cx} cy={cy} r={PACKET_CORE_RADIUS} color="#FFFFFF" />
      <Circle cx={cx} cy={cy} r={PACKET_CORE_RADIUS * 1.6} color={config.color} opacity={0.7} />
    </Group>
  );
}

// ── Lightning ──────────────────────────────────────────────────────────────
// Triggers every 30-60s. Renders a jagged path + screen-wide flash for
// ~220ms, then disappears. Path regenerated each strike.

function makeLightningPath(): string {
  const startX = SCREEN_W * (0.25 + random() * 0.5);
  const endX = SCREEN_W * (0.15 + random() * 0.7);
  const segments = 7 + Math.floor(random() * 3);
  const dy = SCREEN_H / segments;
  const parts: string[] = [`M${startX} 0`];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const baseX = startX + (endX - startX) * t;
    const jitter = (random() - 0.5) * 90;
    parts.push(`L${baseX + jitter} ${i * dy}`);
  }
  return parts.join(" ");
}

interface LightningProps {
  active: boolean;
}

function Lightning({ active }: LightningProps) {
  const [strike, setStrike] = useState<{ path: string; key: number } | null>(null);
  const alpha = useSharedValue(0);
  const flashAlpha = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      setStrike(null);
      cancelAnimation(alpha);
      cancelAnimation(flashAlpha);
      return;
    }

    let alive = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const fire = () => {
      if (!alive) return;
      const path = makeLightningPath();
      const key = Date.now();
      setStrike({ path, key });
      alpha.value = 0;
      flashAlpha.value = 0;
      alpha.value = withSequence(
        withTiming(1, { duration: 60, easing: Easing.out(Easing.quad) }),
        withTiming(0.7, { duration: 50 }),
        withTiming(0, { duration: LIGHTNING_FLASH_DURATION_MS - 110 }),
      );
      flashAlpha.value = withSequence(
        withTiming(0.18, { duration: 60 }),
        withTiming(0, { duration: 200 }),
      );
      // Clear the strike from React state after animation completes so the
      // path node unmounts; new strikes regenerate the path fresh.
      setTimeout(() => {
        if (alive) setStrike(null);
      }, LIGHTNING_FLASH_DURATION_MS + 50);

      // Schedule next strike
      const wait =
        LIGHTNING_INTERVAL_MIN_MS +
        random() * (LIGHTNING_INTERVAL_MAX_MS - LIGHTNING_INTERVAL_MIN_MS);
      timeoutId = setTimeout(fire, wait);
    };

    // First strike — give the user 8-20s of calm before the first one.
    timeoutId = setTimeout(fire, 8000 + random() * 12000);

    return () => {
      alive = false;
      if (timeoutId) clearTimeout(timeoutId);
      cancelAnimation(alpha);
      cancelAnimation(flashAlpha);
    };
  }, [active, alpha, flashAlpha]);

  if (!strike) return null;
  return (
    <>
      {/* Cyan screen flash */}
      <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H} color="#00D4FF" opacity={flashAlpha} />
      {/* Bolt — outer glow + inner bright core */}
      <Group opacity={alpha}>
        <Path path={strike.path} color="#7DDFFF" style="stroke" strokeWidth={6} opacity={0.35}>
          <BlurMask blur={8} style="normal" />
        </Path>
        <Path path={strike.path} color="#FFFFFF" style="stroke" strokeWidth={1.6} />
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

  // Stagger packet/ember start times so they don't all fire on frame 0.
  const packets = useMemo(
    () =>
      Array.from({ length: NUM_PACKETS }, (_, i) => ({
        id: i,
        delay: i * 250,
      })),
    [],
  );
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
        {/* Gradient backdrop */}
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H}>
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

        {/* Data packets */}
        {active &&
          packets.map((p) => (
            <DataPacket key={p.id} active={active} initialDelayMs={p.delay} />
          ))}

        {/* Lightning */}
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
