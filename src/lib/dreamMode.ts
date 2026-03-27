/**
 * dreamMode.ts — AI Dream Mode.
 *
 * After completing a full 7-day banana cycle, the user unlocks a
 * personalized "trading dream" — Hermes analyzes their trade history,
 * chat personality, and banana habits, then generates a unique
 * narrative visualization.
 *
 * The dream is shareable to X and can be minted as a soulbound cNFT.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const AK_DREAMS = "dream_mode_v1";

export interface DreamScene {
  id: string;
  generatedAt: number;
  cycle: number;              // Which banana cycle triggered this dream
  // AI-generated content
  title: string;              // e.g. "The Jungle of Diamond Hands"
  narrative: string;          // 3-5 sentence dream description
  emoji: string;              // Dominant emoji for the dream
  mood: "bullish" | "chaotic" | "zen" | "legendary";
  // Visual parameters (for rendering)
  bgGradient: [string, string]; // Two hex colors for gradient background
  particleColor: string;
  // Metadata
  tradesSummary: string;      // "5 wins, 2 losses, +12.3% total"
  topToken: string;           // Best performing token this cycle
  bananaEarned: number;       // Bananas earned during this cycle
  // Share
  shareText: string;          // Pre-built tweet
  mintable: boolean;          // Can be minted as cNFT
  minted: boolean;            // Already minted
}

export interface DreamState {
  dreams: DreamScene[];
  lastCycleGenerated: number; // Which cycle number was last generated
}

export async function loadDreamState(): Promise<DreamState> {
  try {
    const raw = await AsyncStorage.getItem(AK_DREAMS);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { dreams: [], lastCycleGenerated: 0 };
}

async function saveDreamState(state: DreamState): Promise<void> {
  await AsyncStorage.setItem(AK_DREAMS, JSON.stringify(state));
}

// ─── Dream Templates ─────────────────────────────────────────────────────────
// Hermes generates the narrative, but we have fallback templates for offline.

interface DreamTemplate {
  mood: DreamScene["mood"];
  titles: string[];
  narratives: string[];
  bgGradients: [string, string][];
  particleColors: string[];
  emojis: string[];
}

const TEMPLATES: DreamTemplate[] = [
  {
    mood: "bullish",
    titles: [
      "The Banana Rocket",
      "Green Candles Rising",
      "The Bull Run Dream",
      "Moonbound Monke",
    ],
    narratives: [
      "You stand atop a mountain of green candles, the wind carrying the scent of freshly peeled bananas. Every trade you touched turned gold. The charts bent to your will.",
      "A river of SOL flows through a jungle of profit. Your positions glow like fireflies. The bears are silent. The bananas are ripe.",
      "You ride a golden bull through fields of 4h candles. Each fibonacci level is a stepping stone across a sky of pure gains.",
    ],
    bgGradients: [["#0a2e0a", "#1a4a1a"], ["#0a1e3d", "#1a3a5d"]],
    particleColors: ["#10B981", "#FFD54F"],
    emojis: ["🚀", "🌙", "📈", "💎"],
  },
  {
    mood: "chaotic",
    titles: [
      "The Meme Tornado",
      "Volatility Fever Dream",
      "Liquidation Nightclub",
      "The Degen Spiral",
    ],
    narratives: [
      "Candles flip like pancakes. Red, green, red, green. You're laughing while the market burns. A banana peel slips under the bears. Chaos is your friend.",
      "Meme coins rain from the sky like confetti. You catch $BONK in one hand and $WIF in the other. Somewhere, a whale is crying. You are dancing.",
      "The chart is a rollercoaster built by a drunk monkey. You're in the front seat, arms up, screaming with joy while everyone else reaches for the sell button.",
    ],
    bgGradients: [["#2a0a2a", "#4a1a4a"], ["#1a0a0a", "#3a1a1a"]],
    particleColors: ["#ff69b4", "#9945FF"],
    emojis: ["🌪️", "🎰", "🤡", "⚡"],
  },
  {
    mood: "zen",
    titles: [
      "The Calm Before the Pump",
      "Meditation on Confluence",
      "The Patient Monke",
      "Stillwater Gains",
    ],
    narratives: [
      "The charts are still. A single candle flickers. You wait. The RSI whispers secrets. Patience is the sharpest blade in the jungle.",
      "Bananas grow slowly on the vine. You sit cross-legged on a cloud of unrealized gains. The market breathes. You breathe with it.",
      "A garden of stop-losses blooms around your positions. Each one carefully placed. The wind carries no fear here. Only discipline.",
    ],
    bgGradients: [["#0a0a2e", "#1a1a4e"], ["#0a1a1a", "#1a2a2a"]],
    particleColors: ["#6CB4EE", "#88ccff"],
    emojis: ["🧘", "🌊", "🍃", "✨"],
  },
  {
    mood: "legendary",
    titles: [
      "The Golden Monke Ascends",
      "Alpha Among Apes",
      "The Signal That Changed Everything",
      "Crown of Bananas",
    ],
    narratives: [
      "Thunder cracks as you descend from the mountain. In your hand, the perfect trade. 100% confluence. 4/4 timeframes aligned. The chat goes silent. Then erupts.",
      "A crown of golden bananas materializes on your head. The leaderboard bows. Hermes himself tips his hat. You didn't just win — you became legend.",
      "The charts form your name in candlesticks. Every signal you called was right. Every stop-loss held. The jungle whispers your name: Alpha Ape.",
    ],
    bgGradients: [["#1a1a00", "#3a3a0a"], ["#1a0a00", "#3a1a00"]],
    particleColors: ["#FFD54F", "#ff9900"],
    emojis: ["👑", "🔥", "⭐", "🏆"],
  },
];

/**
 * Generate a dream after completing a banana cycle.
 * Uses trade history context to pick the right mood.
 */
export async function generateDream(
  cycleNumber: number,
  context: {
    totalTrades?: number;
    winRate?: number;
    topToken?: string;
    bananaEarned?: number;
    totalBananas?: number;
  },
): Promise<DreamScene | null> {
  const state = await loadDreamState();

  // Already generated for this cycle
  if (state.lastCycleGenerated >= cycleNumber) return null;

  // Pick mood based on trade performance
  let mood: DreamScene["mood"];
  if ((context.winRate ?? 0) >= 80 || (context.totalTrades ?? 0) >= 20) {
    mood = "legendary";
  } else if ((context.winRate ?? 0) >= 60) {
    mood = "bullish";
  } else if ((context.totalTrades ?? 0) >= 5) {
    mood = "chaotic";
  } else {
    mood = "zen";
  }

  const template = TEMPLATES.find(t => t.mood === mood) ?? TEMPLATES[0];
  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  const title = pick(template.titles);
  const narrative = pick(template.narratives);
  const bgGradient = pick(template.bgGradients);
  const particleColor = pick(template.particleColors);
  const emoji = pick(template.emojis);

  const tradesSummary = context.totalTrades
    ? `${context.totalTrades} trades at ${context.winRate ?? 0}% WR`
    : "No trades this cycle";

  const dream: DreamScene = {
    id: `dream-${cycleNumber}-${Date.now()}`,
    generatedAt: Date.now(),
    cycle: cycleNumber,
    title,
    narrative,
    emoji,
    mood,
    bgGradient,
    particleColor,
    tradesSummary,
    topToken: context.topToken ?? "SOL",
    bananaEarned: context.bananaEarned ?? 110,
    shareText: `${emoji} "${title}" — my AI trading dream on @xOnlyMonkes\n\n"${narrative.slice(0, 100)}..."\n\nGenerated by Hermes after my ${cycleNumber}${cycleNumber === 1 ? "st" : cycleNumber === 2 ? "nd" : "th"} banana cycle 🐒🍌\n\n#OnlyMonkes #SolanaMobile`,
    mintable: true,
    minted: false,
  };

  state.dreams.push(dream);
  state.lastCycleGenerated = cycleNumber;
  await saveDreamState(state);

  return dream;
}

/** Get all generated dreams for the user. */
export async function getAllDreams(): Promise<DreamScene[]> {
  const state = await loadDreamState();
  return state.dreams;
}

/** Mark a dream as minted (cNFT). */
export async function markDreamMinted(dreamId: string): Promise<void> {
  const state = await loadDreamState();
  const dream = state.dreams.find(d => d.id === dreamId);
  if (dream) {
    dream.minted = true;
    await saveDreamState(state);
  }
}
