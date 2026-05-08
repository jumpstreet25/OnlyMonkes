/**
 * BananaGroveCarvedText — Phase 2 Day 1+2 (2026-05-08).
 *
 * Skia-based text rendering for Banana Grove wooden Sign bubbles. This
 * replaces the RN <Text> path for PLAIN-TEXT messages (no @mentions, no
 * $TOKEN, no replies — those keep RN Text rendering until Day 5 brings
 * them into Skia too).
 *
 * Day 1: Skia text foundation — matchFont for system bold font, manual
 *        word-wrap by glyph measurement.
 * Day 2: 3-layer carve effect — cream highlight glyph offset up-left
 *        (top-bevel light) + dark shadow glyph offset down-right
 *        (bottom-bevel ambient occlusion) + main dark carve fill on top.
 *        The offsets create the visual illusion of letters cut INTO the
 *        wood with light catching the upper edge of each carve.
 *
 * Future days (NOT yet in this component):
 * - Day 3: wood grain visible inside the carved-text mask (offset darker
 *          grain showing through the carve interior).
 * - Day 4: PFP-color resin pool inside the mask + 8-22% pulse glow.
 * - Day 5: @mention / $TOKEN tappable regions + accessibility passthrough.
 */
import React, { useMemo } from "react";
import { Platform } from "react-native";
import {
  Canvas,
  Text as SkiaText,
  LinearGradient,
  vec,
  matchFont,
  type SkFont,
} from "@shopify/react-native-skia";
import { pickWoodPalette } from "@/lib/woodPalettes";

interface BananaGroveCarvedTextProps {
  text: string;
  /** Max width available for text (the bubble's content-area width). */
  maxWidth: number;
  /** Font size — defaults to 15. Multiplied by user's textScale upstream. */
  fontSize?: number;
  /** Sender's PFP color — picks the wood species + carve depth color. */
  pfpColor: string;
}

// v15 (2026-05-08): single-glyph render with PER-LETTER vertical gradient
// as the paint. Replaces the 2-layer offset bevel approach.
//
// Why: 2-layer offset (cream highlight glyph + dark fill glyph on top) at
// 15px font produced a visible cream "halo" around each letter, reading
// as "black on cream" rather than "carved into wood." The fundamental
// problem: separate cream + dark colors don't belong to the same material.
//
// Solution: paint each letter with a vertical gradient running from
// CARVE_BEVEL_TOP (bright cream — overhead light catching the carve's
// upper rim) through palette.dark (mid-stop wood tone) to palette.deep
// (deepest shadow inside the carve). Each letter naturally has bevel
// shading WITHIN ITS OWN SHAPE — the top edge of the letter is bright,
// the bottom is dark, exactly mirroring how light hits a V-shaped carve.
// No separate highlight glyph means no "halo" or "background" perception.
//
// This is effectively a per-letter normal-map illusion via gradient.
const CARVE_BEVEL_TOP = "#FFE0B0";   // bright cream — top rim catching light

/**
 * Word-wrap a paragraph into lines that fit within maxWidth using Skia's
 * font measurement. Falls back to single line if measurement returns 0.
 */
function wrapLines(text: string, font: SkFont, maxWidth: number): string[] {
  if (!text || maxWidth <= 0) return [];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    let measured = 0;
    try {
      // Skia API: measureText returns SkRectanglePrimitive { x, y, width, height }
      const r = font.measureText(candidate);
      measured = r.width ?? 0;
    } catch {
      measured = candidate.length * font.getSize() * 0.55; // rough fallback
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
  // Pick the same wood species the Sign bubble is using, so letters carve
  // INTO the same wood (continuity of material). palette.deep is the
  // darkest stop — used as the carve interior color.
  const palette = useMemo(() => pickWoodPalette(pfpColor), [pfpColor]);
  // Build a Skia font once per fontSize change. matchFont is a sync call
  // that resolves a system font matching the requested style.
  const font = useMemo(() => {
    try {
      return matchFont({
        fontFamily: Platform.select({ ios: "Helvetica", default: "sans-serif" }),
        fontSize,
        fontStyle: "normal",
        // 700 = bold. Heavier weight gives a chunkier carved feel.
        fontWeight: "700",
      });
    } catch {
      return null;
    }
  }, [fontSize]);

  const { lines, lineHeight, totalHeight } = useMemo(() => {
    if (!font) return { lines: [] as string[], lineHeight: 0, totalHeight: 0 };
    // 1.3x font size is a comfortable line height for chat text.
    const lh = fontSize * 1.3;
    const ls = wrapLines(text, font, maxWidth);
    return { lines: ls, lineHeight: lh, totalHeight: lh * ls.length };
  }, [text, font, maxWidth, fontSize]);

  if (!font || lines.length === 0 || maxWidth <= 0) return null;

  // Canvas pad accommodates the amplified bevel offsets (highlight extends
  // -2.5 px to the upper-left). 6 px each side gives breathing room.
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
        // Skia <Text> y is the BASELINE. Each letter spans roughly from
        // (baselineY - fontSize) at the top to (baselineY + descender)
        // at the bottom. We paint a vertical gradient across that range
        // so each letter's TOP is bright cream and BOTTOM is deep shadow.
        const baselineY = PAD_Y + (i + 1) * lineHeight - lineHeight * 0.25;
        const baseX = PAD_X;
        const glyphTop = baselineY - fontSize * 0.85;
        const glyphBottom = baselineY + fontSize * 0.18;
        return (
          <SkiaText
            key={i}
            text={line}
            x={baseX}
            y={baselineY}
            font={font}
          >
            {/* Per-letter bevel gradient: cream top → mid wood → deep
                shadow bottom. This is the carve illusion — light catches
                the upper rim of each letter, deepest shadow at the
                bottom of the carve. Same wood species as the surface so
                it reads as a recessed cut INTO the same plank. */}
            <LinearGradient
              start={vec(0, glyphTop)}
              end={vec(0, glyphBottom)}
              colors={[CARVE_BEVEL_TOP, palette.dark, palette.deep]}
            />
          </SkiaText>
        );
      })}
    </Canvas>
  );
});
