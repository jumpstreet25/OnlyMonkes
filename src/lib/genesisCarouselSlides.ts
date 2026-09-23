/**
 * Genesis Chat FOMO carousel — shown once to Genesis-token-only holders
 * (Saga/Seeker Genesis Token, no Saga Monke) the first time they land on
 * Genesis Chat. Pitches what a Saga Monke unlocks, ending on a buy CTA.
 * Reuses OnboardingCarousel's Slide shell — see src/components/OnboardingCarousel.tsx.
 *
 * title/subtitle/features live in locales/{en,es}.json under
 * genesisCarousel.slides, merged in by index via useGenesisCarouselSlides().
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Slide } from "@/components/OnboardingCarousel";

export const GENESIS_CAROUSEL_KEY = "genesis_carousel_seen_v1";

const GENESIS_CAROUSEL_VISUALS: readonly Omit<Slide, "title" | "subtitle" | "features">[] = [
  { emoji: "🐒", emojiBg: "#FFD70022", accentClr: "#FFD700", gradient: ["#1a1200", "#0a0a14"] },
  { emoji: "💬", emojiBg: "#6CB4EE22", accentClr: "#6CB4EE", gradient: ["#0a1420", "#0a0a14"] },
  { emoji: "🤖", emojiBg: "#9c7cff22", accentClr: "#9c7cff", gradient: ["#100a1e", "#0a0a14"] },
  { emoji: "🎭", emojiBg: "#FF6B6B22", accentClr: "#FF6B6B", gradient: ["#1a0a0a", "#0a0a14"] },
  { emoji: "📈", emojiBg: "#44ff8822", accentClr: "#44ff88", gradient: ["#001410", "#0a0a14"] },
  { emoji: "🍌", emojiBg: "#FFD54F22", accentClr: "#FFD54F", gradient: ["#1a1400", "#0a0a14"] },
];

export function useGenesisCarouselSlides(): Slide[] {
  const { t } = useTranslation();
  return useMemo(() => {
    const text = t("genesisCarousel.slides", { returnObjects: true }) as
      Pick<Slide, "title" | "subtitle" | "features">[];
    return GENESIS_CAROUSEL_VISUALS.map((visual, i) => ({ ...visual, ...text[i] }));
  }, [t]);
}
