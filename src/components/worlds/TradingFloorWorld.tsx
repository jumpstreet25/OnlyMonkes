/**
 * TradingFloorWorld — live-printing candlestick chart that fills the chat bg.
 *
 * Design (per Banana Grove design discussion 2026-05-06):
 *   - Single foreground row (no parallax back row).
 *   - Each candle "prints" over 4s on the rightmost slot: body height grows
 *     from 0 (open price line) to full close-price extent. Green candles grow
 *     UP from the open; red candles grow DOWN from the open.
 *   - When a candle finishes printing, the whole row shifts left by one
 *     candle-stride (smooth ~250ms transition) and a fresh candle starts
 *     forming on the right. Already-printed candles stay frozen during their
 *     own printing window — they only move when the row shifts.
 *   - 8 chart "patterns" (steady climb, pump-and-dump, V recovery, etc.)
 *     cycle randomly so the chart shape stays varied without looking random.
 *   - Pre-filled with VISIBLE_COUNT candles on mount so the chart is never
 *     empty when the user equips the world.
 *
 * Wicks render at full extent immediately (high/low pre-known); only the body
 * animates during formation. Candles drift off the left edge and unmount
 * automatically when the array exceeds VISIBLE_COUNT * 2.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import {
  Canvas,
  Rect,
  LinearGradient,
  vec,
} from "@shopify/react-native-skia";
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// ── Layout constants ────────────────────────────────────────────────────────
const CANDLE_W = 16;
const CANDLE_GAP = 7;
const STRIDE = CANDLE_W + CANDLE_GAP;
const CHART_TOP_INSET = 110;       // clears chat header
const INPUT_BAR_HEIGHT = 96;       // matches chat input bar
const FORMATION_MS = 4000;         // each candle prints over 4s
const SHIFT_MS = 250;              // smooth row shift between prints
const VISIBLE_COUNT = Math.ceil(SCREEN_W / STRIDE) + 2; // +2 buffer
const MAX_CANDLES = VISIBLE_COUNT + 4;
const BODY_OPACITY = 0.5;
const WICK_OPACITY = 0.45;
const GREEN = "#10B981";
const RED = "#EF4444";

// ── Pattern engine ──────────────────────────────────────────────────────────
//
// Each pattern is a function (prevClose, stepIndex, patternLength) → close.
// The wickFactor scales how much the high/low extend beyond the body — a
// gentle nudge per-pattern to give each one its own visual character.

const PATTERN_LENGTH = 14;
const rand = () => Math.random();

// Mean-reverting clamp. Hard-clamps to [lo, hi] for safety, but ALSO dampens
// any delta that would push the price further toward an edge. This keeps
// prices spending most of their time in the playable middle range and stops
// the chart from saturating at one extreme (which used to make every candle
// after the first ~5 look like a doji "+" sign pinned to the top/bottom).
function meanReverted(prev: number, delta: number, lo = 0.05, hi = 0.95): number {
  const center = 0.5;
  // Distance from center, normalized to [0, 1].
  const distance = Math.abs(prev - center) / 0.45;
  // If we're already past 65% of the way to an edge, halve any delta that
  // pushes further in the same direction. Past 85%, quarter it.
  const pushingFurther =
    (prev > center && delta > 0) || (prev < center && delta < 0);
  let damped = delta;
  if (pushingFurther) {
    if (distance > 0.85) damped *= 0.25;
    else if (distance > 0.65) damped *= 0.5;
  }
  return Math.max(lo, Math.min(hi, prev + damped));
}

// Convenience wrapper so pattern definitions stay readable.
const clamp = (prev: number, delta: number) => meanReverted(prev, delta);

interface PatternStep {
  close: number;
  wickFactor?: number; // multiplier on default wick range (default 1)
}

type Pattern = (prev: number, step: number) => PatternStep;

const PATTERNS: Pattern[] = [
  // 1. Steady bull climb
  (prev) => ({ close: clamp(prev, 0.015 + rand() * 0.04) }),
  // 2. Pump → dump → recovery
  (prev, i) => {
    if (i < 4) return { close: clamp(prev, 0.05 + rand() * 0.05), wickFactor: 1.4 };
    if (i < 7) return { close: clamp(prev, -0.04 - rand() * 0.05), wickFactor: 1.4 };
    return { close: clamp(prev, 0.025 + rand() * 0.04) };
  },
  // 3. Bullish breakout — tight consolidation then strong rally
  (prev, i) => {
    if (i < 3) return { close: clamp(prev, (rand() - 0.5) * 0.02), wickFactor: 0.6 };
    return { close: clamp(prev, 0.04 + rand() * 0.05), wickFactor: 1.2 };
  },
  // 4. Choppy sideways
  (prev) => ({ close: clamp(prev, (rand() - 0.5) * 0.06), wickFactor: 1.5 }),
  // 5. V recovery — dump, doji bottom, strong recovery
  (prev, i) => {
    if (i < 4) return { close: clamp(prev, -0.03 - rand() * 0.04) };
    if (i < 5) return { close: clamp(prev, (rand() - 0.5) * 0.012) };
    return { close: clamp(prev, 0.045 + rand() * 0.04) };
  },
  // 6. Strong rally — big greens, magnitude grows
  (prev, i) => {
    const magnitude = 0.025 + (i / PATTERN_LENGTH) * 0.05;
    return { close: clamp(prev, magnitude), wickFactor: 1.1 };
  },
  // 7. Bull flag — pole, flag (sideways), resume
  (prev, i) => {
    const phase = i / PATTERN_LENGTH;
    if (phase < 0.3) return { close: clamp(prev, 0.04 + rand() * 0.02) };
    if (phase < 0.6) return { close: clamp(prev, (rand() - 0.5) * 0.018), wickFactor: 0.8 };
    return { close: clamp(prev, 0.04 + rand() * 0.02) };
  },
  // 8. Fakeout — green run, brief red trap, rally resumes
  (prev, i) => {
    if (i < 3) return { close: clamp(prev, 0.04 + rand() * 0.02) };
    if (i < 5) return { close: clamp(prev, -0.025 - rand() * 0.025), wickFactor: 1.3 };
    return { close: clamp(prev, 0.045 + rand() * 0.04) };
  },
];

interface CandleData {
  id: number;
  open: number;
  close: number;
  high: number;
  low: number;
}

// ── Per-candle component ────────────────────────────────────────────────────

interface CandleViewProps {
  candle: CandleData;
  slotIndex: number;        // 0 = newest (rightmost), grows leftward
  chartTop: number;
  chartHeight: number;
  baseRightX: number;       // x-coord of slot 0's left edge
}

function CandleView({ candle, slotIndex, chartTop, chartHeight, baseRightX }: CandleViewProps) {
  // Snapshot whether this candle was MOUNTED at the freshly-printing slot.
  // If yes, animate body scaleY from 0 → 1 over FORMATION_MS. If no (pre-
  // filled candles or candles created during a batch refill), they're already
  // "printed" — render at full body size immediately.
  const isFreshRef = useRef(slotIndex === 0);
  const isFresh = isFreshRef.current;

  const formation = useSharedValue(isFresh ? 0 : 1);
  const slot = useSharedValue(slotIndex);

  // One-shot formation animation on initial mount when fresh.
  useEffect(() => {
    if (isFresh) {
      formation.value = withTiming(1, {
        duration: FORMATION_MS,
        easing: Easing.out(Easing.cubic),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Animate to new slot when row shifts.
  useEffect(() => {
    slot.value = withTiming(slotIndex, {
      duration: SHIFT_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [slotIndex, slot]);

  const isGreen = candle.close >= candle.open;
  const color = isGreen ? GREEN : RED;

  const yFor = (norm: number) => chartTop + (1 - norm) * chartHeight;
  const openY = yFor(candle.open);
  const closeY = yFor(candle.close);
  const highY = yFor(candle.high);
  const lowY = yFor(candle.low);
  const bodyHeightFull = Math.max(1.5, Math.abs(openY - closeY));

  // Position the candle column at slot 0 (rightmost), then animate translateX
  // leftward by `slot * STRIDE`. So slot=0 → no shift, slot=5 → 5 strides left.
  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -slot.value * STRIDE }],
  }));

  // Body grows from open price line: green grows UP, red grows DOWN. We can't
  // use `transform-origin` reliably across RN versions, so we explicitly
  // compute top + height from the formation progress.
  const bodyStyle = useAnimatedStyle(() => {
    const h = bodyHeightFull * formation.value;
    const top = isGreen ? openY - h : openY;
    return { top, height: Math.max(0.5, h) };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: baseRightX,
          top: 0,
          width: CANDLE_W,
          height: SCREEN_H,
        },
        containerStyle,
      ]}
    >
      {/* Wick — full extent immediately (high/low are pre-known) */}
      <View
        style={{
          position: "absolute",
          left: CANDLE_W / 2 - 0.5,
          top: highY,
          width: 1,
          height: Math.max(1, lowY - highY),
          backgroundColor: color,
          opacity: WICK_OPACITY,
        }}
      />
      {/* Body — animates */}
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            width: CANDLE_W,
            backgroundColor: color,
            opacity: BODY_OPACITY,
          },
          bodyStyle,
        ]}
      />
    </Animated.View>
  );
}

// ── Main world component ────────────────────────────────────────────────────

interface TradingFloorWorldProps {
  active?: boolean;
}

export function TradingFloorWorld({ active = true }: TradingFloorWorldProps) {
  const insets = useSafeAreaInsets();
  const idRef = useRef(0);
  const lastCloseRef = useRef(0.4);
  const patternIdxRef = useRef(Math.floor(rand() * PATTERNS.length));
  const stepRef = useRef(0);

  // Generate next candle from the current pattern, then advance the pattern
  // step. Picks a new (different) pattern at the end of each PATTERN_LENGTH.
  const nextCandle = (): CandleData => {
    const open = lastCloseRef.current;
    const pattern = PATTERNS[patternIdxRef.current];
    const { close, wickFactor = 1 } = pattern(open, stepRef.current);
    const wickRange = 0.025 * wickFactor;
    const high = Math.min(0.98, Math.max(open, close) + wickRange * rand());
    const low = Math.max(0.02, Math.min(open, close) - wickRange * rand());

    lastCloseRef.current = close;
    stepRef.current += 1;
    if (stepRef.current >= PATTERN_LENGTH) {
      let next = Math.floor(rand() * PATTERNS.length);
      if (next === patternIdxRef.current && PATTERNS.length > 1) {
        next = (next + 1) % PATTERNS.length;
      }
      patternIdxRef.current = next;
      stepRef.current = 0;
    }
    return { id: idRef.current++, open, close, high, low };
  };

  // Pre-fill the chart with VISIBLE_COUNT candles so it's not empty on equip.
  // Generate them in chronological order (oldest first), then REVERSE so the
  // newest sits at array index 0 — the renderer maps array index → slotIndex
  // with index 0 = rightmost slot, so the newest pre-fill candle visually
  // anchors the right side and the price walk reads naturally left-to-right.
  // The candle at index 0 mounts with slotIndex=0 → its formation animation
  // runs (printing the rightmost candle); subsequent runtime spawns also land
  // at slotIndex=0 with formation, so prints continue every TICK_MS.
  const initialCandles = useMemo(() => {
    const arr: CandleData[] = [];
    for (let i = 0; i < VISIBLE_COUNT; i++) arr.push(nextCandle());
    return arr.reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [candles, setCandles] = useState<CandleData[]>(initialCandles);

  useEffect(() => {
    if (!active) return;
    const intervalId = setInterval(() => {
      setCandles((prev) => {
        const next = [nextCandle(), ...prev];
        // Cap to MAX_CANDLES — older candles fall off the left edge and
        // unmount cleanly.
        return next.length > MAX_CANDLES ? next.slice(0, MAX_CANDLES) : next;
      });
    }, FORMATION_MS);
    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Chart Y range EXTENDS BEYOND the chat area on top + bottom by OVERFLOW_PX.
  // Effect: a candle at extreme price (close ≈ 0.95) renders with its body
  // partly inside the translucent header bar at the top of the screen; a
  // candle at close ≈ 0.05 extends into the translucent input bar at the
  // bottom. Most price action stays in the playable middle (mean-reversion
  // keeps it there) so this overflow only kicks in for genuine spikes — no
  // more "+" sign clipping at the chart edges.
  const OVERFLOW_PX = 70;
  const chartTop = CHART_TOP_INSET - OVERFLOW_PX;
  const chartBottom = SCREEN_H - INPUT_BAR_HEIGHT - insets.bottom + OVERFLOW_PX;
  const chartHeight = Math.max(200, chartBottom - chartTop);

  // Slot 0 (rightmost) sits with its right edge inset ~12px from the screen
  // edge so the newest candle isn't mashed against the right border.
  const baseRightX = SCREEN_W - STRIDE - 12;

  return (
    <View style={styles.root} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, SCREEN_H)}
            colors={["#06070d", "#08130d", "#06140e"]}
          />
        </Rect>
      </Canvas>

      {candles.map((c, i) => (
        <CandleView
          key={c.id}
          candle={c}
          slotIndex={i}
          chartTop={chartTop}
          chartHeight={chartHeight}
          baseRightX={baseRightX}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject },
});
