/**
 * monkeCopy.ts — Monke-personality error messages and microcopy.
 *
 * Replaces generic error strings with fun, on-brand messages.
 * Randomized so users don't see the same one twice in a row.
 */

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ─── Network / Connection ────────────────────────────────────────────────────

const NETWORK_ERRORS = [
  "Ooh ooh — the blockchain ghosted us. Try again?",
  "Signal weaker than a paper-handed sell. Check your connection.",
  "Even monkes need wifi. Network's down.",
  "The internet went on a banana break. Back soon.",
  "Connection dropped harder than a rug pull.",
];

export function networkError(): string { return pick(NETWORK_ERRORS); }

// ─── Transaction Failed ──────────────────────────────────────────────────────

const TX_ERRORS = [
  "Transaction failed. The blockchain said nah.",
  "Ooh ooh — that tx got rejected harder than a 3am DM.",
  "Swap didn't go through. Even Jupiter couldn't save this one.",
  "Transaction failed. Much like my patience. Try again?",
  "The chain ate your tx and burped. Retry.",
];

export function txError(): string { return pick(TX_ERRORS); }

// ─── LLM / Bot Timeout ──────────────────────────────────────────────────────

const LLM_ERRORS = [
  "Brain freeze. The AI is buffering. Give it a sec.",
  "Ooh ooh — even monke brains need a reboot sometimes.",
  "AI Agent #9385 is taking a banana break. Try again.",
  "The bot's thinking so hard it forgot to respond.",
  "Hermes fell asleep. Poking him with a stick...",
];

export function llmError(): string { return pick(LLM_ERRORS); }

// ─── Empty States ────────────────────────────────────────────────────────────

const EMPTY_CHAT = [
  "Crickets. Be the first monke to speak.",
  "This chat is emptier than a bear's wallet.",
  "No messages yet. Break the ice, brave monke.",
];

const EMPTY_EVENTS = [
  "No events on the horizon. Create one!",
  "The calendar is as bare as a shaved monke.",
  "Zero events. Someone throw a party.",
];

const EMPTY_GLOBE = [
  "No monkes on the map yet. Set your location!",
  "The globe is lonely. Plant your flag.",
  "Earth exists. Monkes on it? Not yet.",
];

const EMPTY_LINKS = [
  "No links shared yet. Drop some alpha.",
  "Link desert. Share something useful.",
];

const EMPTY_LEADERBOARD = [
  "Leaderboard is empty. Be the first Alpha Ape.",
  "No clout yet. Start stacking.",
];

export function emptyChat(): string { return pick(EMPTY_CHAT); }
export function emptyEvents(): string { return pick(EMPTY_EVENTS); }
export function emptyGlobe(): string { return pick(EMPTY_GLOBE); }
export function emptyLinks(): string { return pick(EMPTY_LINKS); }
export function emptyLeaderboard(): string { return pick(EMPTY_LEADERBOARD); }

// ─── Success Messages ────────────────────────────────────────────────────────

const SUCCESS = [
  "Done. You're welcome.",
  "Boom. Nailed it.",
  "Ooh ooh — smooth like a banana smoothie.",
  "Transaction confirmed. That's how we roll.",
];

export function success(): string { return pick(SUCCESS); }

// ─── Onboarding ──────────────────────────────────────────────────────────────

export const ONBOARDING_SCREENS = [
  {
    emoji: "🍌",
    title: "Earn Bananas Daily",
    body: "Open the app every day to earn bananas. 7-day streak = bonus payout. Bananas unlock UI customizations in the Banana Shop.",
  },
  {
    emoji: "🌍",
    title: "Monke Globe",
    body: "Set your location in your profile. See where Saga Monkes are worldwide and find Solana events near you.",
  },
  {
    emoji: "🐒",
    title: "Your Community",
    body: "Tap the banana pill to access Messages, Events, Marketplace, Tools, and Settings. AI Agent #9385 is always watching — tag or DM the bot anytime.",
  },
];
