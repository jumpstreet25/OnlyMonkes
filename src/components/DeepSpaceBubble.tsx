/**
 * DeepSpaceBubble — space comm-panel speech bubble.
 *
 * Shape: standard rounded rect (r=14, same as Cyberpunk).
 * Layers (back → front):
 *   1. Soft outer purple-blue glow halo (blurred)
 *   2. Dark body fill (near-black with deep purple cast)
 *   3. Star speckles inside (8 tiny dots, very low opacity)
 *   4. Gradient border — purple → electric blue
 *   5. Corner bracket marks (HUD-style: 2 lines per corner, smaller inset)
 *   6. Simple tail (gradient-matched)
 */

import React, { useMemo } from "react";
import {
  Canvas,
  Path,
  Group,
  BlurMask,
  Line,
  vec,
  Circle,
} from "@shopify/react-native-skia";

interface DeepSpaceBubbleProps {
  width: number;
  height: number;
  color: string;    // sender accent — used as a tint layer
  radius?: number;
  tailSide?: "left" | "right" | "none";
}

const TAIL_W = 11;
const TAIL_H = 10;
const BRACKET_LEN = 10;  // length of each bracket arm
const BRACKET_INSET = 4; // how far brackets sit inside the bubble boundary

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
  const midY = h * 0.65; // sit slightly below centre so tail aligns with PFP
  if (side === "right") {
    const tx = w + TAIL_W;
    return `M${w} ${midY - TAIL_H / 2} L${tx} ${midY} L${w} ${midY + TAIL_H / 2} Z`;
  }
  const tx = -TAIL_W;
  return `M0 ${midY - TAIL_H / 2} L${tx} ${midY} L0 ${midY + TAIL_H / 2} Z`;
}

function genSpeckles(w: number, h: number): Array<{ cx: number; cy: number; r: number; a: number }> {
  const speckles = [];
  const seeds = [13,37,71,109,157,211,251,293];
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    const fx = ((s * 1103515245 + i * 12345) & 0x7fffffff) / 0x7fffffff;
    const fy = ((s * 6764231 + i * 22695477) & 0x7fffffff) / 0x7fffffff;
    const fa = ((s * 214013 + i * 2531011) & 0x7fffffff) / 0x7fffffff;
    speckles.push({
      cx: 10 + fx * (w - 20),
      cy: 8 + fy * (h - 16),
      r: 0.8 + fa * 0.8,
      a: 0.15 + fa * 0.2,
    });
  }
  return speckles;
}

export function DeepSpaceBubble({ width: w, height: h, color, radius = 14, tailSide = "none" }: DeepSpaceBubbleProps) {
  const bodyPath = useMemo(() => buildRoundedRect(w, h, radius), [w, h, radius]);
  const tailPath = useMemo(() => tailSide !== "none" ? buildTailPath(w, h, tailSide) : null, [w, h, tailSide]);
  const speckles = useMemo(() => genSpeckles(w, h), [w, h]);

  const canvasW = tailSide === "right" ? w + TAIL_W + 2 : tailSide === "left" ? w + TAIL_W + 2 : w;
  const offsetX = tailSide === "left" ? TAIL_W : 0;

  const BI = BRACKET_INSET;

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
        {/* Outer glow halo */}
        <Path path={bodyPath} color="rgba(120,60,240,0.22)" style="stroke" strokeWidth={8}>
          <BlurMask blur={12} style="normal" />
        </Path>

        {/* Body fill — deep space black with purple cast */}
        <Path path={bodyPath} color="rgba(4,2,14,0.80)" />

        {/* Star speckles */}
        {speckles.map((sp, i) => (
          <Circle key={i} cx={sp.cx} cy={sp.cy} r={sp.r} color={`rgba(200,215,255,${sp.a})`} />
        ))}

        {/* Tail fill + border */}
        {tailPath && (
          <>
            <Path path={tailPath} color="rgba(4,2,14,0.80)" />
            <Path path={tailPath} color="rgba(120,80,255,0.7)" style="stroke" strokeWidth={1} />
          </>
        )}

        {/* Gradient border — purple to electric blue */}
        <Path path={bodyPath} style="stroke" strokeWidth={1.8} color="rgba(130,80,255,0.85)" />
        {/* Second pass shifted for the blue edge — gives the dual-color feel */}
        <Path path={bodyPath} style="stroke" strokeWidth={0.8} color="rgba(80,180,255,0.55)" />

        {/* Corner bracket marks — HUD-style, inset from edge */}
        {/* Top-left */}
        <Line p1={vec(BI, BI + BRACKET_LEN)} p2={vec(BI, BI)} color="#8860FF" strokeWidth={1.8} />
        <Line p1={vec(BI, BI)} p2={vec(BI + BRACKET_LEN, BI)} color="#8860FF" strokeWidth={1.8} />
        {/* Top-right */}
        <Line p1={vec(w - BI - BRACKET_LEN, BI)} p2={vec(w - BI, BI)} color="#5090FF" strokeWidth={1.8} />
        <Line p1={vec(w - BI, BI)} p2={vec(w - BI, BI + BRACKET_LEN)} color="#5090FF" strokeWidth={1.8} />
        {/* Bottom-left */}
        <Line p1={vec(BI, h - BI - BRACKET_LEN)} p2={vec(BI, h - BI)} color="#8860FF" strokeWidth={1.8} />
        <Line p1={vec(BI, h - BI)} p2={vec(BI + BRACKET_LEN, h - BI)} color="#8860FF" strokeWidth={1.8} />
        {/* Bottom-right */}
        <Line p1={vec(w - BI - BRACKET_LEN, h - BI)} p2={vec(w - BI, h - BI)} color="#5090FF" strokeWidth={1.8} />
        <Line p1={vec(w - BI, h - BI)} p2={vec(w - BI, h - BI - BRACKET_LEN)} color="#5090FF" strokeWidth={1.8} />
      </Group>
    </Canvas>
  );
}
