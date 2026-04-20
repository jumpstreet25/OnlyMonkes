/**
 * NFT Marketplace — P2P Saga Monkes Trading (Atomic Swap)
 *
 * Architecture:
 *   PUBLIC (group broadcast):
 *     NFT_LIST:<json>      — seller lists an NFT (all users see it)
 *     NFT_DELIST:<json>    — seller removes listing (all users see removal)
 *
 *   PRIVATE (DM to seller):
 *     NFT_BID:<json>       — buyer places a SOL bid
 *     NFT_OFFER:<json>     — buyer offers an NFT-for-NFT swap
 *     NFT_ACCEPT:<json>    — seller accepts (triggers atomic swap)
 *     NFT_SWAP:<json>      — partially-signed swap tx
 *     NFT_COMPLETE:<json>  — swap completed on-chain
 *
 *   BROADCAST (MonkeSales channel):
 *     Completed sales/swaps are announced to the MonkeSales bot channel.
 *
 * Actual transfer uses atomic swap: NFT + SOL in a single Solana transaction.
 * All prices are in SOL.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PublicKey } from '@solana/web3.js';
import type { NftTrait } from '@/types';

const AK_LISTINGS = 'om_nft_listings';

/** Validate a Solana base58 address. Returns true if valid. */
function isValidSolAddress(addr: unknown): boolean {
  if (typeof addr !== 'string' || !addr) return false;
  try { new PublicKey(addr); return true; } catch { return false; }
}

// Swap transactions expire after 90 seconds (Solana blockhash TTL)
const SWAP_EXPIRY_MS = 90_000;

export interface NftListing {
  id: string;               // unique listing ID (mint + timestamp)
  mint: string;             // NFT mint address
  name: string;             // NFT name
  image: string | null;     // NFT image URI
  sellerInboxId: string;    // seller's XMTP inboxId
  sellerUsername?: string;
  sellerWallet: string;     // seller's Solana wallet address
  askPrice: number;         // asking price in SOL
  traits?: NftTrait[];      // NFT attributes (Background, Fur, Eyes, etc.)
  listedAt: Date;
  status: 'active' | 'pending_swap' | 'sold' | 'delisted';
  acceptedBid?: NftBid;     // which bid was accepted (during pending_swap)
  swapExpiresAt?: number;   // timestamp when pending_swap auto-reverts
}

export interface NftBid {
  listingId: string;
  bidderInboxId: string;
  bidderUsername?: string;
  bidderWallet: string;
  bidPrice: number;         // bid price in SOL
  bidAt: Date;
}

/** NFT-for-NFT swap offer (Monke Swap) */
export interface NftSwapOffer {
  listingId: string;        // listing being offered on
  offererInboxId: string;
  offererUsername?: string;
  offererWallet: string;
  offeredMint: string;      // the NFT the buyer is offering
  offeredName: string;
  offeredImage: string | null;
  solTopUp?: number;        // optional SOL added on top of NFT swap
  offeredAt: Date;
}

export interface NftSwapMessage {
  listingId: string;
  sellerInboxId: string;
  buyerInboxId: string;
  mint: string;
  solPrice: number;
  sellerWallet: string;
  buyerWallet: string;
  serializedTx: string;     // base64-encoded partially-signed transaction
  createdAt: number;
}

export interface NftCompleteMessage {
  listingId: string;
  signature: string;        // on-chain tx signature
  mint: string;
  solPrice: number;
  sellerInboxId?: string;
  sellerUsername?: string;
  buyerInboxId?: string;
  buyerUsername?: string;
  nftName?: string;
  nftImage?: string | null;
  completedAt: number;
}

// ── Order History ──────────────────────────────────────────────────────────

const AK_HISTORY = 'marketplace_history_v1';

export interface MarketplaceHistoryEntry {
  type: 'buy' | 'sell' | 'bid';
  nftName: string;
  price: number;         // SOL
  timestamp: number;     // Date.now()
  counterparty: string;  // username or 'anon'
  mint?: string;
  txSignature?: string;
}

let _history: MarketplaceHistoryEntry[] = [];

export async function loadHistory(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(AK_HISTORY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) _history = parsed;
    }
  } catch { /* non-critical */ }
}

function _persistHistory(): void {
  AsyncStorage.setItem(AK_HISTORY, JSON.stringify(_history)).catch(() => {});
}

export function recordHistoryEntry(entry: MarketplaceHistoryEntry): void {
  _history.unshift(entry); // newest first
  // Cap at 200 entries
  if (_history.length > 200) _history = _history.slice(0, 200);
  _persistHistory();
}

export function getHistory(): MarketplaceHistoryEntry[] {
  return _history;
}

// ── In-memory state ────────────────────────────────────────────────────────

let _listings: NftListing[] = [];
let _bids: Map<string, NftBid[]> = new Map(); // listingId → bids

// ── Message parsing ─────────────────────────────────────────────────────────

export function parseMarketplaceMessage(raw: string): {
  type: 'list' | 'bid' | 'offer' | 'accept' | 'delist' | 'swap' | 'complete';
  data: any;
} | null {
  const prefixes = [
    'NFT_LIST:', 'NFT_BID:', 'NFT_OFFER:', 'NFT_ACCEPT:',
    'NFT_DELIST:', 'NFT_SWAP:', 'NFT_COMPLETE:',
  ] as const;
  const types = ['list', 'bid', 'offer', 'accept', 'delist', 'swap', 'complete'] as const;
  // Reject oversized messages (DoS protection)
  if (raw.length > 50_000) return null;
  for (let i = 0; i < prefixes.length; i++) {
    if (raw.startsWith(prefixes[i])) {
      try {
        const data = JSON.parse(raw.slice(prefixes[i].length));
        // Validate required fields to prevent malformed payloads from crashing the app
        if (!data || typeof data !== "object") return null;
        if (types[i] === "list" && (!data.mint || !data.sellerWallet || typeof data.askPrice !== "number")) return null;
        if (types[i] === "bid" && (!data.listingId || !data.bidderInboxId || typeof data.bidPrice !== "number")) return null;
        if (types[i] === "accept" && (!data.listingId)) return null;
        if (types[i] === "delist" && !data.listingId) return null;
        return { type: types[i], data };
      } catch { return null; }
    }
  }
  return null;
}

// ── Public message builders (group broadcast) ───────────────────────────────

export function buildListMessage(listing: Omit<NftListing, 'id' | 'listedAt' | 'status'>): string {
  const id = `${listing.mint}-${Date.now()}`;
  return `NFT_LIST:${JSON.stringify({ ...listing, id, listedAt: Date.now() })}`;
}

export function buildDelistMessage(listingId: string): string {
  return `NFT_DELIST:${JSON.stringify({ listingId })}`;
}

// ── Private message builders (DM to seller/buyer) ───────────────────────────

export function buildBidMessage(
  bid: Omit<NftBid, 'bidAt'>,
  extra?: { sellerInboxId?: string; listingName?: string },
): string {
  return `NFT_BID:${JSON.stringify({ ...bid, ...extra, bidAt: Date.now() })}`;
}

export function buildOfferMessage(
  offer: Omit<NftSwapOffer, 'offeredAt'>,
  extra?: { sellerInboxId?: string; listingName?: string },
): string {
  return `NFT_OFFER:${JSON.stringify({ ...offer, ...extra, offeredAt: Date.now() })}`;
}

export function buildAcceptMessage(listingId: string, bidderInboxId: string): string {
  return `NFT_ACCEPT:${JSON.stringify({ listingId, bidderInboxId, acceptedAt: Date.now() })}`;
}

export function buildSwapMessage(swap: NftSwapMessage): string {
  return `NFT_SWAP:${JSON.stringify(swap)}`;
}

export function buildCompleteMessage(complete: NftCompleteMessage): string {
  return `NFT_COMPLETE:${JSON.stringify(complete)}`;
}

/** Build the MonkeSales channel broadcast for a completed trade */
export function buildSaleAnnouncement(complete: NftCompleteMessage): string {
  const buyer = complete.buyerUsername ?? 'anon';
  const seller = complete.sellerUsername ?? 'anon';
  const name = complete.nftName ?? 'Saga Monke';
  const price = complete.solPrice;
  const sig = complete.signature.slice(0, 8);
  return `MSG:AI Agent #9385:🐒 **SOLD** — ${name}\n${seller} → ${buyer} for ${price} SOL\ntx: ${sig}…`;
}

// ── State management ────────────────────────────────────────────────────────

export function addListing(data: any): NftListing {
  if (!Number.isFinite(data.askPrice) || data.askPrice <= 0 || data.askPrice > 100_000) {
    throw new Error("Invalid ask price");
  }
  if (!isValidSolAddress(data.mint)) throw new Error("Invalid NFT mint address");
  if (!isValidSolAddress(data.sellerWallet)) throw new Error("Invalid seller wallet address");
  const listing: NftListing = {
    id: data.id,
    mint: data.mint,
    name: data.name,
    image: data.image ?? null,
    sellerInboxId: data.sellerInboxId,
    sellerUsername: data.sellerUsername,
    sellerWallet: data.sellerWallet,
    askPrice: data.askPrice,
    traits: data.traits ?? undefined,
    listedAt: new Date(data.listedAt),
    status: 'active',
  };
  // Replace existing listing for same mint from same seller
  _listings = _listings.filter(
    l => !(l.mint === listing.mint && l.sellerInboxId === listing.sellerInboxId),
  );
  _listings.push(listing);
  _persist();
  return listing;
}

export function addBid(data: any): NftBid | null {
  if (!Number.isFinite(data.bidPrice) || data.bidPrice <= 0 || data.bidPrice > 100_000) return null;
  const listing = _listings.find(l => l.id === data.listingId);
  if (!listing || listing.status !== 'active') return null;
  const bid: NftBid = {
    listingId: data.listingId,
    bidderInboxId: data.bidderInboxId,
    bidderUsername: data.bidderUsername,
    bidderWallet: data.bidderWallet,
    bidPrice: data.bidPrice,
    bidAt: new Date(data.bidAt),
  };
  const existing = _bids.get(data.listingId) ?? [];
  existing.push(bid);
  _bids.set(data.listingId, existing);
  return bid;
}

export function markPendingSwap(listingId: string, bid: NftBid): void {
  const listing = _listings.find(l => l.id === listingId);
  if (listing) {
    listing.status = 'pending_swap';
    listing.acceptedBid = bid;
    listing.swapExpiresAt = Date.now() + SWAP_EXPIRY_MS;
  }
  _persist();
}

export function markSold(listingId: string): void {
  const listing = _listings.find(l => l.id === listingId);
  if (listing) listing.status = 'sold';
  _persist();
}

export function revertPendingSwap(listingId: string): void {
  const listing = _listings.find(l => l.id === listingId);
  if (listing && listing.status === 'pending_swap') {
    listing.status = 'active';
    listing.acceptedBid = undefined;
    listing.swapExpiresAt = undefined;
  }
  _persist();
}

export function delistNft(listingId: string): void {
  const listing = _listings.find(l => l.id === listingId);
  if (listing) listing.status = 'delisted';
  _persist();
}

/** Get all active listings (auto-revert expired pending_swap) */
export function getActiveListings(): NftListing[] {
  const now = Date.now();
  for (const l of _listings) {
    if (l.status === 'pending_swap' && l.swapExpiresAt && now > l.swapExpiresAt) {
      l.status = 'active';
      l.acceptedBid = undefined;
      l.swapExpiresAt = undefined;
    }
  }
  return _listings
    .filter(l => l.status === 'active' || l.status === 'pending_swap')
    .sort((a, b) => b.listedAt.getTime() - a.listedAt.getTime());
}

/** Get bids for a listing */
export function getBidsForListing(listingId: string): NftBid[] {
  return (_bids.get(listingId) ?? []).sort((a, b) => b.bidPrice - a.bidPrice);
}

/** Get listings by a specific seller */
export function getMyListings(inboxId: string): NftListing[] {
  return _listings.filter(l => l.sellerInboxId === inboxId);
}

/** Find listing by ID */
export function getListingById(listingId: string): NftListing | undefined {
  return _listings.find(l => l.id === listingId);
}

/** Load listings from disk */
export async function loadListings(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(AK_LISTINGS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        _listings = parsed.map((l: any) => ({ ...l, listedAt: new Date(l.listedAt) }));
      }
    }
  } catch { /* non-critical */ }
}

function _persist(): void {
  AsyncStorage.setItem(AK_LISTINGS, JSON.stringify(_listings)).catch(() => {});
}
