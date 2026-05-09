/**
 * BadgeGlyph — Skia-rendered badge replacement for emoji glyphs.
 *
 * Used by the Badge system across MessageBubble (sender-name suffix),
 * ProfileScorecard (milestone pills), UserProfileModal (achievements grid),
 * and BadgeNotificationBanner (top toast).
 *
 * Resolution rules (v41 2026-05-09):
 *   - Each badge emoji → matching MenuIcon glyph + "natural" color
 *     (gold for trophy/crown, red for flame, cyan for gem, etc.)
 *   - Unknown emoji → render the original Text emoji as a fallback so
 *     no badge ever disappears, even if we add a new one in `badges.ts`
 *     before adding the Skia counterpart here.
 */

import React from "react";
import { Text, StyleSheet } from "react-native";
import { MenuIcon, type MenuIconName } from "./MenuIcon";

interface GlyphMap {
  name: MenuIconName;
  color: string;
}

// Natural per-emoji colors. Banana stays brand-yellow; gold for legendary
// achievements; cyan for diamond/gem; red-orange for flame; etc.
const EMOJI_TO_GLYPH: Record<string, GlyphMap> = {
  // badges.ts (cosmetic milestones)
  "✉️":   { name: "letter",    color: "#E8DDC4" },
  "💬":   { name: "speech",    color: "#7BC9FF" },
  "🍌":   { name: "banana",    color: "#FFD24A" },
  "👑":   { name: "crown",     color: "#FFD54F" },
  "🎉":   { name: "confetti",  color: "#FF8FB1" },
  "🔥":   { name: "flame",     color: "#FF7A4D" },
  "🌟":   { name: "star",      color: "#FFD54F" },
  "💎":   { name: "gem",       color: "#7CE0E0" },
  "🏆":   { name: "trophy",    color: "#FFD54F" },
  "🐒":   { name: "monkeface", color: "#C68C5A" },
  "📈":   { name: "chart_up",  color: "#54E08C" },
  // activityBadges.ts extras
  "🌴":   { name: "palm",      color: "#54C089" },
  "🎯":   { name: "target",    color: "#FF6F6F" },
  "🎁":   { name: "gift",      color: "#FF8FB1" },
  "⚡":    { name: "bolt",      color: "#FFD54F" },
  "🍀":   { name: "clover",    color: "#54E08C" },
  // Inline name-suffix flair (MessageBubble)
  "🦍":   { name: "gorilla",   color: "#A98C6C" },
};

interface BadgeGlyphProps {
  emoji: string;
  size?: number;
  /** Override the natural color (e.g., dim to alpha for chat suffix). */
  colorOverride?: string;
}

export const BadgeGlyph = React.memo(function BadgeGlyph({
  emoji,
  size = 18,
  colorOverride,
}: BadgeGlyphProps) {
  const map = EMOJI_TO_GLYPH[emoji];
  if (!map) {
    // Unknown emoji — fall through to Text rendering at matching size.
    return <Text style={[styles.fallback, { fontSize: size * 0.85 }]}>{emoji}</Text>;
  }
  return <MenuIcon name={map.name} size={size} color={colorOverride ?? map.color} />;
});

const styles = StyleSheet.create({
  fallback: {
    lineHeight: undefined,
  },
});
