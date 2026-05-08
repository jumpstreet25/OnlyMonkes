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
  Group,
  Rect,
  Path,
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

// v16 (2026-05-08): SKIA MASK approach. Real wood material (gradient +
// grain lines) is clipped to the letter glyph shapes via BlendMode.dstIn.
// Inside each letter, you see the wood texture continuing through — like
// real chiseled letters that exposed the deeper wood layer. Outside the
// letter shapes, transparent (the bubble's wood surface shows through).
//
// Why this finally works: prior versions painted the letter as a flat
// color or smooth gradient, which always read as "text on top of wood."
// With the mask, the letter IS wood — the bubble's same material continues
// through the cut, just darker / shaded as the V-shape interior would be.
const CARVE_BEVEL_TOP = "#FFE5B0"; // bright sliver at the top of each carve

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
        const baselineY = PAD_Y + (i + 1) * lineHeight - lineHeight * 0.25;
        const baseX = PAD_X;
        const glyphTop = baselineY - fontSize * 0.85;
        const glyphBottom = baselineY + fontSize * 0.18;
        const glyphHeight = glyphBottom - glyphTop;

        // Three thin horizontal grain paths spanning the line — they get
        // masked to the letter shapes by the dstIn group below, so each
        // grain only shows where it overlaps a letter. Sin-jittered Y so
        // grain looks natural, not perfectly straight.
        const grainPaths: string[] = [];
        for (let g = 0; g < 3; g++) {
          const gy = glyphTop + (g + 1) * (glyphHeight / 4) + Math.sin(g * 5.1) * 1.2;
          grainPaths.push(`M ${baseX - 2} ${gy} Q ${baseX + maxWidth / 2} ${gy + 0.8} ${baseX + maxWidth + 2} ${gy}`);
        }

        return (
          <Group key={i}>
            {/* DESTINATION layer — wood texture inside the line bounds.
                Sharp top cream stop concentrates the bright sliver at the
                very top of the V-carve. Then quick transition to wood
                mid-tones running down to deepest carve interior. */}
            <Rect x={baseX - 2} y={glyphTop} width={maxWidth + 4} height={glyphHeight}>
              <LinearGradient
                start={vec(0, glyphTop)}
                end={vec(0, glyphBottom)}
                colors={[
                  CARVE_BEVEL_TOP,
                  CARVE_BEVEL_TOP,
                  palette.mid,
                  palette.dark,
                  palette.deep,
                ]}
                positions={[0, 0.08, 0.20, 0.55, 1]}
              />
            </Rect>

            {/* Grain inside the carve — subtle dark paths that show only
                where they overlap letter shapes (clipped by the dstIn
                mask below). Same wood family as the rest. */}
            {grainPaths.map((p, gi) => (
              <Path
                key={`grain-${gi}`}
                path={p}
                color={palette.deep}
                style="stroke"
                strokeWidth={0.7}
                opacity={0.5}
              />
            ))}

            {/* SOURCE / MASK layer — text glyphs in white, applied with
                blendMode "dstIn" so the destination (wood + grain) is
                kept ONLY where the glyphs are opaque. Result: wood
                texture visible only inside letter shapes. */}
            <Group blendMode="dstIn">
              <SkiaText
                text={line}
                x={baseX}
                y={baselineY}
                font={font}
                color="white"
              />
            </Group>
          </Group>
        );
      })}
    </Canvas>
  );
});
