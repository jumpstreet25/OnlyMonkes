/**
 * TradingFloorWorld — green-pumpamental candlestick chart filling the chat
 * background. Procedurally-generated candles drift right-to-left via a
 * Reanimated clock; the random walk is biased ~85% bullish so the chart
 * mostly climbs (the occasional red wick adds realism without breaking the
 * "we're winning" vibe). Two parallax rows give visual depth — a back row
 * drifting slower behind the foreground.
 *
 * Cheap to render: ~70 rectangles + 70 lines redrawn at 60fps on the UI
 * thread. Layer opacity is moderated so chat text remains readable.
 */

import React, { useEffect, useMemo } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import {
  Canvas,
  Rect,
  LinearGradient,
  vec,
  Group,
  Line,
} from "@shopify/react-native-skia";
import {
  useSharedValue,
  useDerivedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

const CANDLE_COUNT = 36;          // foreground row — ~1.5× screen width worth
const BACK_CANDLE_COUNT = 30;     // background row (parallax) — fewer + wider
const CANDLE_W = 16;
const CANDLE_GAP = 7;
const BACK_CANDLE_W = 22;
const BACK_CANDLE_GAP = 10;
// Approx chrome above the chart (status bar + chat header). Bottom bound is
// the safe-area inset + input bar height computed at render time.
const CHART_TOP_INSET = 110;
const INPUT_BAR_HEIGHT = 96;
const DRIFT_DURATION_MS = 22_000;
const BACK_DRIFT_DURATION_MS = 38_000; // slower → parallax depth illusion
// Bullish bias: 85% of candles close above their open. Reds are smaller in
// magnitude than greens so the chart still trends up overall — feels like a
// monke trading floor that only knows green.
const BULLISH_PROBABILITY = 0.85;

interface Candle {
  open: number;   // 0..1 normalized
  close: number;
  high: number;
  low: number;
}

function generateCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  let price = 0.2; // start low so we have headroom to climb
  for (let i = 0; i < count; i++) {
    const isBullish = Math.random() < BULLISH_PROBABILITY;
    const magnitude = 0.02 + Math.random() * 0.08;
    const open = price;
    const close = isBullish
      ? Math.min(0.95, price + magnitude)
      : Math.max(0.05, price - magnitude * 0.55); // red candles half as tall
    const wickRange = 0.015 + Math.random() * 0.045;
    const high = Math.max(open, close) + wickRange * Math.random();
    const low = Math.min(open, close) - wickRange * Math.random();
    candles.push({
      open,
      close,
      high: Math.min(0.98, high),
      low: Math.max(0.02, low),
    });
    // After a strong rally, dip slightly so we don't pin to the ceiling.
    price = close > 0.85 ? 0.55 + Math.random() * 0.2 : close;
  }
  return candles;
}

interface TradingFloorWorldProps {
  active?: boolean;
}

export function TradingFloorWorld({ active = true }: TradingFloorWorldProps) {
  const insets = useSafeAreaInsets();
  const foreCandles = useMemo(() => generateCandles(CANDLE_COUNT), []);
  const backCandles = useMemo(() => generateCandles(BACK_CANDLE_COUNT), []);
  const progress = useSharedValue(0);
  const backProgress = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(progress);
      cancelAnimation(backProgress);
      return;
    }
    progress.value = 0;
    backProgress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: DRIFT_DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    );
    backProgress.value = withRepeat(
      withTiming(1, { duration: BACK_DRIFT_DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(progress);
      cancelAnimation(backProgress);
    };
  }, [active, progress, backProgress]);

  const candleStride = CANDLE_W + CANDLE_GAP;
  const backStride = BACK_CANDLE_W + BACK_CANDLE_GAP;
  const transform = useDerivedValue(
    () => [{ translateX: -progress.value * candleStride }],
    [progress, candleStride],
  );
  const backTransform = useDerivedValue(
    () => [{ translateX: -backProgress.value * backStride }],
    [backProgress, backStride],
  );

  // Chart fills most of the chat area: from below the header to above the
  // input bar (with safe-area inset). Both rows share the same vertical span
  // so the parallax reads as depth, not as separate stacked charts.
  const chartTop = CHART_TOP_INSET;
  const chartBottom = SCREEN_H - INPUT_BAR_HEIGHT - insets.bottom;
  const chartHeight = Math.max(200, chartBottom - chartTop);
  const yFor = (norm: number) => chartTop + (1 - norm) * chartHeight;

  return (
    <View style={styles.root} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Dark backdrop — slightly green-tinted to lean into the bullish vibe */}
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, SCREEN_H)}
            colors={["#06070d", "#08130d", "#06140e"]}
          />
        </Rect>

        {/* Background row — wider candles, lower opacity, slower drift */}
        <Group transform={active ? backTransform : undefined} opacity={0.18}>
          {backCandles.map((c, i) => {
            const x = i * backStride;
            const isUp = c.close >= c.open;
            const color = isUp ? "#10B981" : "#EF4444";
            const bodyTop = yFor(Math.max(c.open, c.close));
            const bodyBot = yFor(Math.min(c.open, c.close));
            const bodyH = Math.max(1, bodyBot - bodyTop);
            const wickX = x + BACK_CANDLE_W / 2;
            return (
              <Group key={`b${i}`}>
                <Line
                  p1={vec(wickX, yFor(c.high))}
                  p2={vec(wickX, yFor(c.low))}
                  color={color}
                  strokeWidth={1.5}
                />
                <Rect
                  x={x}
                  y={bodyTop}
                  width={BACK_CANDLE_W}
                  height={bodyH}
                  color={color}
                />
              </Group>
            );
          })}
        </Group>

        {/* Foreground row */}
        <Group transform={active ? transform : undefined} opacity={0.42}>
          {foreCandles.map((c, i) => {
            const x = i * candleStride;
            const isUp = c.close >= c.open;
            const color = isUp ? "#10B981" : "#EF4444";
            const bodyTop = yFor(Math.max(c.open, c.close));
            const bodyBot = yFor(Math.min(c.open, c.close));
            const bodyH = Math.max(1, bodyBot - bodyTop);
            const wickX = x + CANDLE_W / 2;
            return (
              <Group key={i}>
                <Line
                  p1={vec(wickX, yFor(c.high))}
                  p2={vec(wickX, yFor(c.low))}
                  color={color}
                  strokeWidth={1}
                />
                <Rect
                  x={x}
                  y={bodyTop}
                  width={CANDLE_W}
                  height={bodyH}
                  color={color}
                />
              </Group>
            );
          })}
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject },
});
