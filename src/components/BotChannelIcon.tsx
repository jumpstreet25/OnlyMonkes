/**
 * BotChannelIcon — Skia-rendered vector icon for the Trades channel.
 *
 * Crisp at any size, color-adaptive to the world accent (warm honey gold for
 * Banana Grove, neon pink for Cyberpunk, gold for Trading Floor, light
 * blue default).
 *
 * Visual language: clean outlined shapes (~5% stroke width) with small
 * solid-filled accent dots. Single color per icon, premium minimalist.
 *
 * Symbol: Trending chart (5-point line with peak/dip + data dots). Bets/
 * Sales/Predictions icons (Dice/PriceTag/CrystalBall) retired 2026-08-13
 * when those channels were removed/merged.
 */
import React from "react";
import {
  Canvas,
  Group,
  Path,
  Circle,
} from "@shopify/react-native-skia";

export type BotChannel = "trades";

interface BotChannelIconProps {
  channel: BotChannel;
  /** Render size in px (square). Default 49 to match toolbarChannelImg. */
  size?: number;
  /** Stroke + fill color. Caller passes the world accent. */
  color: string;
}

export const BotChannelIcon = React.memo(function BotChannelIcon({
  channel,
  size = 49,
  color,
}: BotChannelIconProps) {
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      {channel === "trades" && <TrendChartIcon size={size} color={color} />}
    </Canvas>
  );
});

// ── MonkeTrades — Trending chart ───────────────────────────────────────────
function TrendChartIcon({ size, color }: { size: number; color: string }) {
  const pad = size * 0.18;
  // (v31) 0.06 → 0.042, dots 0.05 → 0.038.
  const stroke = Math.max(1.6, size * 0.042);
  const dotR = Math.max(1.3, size * 0.038);
  const inner = size - pad * 2;

  // 5-point line: visually starts low-left, dips, valleys, peak, top-right.
  // Canvas y is top-down — lower y = higher on the chart.
  const points: Array<[number, number]> = [
    [pad,                       pad + inner * 0.78],
    [pad + inner * 0.27,        pad + inner * 0.50],
    [pad + inner * 0.50,        pad + inner * 0.62],
    [pad + inner * 0.74,        pad + inner * 0.28],
    [pad + inner,               pad + inner * 0.05],
  ];

  let pathStr = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    pathStr += ` L ${points[i][0]} ${points[i][1]}`;
  }

  return (
    <Group>
      <Path
        path={pathStr}
        color={color}
        style="stroke"
        strokeWidth={stroke}
        strokeCap="round"
        strokeJoin="round"
      />
      {points.map(([cx, cy], i) => (
        <Circle key={i} cx={cx} cy={cy} r={dotR} color={color} />
      ))}
    </Group>
  );
}

