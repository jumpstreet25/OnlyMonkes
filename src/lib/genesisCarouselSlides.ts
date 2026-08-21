/**
 * Genesis Chat FOMO carousel — shown once to Genesis-token-only holders
 * (Saga/Seeker Genesis Token, no Saga Monke) the first time they land on
 * Genesis Chat. Pitches what a Saga Monke unlocks, ending on a buy CTA.
 * Reuses OnboardingCarousel's Slide shell — see src/components/OnboardingCarousel.tsx.
 */

import type { Slide } from "@/components/OnboardingCarousel";

export const GENESIS_CAROUSEL_KEY = "genesis_carousel_seen_v1";

export const GENESIS_CAROUSEL_SLIDES: Slide[] = [
  {
    emoji: "🐒",
    emojiBg: "#FFD70022",
    accentClr: "#FFD700",
    title: "Welcome to Genesis Chat",
    subtitle: "Your Solana phone's Genesis Token got you in the door",
    features: "Swipe to see what a Saga Monke unlocks beyond this room",
    gradient: ["#1a1200", "#0a0a14"],
  },
  {
    emoji: "💬",
    emojiBg: "#6CB4EE22",
    accentClr: "#6CB4EE",
    title: "Main Chat is Monke-only",
    subtitle: "The real conversation happens next door",
    features:
      "Live E2E encrypted group chat with every Saga Monke holder — GIFs, reactions, replies, tappable $TOKEN tickers. Genesis Chat is read-only; Main Chat is where you'd actually talk.",
    gradient: ["#0a1420", "#0a0a14"],
  },
  {
    emoji: "🤖",
    emojiBg: "#9c7cff22",
    accentClr: "#9c7cff",
    title: "AI Agent #9385 doesn't DM Genesis holders",
    subtitle: "Real-time trading intelligence, Monke-only",
    features:
      "Saga Monke holders DM the bot for /limit orders, /dca, /hermes stats, /chart, AutonoMonke automated trading, and live TA alerts. None of that reaches Genesis Chat.",
    gradient: ["#100a1e", "#0a0a14"],
  },
  {
    emoji: "🎭",
    emojiBg: "#FF6B6B22",
    accentClr: "#FF6B6B",
    title: "Avatar Rooms & Video Calls",
    subtitle: "Go live with an animated NFT avatar",
    features:
      "Monke holders start face-tracked Avatar Rooms and video calls straight from Main Chat. Your Genesis Token doesn't have a PFP to animate — a Saga Monke does.",
    gradient: ["#1a0a0a", "#0a0a14"],
  },
  {
    emoji: "📈",
    emojiBg: "#44ff8822",
    accentClr: "#44ff88",
    title: "The Leaderboard has a Monke-only side",
    subtitle: "You can watch. Monke holders compete.",
    features:
      "You've got Leaderboard and BananaShop access already — but only Saga Monke holders show up on the win-rate rankings and get full trading history tracked.",
    gradient: ["#001410", "#0a0a14"],
  },
  {
    emoji: "🍌",
    emojiBg: "#FFD54F22",
    accentClr: "#FFD54F",
    title: "One NFT away",
    subtitle: "Buy a Saga Monke, unlock everything above",
    features: "Tap below to check Saga Monkes on Tensor — same wallet, instant upgrade.",
    gradient: ["#1a1400", "#0a0a14"],
  },
];
