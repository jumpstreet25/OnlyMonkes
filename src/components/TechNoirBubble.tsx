/**
 * TechNoirBubble — detective-case-file speech bubble.
 *
 * Shape: tight-radius rounded rect (r=5) — the "sharp report" look.
 * Layers (back → front):
 *   1. Dark glass body fill
 *   2. Horizontal scanlines at very low opacity (typewriter paper texture)
 *   3. Steel-chrome border (1.5px, #8898AA)
 *   4. Corner tick marks — 4 small L-shapes at each corner (crime-scene photo)
 *   5. Simple triangle tail pointing left or right
 */

import React, { useMemo } from "react";
import {
  Canvas,
  Path,
  Rect,
  Group,
  Line,
  vec,
} from "@shopify/react-native-skia";

interface TechNoirBubbleProps {
  width: number;
  height: number;
  color: string;           // sender accent (unused here — noir is accent-agnostic)
  radius?: number;
  tailSide?: "left" | "right" | "none";
}

const CHROME   = "#7A90A8";       // steel-chrome border
const BODY_BG  = "rgba(2,6,14,0.82)";
const TICK_LEN = 8;               // corner-tick mark length in px
const TAIL_W   = 10;
const TAIL_H   = 8;
const SCANLINE_STEP = 7;          // px between scanlines

function buildRoundedRect(w: number, h: number, r: number): string {
  return [
    `M${r} 0`,
    `L${w - r} 0 Q${w} 0 ${w} ${r}`,
    `L${w} ${h - r} Q${w} ${h} ${w - r} ${h}`,
    `L${r} ${h} Q0 ${h} 0 ${h - r}`,
    `L0 ${r} Q0 0 ${r} 0 Z`,
  ].join(" ");
}

function buildTailPath(w: number, h: number, side: "left" | "right"): string {
  const midY = h / 2;
  if (side === "right") {
    const tx = w + TAIL_W;
    return `M${w} ${midY - TAIL_H / 2} L${tx} ${midY} L${w} ${midY + TAIL_H / 2} Z`;
  } else {
    const tx = -TAIL_W;
    return `M0 ${midY - TAIL_H / 2} L${tx} ${midY} L0 ${midY + TAIL_H / 2} Z`;
  }
}

function buildScanlinePath(w: number, h: number): string {
  const parts: string[] = [];
  for (let y = SCANLINE_STEP; y < h; y += SCANLINE_STEP) {
    parts.push(`M0 ${y} L${w} ${y}`);
  }
  return parts.join(" ");
}

export function TechNoirBubble({ width: w, height: h, radius = 5, tailSide = "none" }: TechNoirBubbleProps) {
  const bodyPath    = useMemo(() => buildRoundedRect(w, h, radius), [w, h, radius]);
  const tailPath    = useMemo(() => tailSide !== "none" ? buildTailPath(w, h, tailSide) : null, [w, h, tailSide]);
  const scanPath    = useMemo(() => buildScanlinePath(w, h), [w, h]);

  const canvasW = tailSide === "right" ? w + TAIL_W + 1 : tailSide === "left" ? w + TAIL_W + 1 : w;
  const offsetX = tailSide === "left" ? TAIL_W : 0;

  return (
    <Canvas
      style={{
        position: "absolute",
        top: 0,
        left: tailSide === "left" ? -TAIL_W : 0,
        width: canvasW,
        height: h,
        pointerEvents: "none",
      }}
    >
      <Group transform={[{ translateX: offsetX }]}>
        {/* Body fill */}
        <Path path={bodyPath} color={BODY_BG} />

        {/* Scanlines — very subtle typewriter/report paper texture */}
        <Path path={scanPath} color="rgba(180,200,220,0.04)" style="stroke" strokeWidth={0.5} />

        {/* Tail */}
        {tailPath && (
          <Path path={tailPath} color={BODY_BG} />
        )}
        {tailPath && (
          <Path path={tailPath} color={CHROME} style="stroke" strokeWidth={1} />
        )}

        {/* Chrome border */}
        <Path path={bodyPath} color={CHROME} style="stroke" strokeWidth={1.5} />

        {/* Corner tick marks — TL, TR, BL, BR */}
        {/* Top-left */}
        <Line p1={vec(0, TICK_LEN)} p2={vec(0, 0)} color={CHROME} strokeWidth={1.8} />
        <Line p1={vec(0, 0)} p2={vec(TICK_LEN, 0)} color={CHROME} strokeWidth={1.8} />
        {/* Top-right */}
        <Line p1={vec(w - TICK_LEN, 0)} p2={vec(w, 0)} color={CHROME} strokeWidth={1.8} />
        <Line p1={vec(w, 0)} p2={vec(w, TICK_LEN)} color={CHROME} strokeWidth={1.8} />
        {/* Bottom-left */}
        <Line p1={vec(0, h - TICK_LEN)} p2={vec(0, h)} color={CHROME} strokeWidth={1.8} />
        <Line p1={vec(0, h)} p2={vec(TICK_LEN, h)} color={CHROME} strokeWidth={1.8} />
        {/* Bottom-right */}
        <Line p1={vec(w - TICK_LEN, h)} p2={vec(w, h)} color={CHROME} strokeWidth={1.8} />
        <Line p1={vec(w, h)} p2={vec(w, h - TICK_LEN)} color={CHROME} strokeWidth={1.8} />
      </Group>
    </Canvas>
  );
}
