/**
 * BotChannelIcon — Skia-rendered vector icons for the four bot channels.
 *
 * Replaces the chunky 3D blue MonkeBets/Trades/Sales/Predictions PNGs
 * (~280 KB each, 1.1 MB total). Crisp at any size, ~10 KB total bundle
 * impact, and color-adaptive to the world accent (warm honey gold for
 * Banana Grove, neon pink for Cyberpunk, gold for Trading Floor, light
 * blue default).
 *
 * Visual language: clean outlined shapes (~5% stroke width) with small
 * solid-filled accent dots. Single color per icon, premium minimalist.
 *
 * Symbols (per user spec 2026-05-09):
 *   - bets        → Dice ("5" face — 4 corners + center pips)
 *   - trades      → Trending chart (5-point line with peak/dip + data dots)
 *   - sales       → Price tag (pentagon w/ left-pointed corner + string hole)
 *   - predictions → Crystal ball on a small base + shine highlight
 */
import React from "react";
import {
  Canvas,
  Group,
  Path,
  Circle,
  RoundedRect,
} from "@shopify/react-native-skia";

export type BotChannel = "bets" | "trades" | "sales" | "predictions";

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
      {channel === "bets" && <DiceIcon size={size} color={color} />}
      {channel === "trades" && <TrendChartIcon size={size} color={color} />}
      {channel === "sales" && <PriceTagIcon size={size} color={color} />}
      {channel === "predictions" && <CrystalBallIcon size={size} color={color} />}
    </Canvas>
  );
});

// ── MonkeBets — Dice ("5" face) ────────────────────────────────────────────
function DiceIcon({ size, color }: { size: number; color: string }) {
  const inset = size * 0.18;
  const dieSize = size - inset * 2;
  const cornerR = size * 0.10;
  const stroke = Math.max(2, size * 0.05);
  const pipR = Math.max(1.4, size * 0.045);

  // Pip positions for 5-face: 4 corners + center, all relative to die body.
  const pipPositions: Array<[number, number]> = [
    [inset + dieSize * 0.25, inset + dieSize * 0.25],
    [inset + dieSize * 0.75, inset + dieSize * 0.25],
    [inset + dieSize * 0.50, inset + dieSize * 0.50],
    [inset + dieSize * 0.25, inset + dieSize * 0.75],
    [inset + dieSize * 0.75, inset + dieSize * 0.75],
  ];

  return (
    <Group>
      <RoundedRect
        x={inset}
        y={inset}
        width={dieSize}
        height={dieSize}
        r={cornerR}
        color={color}
        style="stroke"
        strokeWidth={stroke}
      />
      {pipPositions.map(([cx, cy], i) => (
        <Circle key={i} cx={cx} cy={cy} r={pipR} color={color} />
      ))}
    </Group>
  );
}

// ── MonkeTrades — Trending chart ───────────────────────────────────────────
function TrendChartIcon({ size, color }: { size: number; color: string }) {
  const pad = size * 0.18;
  const stroke = Math.max(2, size * 0.06);
  const dotR = Math.max(1.6, size * 0.05);
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

// ── MonkeSales — Price tag ─────────────────────────────────────────────────
function PriceTagIcon({ size, color }: { size: number; color: string }) {
  const inset = size * 0.16;
  const tagW = size - inset * 2;
  const tagH = tagW * 0.62;
  const tagX = inset;
  const tagY = (size - tagH) / 2;
  const stroke = Math.max(2, size * 0.05);
  const pointInset = tagW * 0.20;
  const cornerR = size * 0.04;

  // Pentagon: rounded top-right + bottom-right corners, pointed left tip.
  const path = `
    M ${tagX + pointInset} ${tagY}
    L ${tagX + tagW - cornerR} ${tagY}
    Q ${tagX + tagW} ${tagY} ${tagX + tagW} ${tagY + cornerR}
    L ${tagX + tagW} ${tagY + tagH - cornerR}
    Q ${tagX + tagW} ${tagY + tagH} ${tagX + tagW - cornerR} ${tagY + tagH}
    L ${tagX + pointInset} ${tagY + tagH}
    L ${tagX} ${tagY + tagH / 2}
    Z
  `;

  // String hole — a small ring near the pointed left side.
  const holeR = Math.max(1.6, size * 0.05);
  const holeCx = tagX + pointInset + tagW * 0.05;
  const holeCy = tagY + tagH / 2;

  return (
    <Group>
      <Path
        path={path}
        color={color}
        style="stroke"
        strokeWidth={stroke}
        strokeJoin="round"
      />
      <Circle
        cx={holeCx}
        cy={holeCy}
        r={holeR}
        color={color}
        style="stroke"
        strokeWidth={Math.max(1.4, size * 0.04)}
      />
    </Group>
  );
}

// ── MonkePredictions — Crystal ball + base ─────────────────────────────────
function CrystalBallIcon({ size, color }: { size: number; color: string }) {
  const orbR = size * 0.30;
  const orbCx = size / 2;
  const orbCy = size * 0.42;
  const stroke = Math.max(2, size * 0.05);

  // Base: trapezoid below the orb (wider at the bottom, like a stand).
  const baseTopY = orbCy + orbR * 0.88;
  const baseBottomY = size - size * 0.16;
  const baseTopHalfW = orbR * 0.55;
  const baseBottomHalfW = orbR * 0.78;

  const basePath = `
    M ${orbCx - baseTopHalfW} ${baseTopY}
    L ${orbCx + baseTopHalfW} ${baseTopY}
    L ${orbCx + baseBottomHalfW} ${baseBottomY}
    L ${orbCx - baseBottomHalfW} ${baseBottomY}
    Z
  `;

  // Shine: small filled circle at the orb's upper-left, suggesting reflection.
  const shineCx = orbCx - orbR * 0.42;
  const shineCy = orbCy - orbR * 0.42;
  const shineR = orbR * 0.18;

  return (
    <Group>
      <Path
        path={basePath}
        color={color}
        style="stroke"
        strokeWidth={stroke}
        strokeJoin="round"
      />
      <Circle
        cx={orbCx}
        cy={orbCy}
        r={orbR}
        color={color}
        style="stroke"
        strokeWidth={stroke}
      />
      <Circle cx={shineCx} cy={shineCy} r={shineR} color={color} />
    </Group>
  );
}
