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

// v14 (2026-05-08): carve-fill switched from pure black to palette.deep
// (the deepest stop of the SAME wood species the bubble surface is using).
// Reasons:
//   - Pure black against light woods read as "black holes" punched through
//     the surface — too harsh, eyestrain-y per user feedback.
//   - Wood-colored carve (palette.deep) reads as a real recessed cut into
//     the SAME wood — letters belong to the wood family.
//   - Carve interior is still meaningfully darker than surface (which
//     uses light → mid gradient ending at .mid), so contrast is preserved.

// Top-bevel highlight — bright warm cream, full alpha. Visible as a clean
// sliver peeking from each letter's upper-left edge. Reads as overhead
// light catching the upper rim of a real V-shaped carve.
const CARVE_HIGHLIGHT = "#FFE5B0";

const HIGHLIGHT_DX = -2.5;
const HIGHLIGHT_DY = -2.5;

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
        // Skia <Text> y is the BASELINE, not top. Position so each line
        // sits within its lineHeight slot with comfortable descender room.
        const baselineY = PAD_Y + (i + 1) * lineHeight - lineHeight * 0.25;
        const baseX = PAD_X;
        return (
          <React.Fragment key={i}>
            {/* 1. Top-left HIGHLIGHT layer — cream, offset up-left by 2.5 px.
                  Visible as a clear sliver on each letter's upper-left rim.
                  This is the signature "light catching the carve edge" that
                  reads as engraved when paired with the dark fill on top. */}
            <SkiaText
              text={line}
              x={baseX + HIGHLIGHT_DX}
              y={baselineY + HIGHLIGHT_DY}
              font={font}
              color={CARVE_HIGHLIGHT}
            />
            {/* 2. CARVE INTERIOR — palette.deep fill on top. Letters are
                  the deepest shade of the SAME wood species as the bubble
                  surface, reading as a recessed cut INTO the wood (not as
                  a black hole punched through it). The cream highlight
                  peeks out from underneath at the upper-left only,
                  exactly where light would catch a V-shaped carve edge. */}
            <SkiaText
              text={line}
              x={baseX}
              y={baselineY}
              font={font}
              color={palette.deep}
            />
          </React.Fragment>
        );
      })}
    </Canvas>
  );
});
