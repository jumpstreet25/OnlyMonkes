/**
 * MiniChart — Reusable mini chart using Victory Native XL (Skia + Reanimated).
 * Falls back to pure View-based bars if Victory fails to render.
 *
 * Props:
 *   data    — array of numbers (y-values)
 *   type    — 'line' | 'bar' (default: 'line')
 *   color   — stroke/fill color (default: THEME accent)
 *   height  — chart height in px (default: 60)
 */

import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { THEME } from "@/lib/constants";

// Victory Native XL imports
let VictoryAvailable = false;
let CartesianChart: any;
let Line: any;
let Bar: any;
let useChartPressState: any;

try {
  const victory = require("victory-native");
  CartesianChart = victory.CartesianChart;
  Line = victory.Line;
  Bar = victory.Bar;
  useChartPressState = victory.useChartPressState;
  VictoryAvailable = true;
} catch {
  VictoryAvailable = false;
}

interface MiniChartProps {
  data: number[];
  type?: "line" | "bar";
  color?: string;
  height?: number;
}

/** Transform raw numbers into Victory-compatible { x, y } objects */
function toChartData(data: number[]) {
  return data.map((y, i) => ({ x: i, y }));
}

// ── Fallback: pure View-based bars (no Skia needed) ─────────────────────────

function FallbackBars({ data, color, height }: { data: number[]; color: string; height: number }) {
  const max = Math.max(...data, 1);
  return (
    <View style={[fbStyles.root, { height }]}>
      {data.map((v, i) => {
        const barH = Math.max((v / max) * (height - 4), 2);
        return (
          <View key={i} style={fbStyles.col}>
            <View style={{ flex: 1 }} />
            <View
              style={[
                fbStyles.bar,
                { height: barH, backgroundColor: color, opacity: 0.3 + (v / max) * 0.7 },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

function FallbackLine({ data, color, height }: { data: number[]; color: string; height: number }) {
  // Render as thin View-based bars to approximate a sparkline
  const max = Math.max(...data, 1);
  return (
    <View style={[fbStyles.root, { height }]}>
      {data.map((v, i) => {
        const dotH = Math.max((v / max) * (height - 4), 2);
        return (
          <View key={i} style={fbStyles.col}>
            <View style={{ flex: 1 }} />
            <View
              style={[
                fbStyles.dot,
                { height: dotH, backgroundColor: color, opacity: 0.4 + (v / max) * 0.6 },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

const fbStyles = StyleSheet.create({
  root: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  col: { flex: 1 },
  bar: { borderRadius: 3, minWidth: 4 },
  dot: { borderRadius: 2, minWidth: 3 },
});

// ── Main component ──────────────────────────────────────────────────────────

export function MiniChart({ data, type = "line", color = THEME.accent, height = 60 }: MiniChartProps) {
  const [error, setError] = useState(false);

  // Empty data guard
  if (!data || data.length === 0) return null;

  // All zeros guard
  if (data.every(v => v === 0)) {
    return <FallbackBars data={data} color={color} height={height} />;
  }

  // Fallback if Victory is unavailable or errored
  if (!VictoryAvailable || error) {
    return type === "bar"
      ? <FallbackBars data={data} color={color} height={height} />
      : <FallbackLine data={data} color={color} height={height} />;
  }

  const chartData = toChartData(data);
  const yMax = Math.max(...data) * 1.15; // 15% headroom

  try {
    return (
      <View
        style={{ height, overflow: "hidden" }}
        onLayout={() => {}} // ensure View mounts
      >
        <CartesianChart
          data={chartData}
          xKey="x"
          yKeys={["y"]}
          domainPadding={{ top: 6, bottom: 2, left: 4, right: 4 }}
          domain={{ y: [0, yMax] }}
          axisOptions={{ tickCount: 0 }}
        >
          {({ points, chartBounds }: any) => {
            if (type === "bar") {
              return (
                <Bar
                  points={points.y}
                  chartBounds={chartBounds}
                  color={color}
                  roundedCorners={{ topLeft: 3, topRight: 3 }}
                  barWidth={Math.max(4, Math.floor(80 / data.length))}
                  animate={{ type: "timing", duration: 400 }}
                />
              );
            }
            return (
              <Line
                points={points.y}
                color={color}
                strokeWidth={2}
                curveType="natural"
                animate={{ type: "timing", duration: 400 }}
              />
            );
          }}
        </CartesianChart>
      </View>
    );
  } catch {
    setError(true);
    return type === "bar"
      ? <FallbackBars data={data} color={color} height={height} />
      : <FallbackLine data={data} color={color} height={height} />;
  }
}
