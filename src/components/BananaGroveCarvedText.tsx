/**
 * BananaGroveCarvedText — Phase 2 v17 (2026-05-08).
 *
 * Cinematic carved-into-wood text rendering, targeting the user's
 * reference image (chunky Fredoka serif letters carved into photographic
 * wood with PFP-color glow inside the grooves).
 *
 * Architecture:
 *   1. Load Fredoka-Bold.ttf as the carved-text font (chunky rounded
 *      letterforms — heavier letterform than system bold, gives the
 *      bevel + glow more pixel real estate to read at chat sizes).
 *   2. Load TextureGrove.png photographic wood texture, used as the
 *      destination INSIDE the carved-text mask. Letters show the same
 *      photographic wood as the bubble surface — continuity of material.
 *   3. Mask via BlendMode.dstIn — the wood texture (darkened) is clipped
 *      to the letter glyph shapes. Outside letters: transparent.
 *   4. PFP-color RadialGradient resin glow rendered INSIDE the mask
 *      (also clipped to letter shapes) — gives the carved interior its
 *      "illuminated wood stain" feel with subsurface-scatter character.
 *   5. Bevel: bright cream highlight stroke offset up-left (light catching
 *      the carve's upper edge) + dark stroke offset down-right (deepest
 *      shadow at the carve's lower lip).
 */
import React, { useMemo } from "react";
import {
  Canvas,
  Group,
  Rect,
  Text as SkiaText,
  ImageShader,
  RadialGradient,
  useFont,
  useImage,
  vec,
  rect,
} from "@shopify/react-native-skia";
import { pickWoodPalette } from "@/lib/woodPalettes";

interface BananaGroveCarvedTextProps {
  text: string;
  /** Max width available for text (the bubble's content-area width). */
  maxWidth: number;
  /** Font size — defaults to 15. Multiplied by user's textScale upstream. */
  fontSize?: number;
  /** Sender's PFP color — drives the resin-glow color inside the carve. */
  pfpColor: string;
}

// Bevel offsets — small but enough to catch the sharp Fredoka edges.
const BEVEL_OFFSET = 1;

// Cream stroke for the top-edge bevel highlight (light catching upper rim
// of the V-shape carve). Bright + warm so it reads against any wood tone.
const BEVEL_HIGHLIGHT = "rgba(255, 230, 175, 0.9)";
// Dark stroke for the bottom-edge bevel ambient occlusion (deepest shadow
// at the carve's lower lip).
const BEVEL_AO = "rgba(0, 0, 0, 0.85)";

// Multiplier overlay alpha for darkening the wood texture inside the carve.
// Real carved letters expose deeper wood that's been in shadow — we darken
// the same texture by ~45% inside the mask.
const CARVE_DARKEN_ALPHA = 0.45;

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
  // Fredoka-Bold font (chunky rounded sans-serif, weight 700).
  const font = useFont(
    require("../../assets/fonts/Fredoka-Bold.ttf"),
    Math.round(fontSize),
  );
  // Photographic wood texture — same source as the bubble surface so the
  // carve interior shows the SAME wood, just darker.
  const woodTexture = useImage(
    require("../../assets/textures/TextureGrove.png"),
  );

  // PFP-color resin centers — picked deterministically from the message
  // text so the same message always pulses the same way. Each center is
  // a normalized (0-1) position relative to the line bounds. 2 centers
  // per line for "uneven" pooling per the user spec.
  const palette = useMemo(() => pickWoodPalette(pfpColor), [pfpColor]);

  const { lines, lineHeight, totalHeight } = useMemo(() => {
    if (!font) return { lines: [] as string[], lineHeight: 0, totalHeight: 0 };
    const lh = fontSize * 1.35; // Fredoka has tall x-height; needs slight extra
    const ls = wrapLines(text, font, maxWidth);
    return { lines: ls, lineHeight: lh, totalHeight: lh * ls.length };
  }, [text, font, maxWidth, fontSize]);

  if (!font || !woodTexture || lines.length === 0 || maxWidth <= 0) return null;

  const PAD_X = 8;
  const PAD_Y = 8;
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
        const glyphBottom = baselineY + fontSize * 0.20;
        const glyphHeight = glyphBottom - glyphTop;
        const lineRect = rect(baseX - 4, glyphTop, maxWidth + 8, glyphHeight);

        // Per-line resin centers — deterministic positions seeded by line
        // index so each line has its own glow distribution.
        const c1x = baseX + (Math.abs(Math.sin(i * 11.3)) % 1) * maxWidth * 0.5 + maxWidth * 0.1;
        const c1y = glyphTop + glyphHeight * 0.5;
        const c2x = baseX + maxWidth * 0.5 + (Math.abs(Math.cos(i * 7.7)) % 1) * maxWidth * 0.4;
        const c2y = glyphTop + glyphHeight * 0.55;

        return (
          <Group key={i}>
            {/* ── Layer A: wood texture + dark overlay + PFP resin glow,
                  all clipped to the letter glyph shapes via dstIn mask. */}
            <Group>
              {/* A1: photographic wood texture covering the line bounds */}
              <Rect rect={lineRect}>
                <ImageShader
                  image={woodTexture}
                  fit="cover"
                  rect={lineRect}
                />
              </Rect>
              {/* A2: dark multiply overlay — darkens the wood inside the
                    carve so it reads as recessed (deeper wood layer). */}
              <Rect
                rect={lineRect}
                color={`rgba(0, 0, 0, ${CARVE_DARKEN_ALPHA})`}
              />
              {/* A3: PFP-color resin glows — two RadialGradients at
                    different positions for "uneven pooling" per spec. */}
              <Rect rect={lineRect}>
                <RadialGradient
                  c={vec(c1x, c1y)}
                  r={glyphHeight * 1.2}
                  colors={[
                    `${pfpColor}CC`,  // ~80% alpha at center
                    `${pfpColor}55`,  // ~33% mid
                    `${pfpColor}00`,  // 0% edge
                  ]}
                />
              </Rect>
              <Rect rect={lineRect}>
                <RadialGradient
                  c={vec(c2x, c2y)}
                  r={glyphHeight * 1.0}
                  colors={[
                    `${pfpColor}AA`,
                    `${pfpColor}44`,
                    `${pfpColor}00`,
                  ]}
                />
              </Rect>
              {/* A4: text glyphs as alpha mask via dstIn — keeps the
                    layered destination only where the text is opaque. */}
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

            {/* ── Layer B: bevel AMBIENT OCCLUSION — dark stroke offset
                  down-right by 1 px. Reads as the deepest shadow at the
                  bottom-right lip of the carve (where the V-shape interior
                  meets the wood surface, in deepest shadow). */}
            <SkiaText
              text={line}
              x={baseX + BEVEL_OFFSET}
              y={baselineY + BEVEL_OFFSET}
              font={font}
              color={BEVEL_AO}
              opacity={0.55}
            />

            {/* ── Layer C: bevel HIGHLIGHT — bright cream stroke offset
                  up-left by 1 px. Reads as overhead light catching the
                  upper-left rim of the V-carve. Renders ON TOP so it's
                  the brightest visible feature, defining the carve edge. */}
            <SkiaText
              text={line}
              x={baseX - BEVEL_OFFSET}
              y={baselineY - BEVEL_OFFSET}
              font={font}
              color={BEVEL_HIGHLIGHT}
              opacity={0.55}
            />
          </Group>
        );
      })}
    </Canvas>
  );
});
