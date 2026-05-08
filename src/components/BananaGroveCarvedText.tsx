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

interface BananaGroveCarvedTextProps {
  text: string;
  /** Max width available for text (the bubble's content-area width). */
  maxWidth: number;
  /** Font size — defaults to 15. Multiplied by user's textScale upstream. */
  fontSize?: number;
  /** Sender's PFP color — currently unused, hooked up in Day 4 (resin). */
  pfpColor: string;
}

// Layer colors for the 3-layer carve effect (Day 2).
// Carve interior fill — near-black, sits at the deepest point of the carve.
const CARVE_FILL = "#0D0703";
// Top-bevel highlight — warm cream, offset up-left to catch overhead light.
const CARVE_HIGHLIGHT = "rgba(255, 230, 175, 0.90)";
// Bottom-bevel ambient occlusion — pure shadow, offset down-right.
const CARVE_AO = "rgba(0, 0, 0, 0.85)";

// Bevel offsets — sub-pixel-ish nudges so the carve feels precise + chiseled.
const HIGHLIGHT_DX = -1.2;
const HIGHLIGHT_DY = -1.2;
const AO_DX = 1.0;
const AO_DY = 1.0;

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
  // pfpColor reserved for Day 4 (resin pool); destructured to keep contract.
  pfpColor: _pfpColor,
}: BananaGroveCarvedTextProps) {
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

  // Canvas needs a small horizontal pad to contain the offset bevel glyphs
  // (highlight extends -1.2 px left, AO extends +1 px right). Add 4px on
  // each side; vertical pad similar at 4px top/bottom.
  const PAD_X = 4;
  const PAD_Y = 4;
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
            {/* 1. Top-left HIGHLIGHT layer — cream, offset up-left.
                  Visible only on the upper-left rim of each letter where the
                  main fill doesn't cover it. Reads as light catching the top
                  edge of the carve. */}
            <SkiaText
              text={line}
              x={baseX + HIGHLIGHT_DX}
              y={baselineY + HIGHLIGHT_DY}
              font={font}
              color={CARVE_HIGHLIGHT}
            />
            {/* 2. Bottom-right AMBIENT OCCLUSION layer — black, offset down-
                  right. Visible only on the lower-right rim — light is
                  blocked by the carve walls there, deepest shadow inside. */}
            <SkiaText
              text={line}
              x={baseX + AO_DX}
              y={baselineY + AO_DY}
              font={font}
              color={CARVE_AO}
            />
            {/* 3. CARVE INTERIOR — the main dark fill, on top. Letters
                  read as recessed because the highlight + AO peek out
                  asymmetrically from underneath this fill. */}
            <SkiaText
              text={line}
              x={baseX}
              y={baselineY}
              font={font}
              color={CARVE_FILL}
            />
          </React.Fragment>
        );
      })}
    </Canvas>
  );
});
