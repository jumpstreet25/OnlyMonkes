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
// (v27) pickWoodPalette no longer needed in this component — text fill
// is unified via FRESH_CUT_FILL. Wood surface palette still chosen per
// PFP in BananaGroveSignBubble.

interface BananaGroveCarvedTextProps {
  text: string;
  maxWidth: number;
  /** Caller-supplied size; component multiplies by FONT_SCALE for carve. */
  fontSize?: number;
  pfpColor: string;
}

// (v29 2026-05-08) Scale -10% per user iteration: 1.44 → 1.30.
// 15 * 1.30 ≈ 20 px effective.
const FONT_SCALE = 1.30;

// (v27 2026-05-08) Unified fresh-cut text fill — all Banana Grove
// senders' carved letters render in the same light cream tone (matching
// the lightest wood light-stops, e.g. Maple's #F0DBB0) instead of each
// sender's own palette.light. User feedback: "make the font color for
// all Banana Grove viewers/buyers the same as Rugdoctor's (light color)
// but keep the wooden background color picker the same as it is."
//
// Wood surface still picks per-PFP species (palette in BananaGroveSignBubble).
// Only the CARVE-INTERIOR fill is unified. Marked "perfect for now,
// figure a way forward later" by user — likely revisited when per-PFP
// fill comes back via the parked PFP-color-in-carved-text feature.
const FRESH_CUT_FILL = "#F0DBB0";

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
  // pfpColor reserved — kept in the contract for the parked
  // PFP-color-in-carved-text feature (when it lands, swap FRESH_CUT_FILL
  // for a sender-derived color).
  pfpColor: _pfpColor,
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

  // (v27) palette no longer derived here — text fill uses FRESH_CUT_FILL
  // for all senders. Wood surface palette is computed per-PFP in
  // BananaGroveSignBubble where it still drives the surface color.

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

            {/* Inner fresh-cut fill — UNIFIED across all senders (v27).
                Light cream tone reads cleanly against any weathered wood
                surface, matches Rugdoctor's existing light-species look. */}
            <SkiaText
              text={line}
              x={baseX}
              y={baselineY}
              font={font}
              color={FRESH_CUT_FILL}
            />
          </Group>
        );
      })}
    </Canvas>
  );
});
