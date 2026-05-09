/**
 * BananaGroveCarvedText — v20 (2026-05-08).
 *
 * Inverted carve coloring per user feedback:
 *   - Outer char rim:  palette.deep (the "charred" cut edge in shadow)
 *   - Inner fresh cut: palette.light (the lighter wood freshly exposed
 *                      where the chisel removed material)
 *
 * Render technique: same text drawn TWICE per line:
 *   1. Stroked with palette.deep at strokeWidth 2.5 — produces a dark
 *      ring centered on each letter's path. Half the stroke extends
 *      outside the letter (forming the visible "char rim"), half is
 *      covered by the fill on top.
 *   2. Filled with palette.light — the inner "fresh-cut wood" color
 *      that fills the letter shape, covering the inner half of the
 *      stroke. The visible result is letters with a dark indented
 *      rim around a lighter interior — exactly the chisel-on-wood look.
 *
 * Subtle PFP-color radial glow remains BEHIND letters (masked) for
 * sender-identity color, kept low-alpha so it doesn't compete with
 * the inverted-color readability.
 *
 * Font size bumped 15 → 17 px for chat readability + more carve surface.
 */
import React, { useMemo } from "react";
import { Platform } from "react-native";
import {
  Canvas,
  Group,
  Text as SkiaText,
  matchFont,
  useFont,
} from "@shopify/react-native-skia";
import { pickWoodPalette } from "@/lib/woodPalettes";

interface BananaGroveCarvedTextProps {
  text: string;
  maxWidth: number;
  /** Caller-supplied size; component multiplies by FONT_SCALE for carve. */
  fontSize?: number;
  pfpColor: string;
}

// (v24 2026-05-08) Banana Grove text scale 3x per user — chunky carved
// letters need significantly more pixel area than chat-default 15px for
// the dark char rim + light fresh-cut fill to read as actual carving.
// 15 * 3 = 45 px effective.
const FONT_SCALE = 3;

// Char-rim stroke width (px). v21: bumped 2.5 → 3.5 + switched to pure
// black "#000000" so the rim reads as clearly burnt/charred against
// the now-weathered (darker) bubble surface.
const CHAR_RIM_STROKE = 3.5;
const CHAR_RIM_COLOR = "#000000";

function wrapLines(text: string, font: ReturnType<typeof useFont> | null, maxWidth: number): string[] {
  if (!text || maxWidth <= 0 || !font) return [];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    let measured = 0;
    try {
      const r = font.measureText(candidate);
      measured = r.width ?? 0;
    } catch {
      measured = candidate.length * (font.getSize?.() ?? 14) * 0.55;
    }
    if (measured > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export const BananaGroveCarvedText = React.memo(function BananaGroveCarvedText({
  text,
  maxWidth,
  fontSize = 15,
  pfpColor,
}: BananaGroveCarvedTextProps) {
  const effectiveFontSize = Math.round(fontSize * FONT_SCALE);

  const fredokaFont = useFont(
    require("../../assets/fonts/Fredoka-Bold.ttf"),
    effectiveFontSize,
  );
  const systemFont = useMemo(() => {
    try {
      return matchFont({
        fontFamily: Platform.select({ ios: "Helvetica", default: "sans-serif" }),
        fontSize: effectiveFontSize,
        fontStyle: "normal",
        fontWeight: "700",
      });
    } catch { return null; }
  }, [effectiveFontSize]);
  const font = fredokaFont ?? systemFont;

  const palette = useMemo(() => pickWoodPalette(pfpColor), [pfpColor]);

  const { lines, lineHeight, totalHeight } = useMemo(() => {
    if (!font) return { lines: [] as string[], lineHeight: 0, totalHeight: 0 };
    const lh = effectiveFontSize * 1.35;
    const ls = wrapLines(text, font, maxWidth);
    return { lines: ls, lineHeight: lh, totalHeight: lh * ls.length };
  }, [text, font, maxWidth, effectiveFontSize]);

  if (!font || lines.length === 0 || maxWidth <= 0) return null;

  // Pad the canvas a bit more than the text bounds to contain the char-rim
  // stroke that extends outside each letter shape.
  const PAD_X = 6;
  const PAD_Y = 6;
  const canvasWidth = maxWidth + PAD_X * 2;
  const canvasHeight = totalHeight + PAD_Y * 2;

  return (
    <Canvas
      style={{
        width: canvasWidth,
        height: canvasHeight,
        marginLeft: -PAD_X,
        marginTop: -PAD_Y,
      }}
      pointerEvents="none"
    >
      {lines.map((line, i) => {
        const baselineY = PAD_Y + (i + 1) * lineHeight - lineHeight * 0.28;
        const baseX = PAD_X;

        return (
          <Group key={i}>
            {/* (v21 2026-05-08) PFP-color glow orbs REMOVED — user flagged
                them as competing with the wood-on-wood contrast. Sender
                identity is already conveyed by the wood species choice. */}

            {/* Outer burnt-black char rim — pure black at stroke 3.5 px,
                centered on the letter path. Half extends outside the
                letter (visible burnt border around the carve), half
                covered by fill on top. */}
            <Group
              style="stroke"
              strokeWidth={CHAR_RIM_STROKE}
              color={CHAR_RIM_COLOR}
            >
              <SkiaText
                text={line}
                x={baseX}
                y={baselineY}
                font={font}
              />
            </Group>

            {/* Inner fresh-cut wood fill — palette.light is the brightest
                stop of the species. Against the now-weathered surface
                (palette.mid → palette.dark in BananaGroveSignBubble),
                this gives clear contrast: weathered wood plaque with
                fresh-cut wood freshly exposed inside each carved letter. */}
            <SkiaText
              text={line}
              x={baseX}
              y={baselineY}
              font={font}
              color={palette.light}
            />
          </Group>
        );
      })}
    </Canvas>
  );
});
