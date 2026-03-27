/**
 * bananaAuctions.ts — Limited drops and timed auctions.
 *
 * Seasonal items drop for 48 hours. Users bid bananas + SOL.
 * Highest bidder at end wins. Others get bananas refunded.
 * Creates FOMO + scarcity + revenue.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const AK_AUCTIONS = "banana_auctions_v1";

export interface AuctionItem {
  id: string;
  name: string;
  description: string;
  emoji: string;
  shopItemId: string;       // The shop item being auctioned
  // Timing
  startsAt: number;         // epoch ms
  endsAt: number;           // epoch ms
  // Pricing
  startingBid: number;      // minimum bananas
  minBidIncrement: number;  // must bid at least this much more than current
  solCost: number;          // SOL paid on top of banana bid (to dev wallet)
}

export interface Bid {
  inboxId: string;
  username: string;
  bananas: number;
  timestamp: number;
}

export interface AuctionState {
  active: AuctionItem[];
  bids: Record<string, Bid[]>;    // auctionId → bids (sorted by amount desc)
  won: Record<string, string>;    // auctionId → winner inboxId
}

// ─── Upcoming / Active Auctions ──────────────────────────────────────────────

const SCHEDULED_AUCTIONS: AuctionItem[] = [
  {
    id: "auction_breakpoint_2026",
    name: "Breakpoint 2026 Holographic",
    description: "Ultra-rare holographic bubble — only 1 winner",
    emoji: "🏟️",
    shopItemId: "bubble_breakpoint_2026",
    startsAt: new Date("2026-09-18T00:00:00Z").getTime(),
    endsAt: new Date("2026-09-20T00:00:00Z").getTime(),
    startingBid: 100,
    minBidIncrement: 25,
    solCost: 0.5,
  },
  {
    id: "auction_golden_monke",
    name: "Golden Monke Theme",
    description: "Full gold theme — the ultimate flex. 48h auction.",
    emoji: "👑",
    shopItemId: "theme_banana",
    startsAt: new Date("2026-04-01T00:00:00Z").getTime(),
    endsAt: new Date("2026-04-03T00:00:00Z").getTime(),
    startingBid: 200,
    minBidIncrement: 50,
    solCost: 1.0,
  },
];

export async function loadAuctionState(): Promise<AuctionState> {
  try {
    const raw = await AsyncStorage.getItem(AK_AUCTIONS);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { active: [], bids: {}, won: {} };
}

async function saveAuctionState(state: AuctionState): Promise<void> {
  await AsyncStorage.setItem(AK_AUCTIONS, JSON.stringify(state));
}

/** Get currently active auctions (started and not ended). */
export function getActiveAuctions(): AuctionItem[] {
  const now = Date.now();
  return SCHEDULED_AUCTIONS.filter(a => now >= a.startsAt && now <= a.endsAt);
}

/** Get upcoming auctions (not started yet). */
export function getUpcomingAuctions(): AuctionItem[] {
  const now = Date.now();
  return SCHEDULED_AUCTIONS.filter(a => now < a.startsAt);
}

/** Get the current highest bid for an auction. */
export async function getHighestBid(auctionId: string): Promise<Bid | null> {
  const state = await loadAuctionState();
  const bids = state.bids[auctionId] ?? [];
  return bids.length > 0 ? bids[0] : null;
}

/** Place a bid. Returns success + error message. */
export async function placeBid(
  auctionId: string,
  inboxId: string,
  username: string,
  bananas: number,
): Promise<{ success: boolean; error?: string }> {
  const auction = SCHEDULED_AUCTIONS.find(a => a.id === auctionId);
  if (!auction) return { success: false, error: "Auction not found" };

  const now = Date.now();
  if (now < auction.startsAt) return { success: false, error: "Auction hasn't started yet" };
  if (now > auction.endsAt) return { success: false, error: "Auction has ended" };

  const state = await loadAuctionState();
  const bids = state.bids[auctionId] ?? [];
  const currentHigh = bids.length > 0 ? bids[0].bananas : 0;

  if (bananas < auction.startingBid) {
    return { success: false, error: `Minimum bid is ${auction.startingBid} 🍌` };
  }
  if (bids.length > 0 && bananas < currentHigh + auction.minBidIncrement) {
    return { success: false, error: `Must bid at least ${currentHigh + auction.minBidIncrement} 🍌` };
  }

  // Add bid (sorted highest first)
  bids.unshift({ inboxId, username, bananas, timestamp: now });
  bids.sort((a, b) => b.bananas - a.bananas);
  state.bids[auctionId] = bids;

  await saveAuctionState(state);
  return { success: true };
}

/** Check and finalize ended auctions. Returns winner info if any. */
export async function finalizeAuctions(): Promise<Array<{
  auction: AuctionItem;
  winner: Bid;
}>> {
  const now = Date.now();
  const state = await loadAuctionState();
  const results: Array<{ auction: AuctionItem; winner: Bid }> = [];

  for (const auction of SCHEDULED_AUCTIONS) {
    if (now <= auction.endsAt) continue; // still active
    if (state.won[auction.id]) continue; // already finalized

    const bids = state.bids[auction.id] ?? [];
    if (bids.length > 0) {
      const winner = bids[0];
      state.won[auction.id] = winner.inboxId;
      results.push({ auction, winner });
    }
  }

  if (results.length > 0) await saveAuctionState(state);
  return results;
}

/** Format time remaining for display. */
export function formatTimeRemaining(endsAt: number): string {
  const ms = endsAt - Date.now();
  if (ms <= 0) return "Ended";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}
