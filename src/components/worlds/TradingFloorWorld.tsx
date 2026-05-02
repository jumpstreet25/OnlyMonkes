/**
 * TradingFloorWorld — dark room with a faint candlestick chart drifting horizontally.
 *
 * Procedurally-generated candles (random walk) drift right-to-left via a single
 * Reanimated shared value. Cheap: ~30 rectangles + 30 lines, redrawn at 60fps
 * on the UI thread. The whole layer sits at low opacity so chat text remains
 * readable.
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

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

const CANDLE_COUNT = 36;          // enough to fill 1.5× screen width
const CANDLE_W = 14;
const CANDLE_GAP = 6;
const CHART_HEIGHT = 220;
const CHART_BOTTOM_OFFSET = 80;   // distance from bottom of screen
const DRIFT_DURATION_MS = 22_000;

interface Candle {
  open: number;   // 0..1 normalized
  close: number;
  high: number;
  low: number;
}

function generateCandles(): Candle[] {
  const candles: Candle[] = [];
  let price = 0.5;
  for (let i = 0; i < CANDLE_COUNT; i++) {
    const drift = (Math.random() - 0.5) * 0.18;
    const open = price;
    const close = Math.max(0.05, Math.min(0.95, price + drift));
    const wickRange = 0.04 + Math.random() * 0.06;
    const high = Math.max(open, close) + wickRange * Math.random();
    const low = Math.min(open, close) - wickRange * Math.random();
    candles.push({
      open,
      close,
      high: Math.min(0.98, high),
      low: Math.max(0.02, low),
    });
    price = close;
  }
  return candles;
}

interface TradingFloorWorldProps {
  active?: boolean;
}

export function TradingFloorWorld({ active = true }: TradingFloorWorldProps) {
  const candles = useMemo(generateCandles, []);
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

  // Drift the whole chart by the width of one candle+gap each cycle so it
  // appears infinite.
  const candleStride = CANDLE_W + CANDLE_GAP;
  const transform = useDerivedValue(
    () => [{ translateX: -progress.value * candleStride }],
    [progress, candleStride],
  );

  const chartTop = SCREEN_H - CHART_BOTTOM_OFFSET - CHART_HEIGHT;
  const yFor = (norm: number) => chartTop + (1 - norm) * CHART_HEIGHT;

  return (
    <View style={styles.root} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Dark backdrop with subtle blue tint */}
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, SCREEN_H)}
            colors={["#06070d", "#0a0d18", "#08101c"]}
          />
        </Rect>

        {/* Candlestick chart */}
        <Group transform={active ? transform : undefined} opacity={0.32}>
          {candles.map((c, i) => {
            const x = i * candleStride;
            const isUp = c.close >= c.open;
            const color = isUp ? "#10B981" : "#EF4444";
            const bodyTop = yFor(Math.max(c.open, c.close));
            const bodyBot = yFor(Math.min(c.open, c.close));
            const bodyH = Math.max(1, bodyBot - bodyTop);
            const wickX = x + CANDLE_W / 2;
            return (
              <Group key={i}>
                {/* Wick */}
                <Line
                  p1={vec(wickX, yFor(c.high))}
                  p2={vec(wickX, yFor(c.low))}
                  color={color}
                  strokeWidth={1}
                />
                {/* Body */}
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
