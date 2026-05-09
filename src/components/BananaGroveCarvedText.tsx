/**
 * BananaGroveCarvedText — v19 (2026-05-08), readability-first pivot.
 *
 * The user reference image (cinematic 3D-rendered carved wood) is
 * unreachable at chat font size (15-16 px) — wood texture detail
 * inside letter shapes collides with the letter outlines and produces
 * blurry, unreadable imagery rather than carved text. v17/v18 with
 * photographic wood + heavy bevels confirmed this ceiling.
 *
 * v19 prioritizes READABILITY:
 *   - Fredoka-Bold font (chunky rounded sans-serif, premium feel)
 *   - Solid palette.deep letter fill (clearly readable on wood surface)
 *   - Subtle 1px cream stroke on upper-left edge (bevel highlight hint)
 *   - Subtle low-opacity PFP-color glow behind letters (identity color
 *     without obscuring letter shapes)
 *
 * Cinematic carve effects (photographic wood inside letters, per-letter
 * resin pulses, beveled rim AO) are parked for larger UI elements where
 * pixel real estate allows them to read — chat bubbles get clean,
 * readable, premium-feeling text instead.
 */
import React, { useMemo } from "react";
import { Platform } from "react-native";
import {
  Canvas,
  Group,
  Rect,
  Text as SkiaText,
  RadialGradient,
  matchFont,
  useFont,
  vec,
  rect,
} from "@shopify/react-native-skia";
import { pickWoodPalette } from "@/lib/woodPalettes";

interface BananaGroveCarvedTextProps {
  text: string;
  maxWidth: number;
  fontSize?: number;
  pfpColor: string;
}

const HIGHLIGHT_COLOR = "rgba(255, 230, 175, 0.55)";
const HIGHLIGHT_DX = -0.8;
const HIGHLIGHT_DY = -0.8;

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
  // Try Fredoka-Bold (bundled), fall back to system bold if it can't load.
  const fredokaFont = useFont(
    require("../../assets/fonts/Fredoka-Bold.ttf"),
    Math.round(fontSize),
  );
  const systemFont = useMemo(() => {
    try {
      return matchFont({
        fontFamily: Platform.select({ ios: "Helvetica", default: "sans-serif" }),
        fontSize: Math.round(fontSize),
        fontStyle: "normal",
        fontWeight: "700",
      });
    } catch { return null; }
  }, [fontSize]);
  const font = fredokaFont ?? systemFont;

  const palette = useMemo(() => pickWoodPalette(pfpColor), [pfpColor]);

  const { lines, lineHeight, totalHeight } = useMemo(() => {
    if (!font) return { lines: [] as string[], lineHeight: 0, totalHeight: 0 };
    const lh = fontSize * 1.35;
    const ls = wrapLines(text, font, maxWidth);
    return { lines: ls, lineHeight: lh, totalHeight: lh * ls.length };
  }, [text, font, maxWidth, fontSize]);

  if (!font || lines.length === 0 || maxWidth <= 0) return null;

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
        const baselineY = PAD_Y + (i + 1) * lineHeight - lineHeight * 0.28;
        const baseX = PAD_X;
        const glyphTop = baselineY - fontSize * 0.85;
        const glyphHeight = fontSize * 1.1;
        const lineRect = rect(baseX - 4, glyphTop, maxWidth + 8, glyphHeight);

        // Single PFP-color radial glow per line, masked to letter shapes.
        // Low alpha so it tints letters with sender's identity color but
        // doesn't obscure the letter outlines.
        const glowCx = baseX + maxWidth * 0.45;
        const glowCy = glyphTop + glyphHeight * 0.5;

        return (
          <Group key={i}>
            {/* PFP-color glow inside letter shapes (subtle) */}
            <Group>
              <Rect rect={lineRect}>
                <RadialGradient
                  c={vec(glowCx, glowCy)}
                  r={glyphHeight * 1.4}
                  colors={[
                    `${pfpColor}55`,
                    `${pfpColor}22`,
                    `${pfpColor}00`,
                  ]}
                />
              </Rect>
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

            {/* Subtle cream highlight offset up-left (bevel hint) */}
            <SkiaText
              text={line}
              x={baseX + HIGHLIGHT_DX}
              y={baselineY + HIGHLIGHT_DY}
              font={font}
              color={HIGHLIGHT_COLOR}
            />

            {/* Main carve fill — solid palette.deep, readable letters */}
            <SkiaText
              text={line}
              x={baseX}
              y={baselineY}
              font={font}
              color={palette.deep}
            />
          </Group>
        );
      })}
    </Canvas>
  );
});
