/**
 * NFT Marketplace — P2P Saga Monkes Trading (Atomic Swap)
 *
 * Architecture:
 *   PUBLIC (group broadcast):
 *     NFT_LIST:<json>      — seller lists an NFT (all users see it)
 *     NFT_DELIST:<json>    — seller removes listing (all users see removal)
 *
 *   PRIVATE (DM directly between the two real parties, never the group):
 *     NFT_BID:<json>        — buyer -> seller: places a SKR bid
 *     NFT_BID_CANCEL:<json> — buyer -> seller: cancels their own pending bid
 *     NFT_OFFER:<json>      — buyer -> seller: offers an NFT-for-NFT swap
 *     NFT_ACCEPT:<json>     — seller -> buyer: accepts (triggers atomic swap)
 *     NFT_SWAP:<json>       — seller -> buyer: partially-signed swap tx
 *     NFT_COMPLETE:<json>   — buyer -> seller: swap completed on-chain
 *
 *   BROADCAST (public group, via buildSaleAnnouncement — sanitized, no wallet
 *   addresses or raw tx bytes, just name/price/tx-sig-prefix):
 *     Completed sales are announced after a successful NFT_COMPLETE.
 *
 * 2026-09-13: every "PRIVATE" message above used to actually go through sendRawToGroup — a real
 * bug, not a design choice; it broadcast every bid amount, wallet address, and even the signed
 * swap transaction bytes to the entire Main Chat group. Fixed to route through sendRawToDm
 * instead (see the matching handlers in useXmtp.ts's global stream + useDm.ts's per-DM stream).
 * Solana's own signature requirement always protected actual fund movement regardless of who
 * could see a message, but there's no reason to leak trade details to bystanders either.
 *
 * Actual transfer uses atomic swap: NFT + SKR in a single Solana transaction.
 * 2026-09-11: MonkeMarkets is SKR-only — all list/bid prices are in SKR (not
 * SOL). A SOL-equivalent reference price is shown in the UI only (see
 * fetchSolSkrRate in nftSwap.ts); it's never the settlement currency.
 *
 * A bid is a non-binding notice, not an escrow — no funds move until the
 * seller accepts AND the buyer counter-signs. A pending bid expires
 * BID_EXPIRY_MS (8h) after being placed if the seller never responds, and
 * the buyer can cancel it earlier at any time via NFT_BID_CANCEL.
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
  askPrice: number;         // asking price in SKR
  traits?: NftTrait[];      // NFT attributes (Background, Fur, Eyes, etc.)
  listedAt: Date;
  status: 'active' | 'pending_swap' | 'sold' | 'delisted';
  acceptedBid?: NftBid;     // which bid was accepted (during pending_swap)
  swapExpiresAt?: number;   // timestamp when pending_swap auto-reverts
}

// A pending bid with no seller response auto-expires after this long — the
// seller was never obligated to accept, and letting a bid linger forever
// would leave the buyer wondering. Cancelling early is always available.
export const BID_EXPIRY_MS = 8 * 3600_000; // 8 hours

export interface NftBid {
  listingId: string;
  bidderInboxId: string;
  bidderUsername?: string;
  bidderWallet: string;
  bidPrice: number;         // bid price in SKR
  bidAt: Date;
  expiresAt: number;        // bidAt + BID_EXPIRY_MS — bid auto-hides in the UI past this
  cancelled?: boolean;      // set by the buyer's own NFT_BID_CANCEL
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
  skrPrice: number;
  sellerWallet: string;
  buyerWallet: string;
  serializedTx: string;     // base64-encoded partially-signed transaction
  createdAt: number;
}

export interface NftCompleteMessage {
  listingId: string;
  signature: string;        // on-chain tx signature
  mint: string;
  skrPrice: number;
  sellerInboxId?: string;
  sellerUsername?: string;
  buyerInboxId?: string;
  buyerUsername?: string;
  nftName?: string;
  nftImage?: string | null;
  completedAt: number;
}

// ── Order History ──────────────────────────────────────────────────────────

const AK_HISTORY_BASE = 'marketplace_history_v1';

// Wallet-scoped: a user's buy/sell/bid history belongs to the wallet, not the device.
// Listings (AK_LISTINGS) stay device-keyed because they're a local cache of public broadcasts.
let _historyWalletCtx: string | null = null;
export function setMarketplaceWalletContext(addr: string | null): void {
  if (_historyWalletCtx !== addr) {
    _historyWalletCtx = addr;
    _history = []; // stale cache for the previous wallet; next loadHistory() refills
  }
}
function historyKey(): string {
  return _historyWalletCtx ? `${AK_HISTORY_BASE}:${_historyWalletCtx}` : AK_HISTORY_BASE;
}

export interface MarketplaceHistoryEntry {
  type: 'buy' | 'sell' | 'bid';
  nftName: string;
  price: number;         // SKR
  timestamp: number;     // Date.now()
  counterparty: string;  // username or 'anon'
  mint?: string;
  txSignature?: string;
}

let _history: MarketplaceHistoryEntry[] = [];

export async function loadHistory(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(historyKey());
    _history = raw ? (() => {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    })() : [];
  } catch { _history = []; }
}

function _persistHistory(): void {
  AsyncStorage.setItem(historyKey(), JSON.stringify(_history)).catch(() => {});
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

/**
 * Merge remote history entries (from a cross-device reclaim) into local history.
 * Dedupes by txSignature when present, otherwise by (type, timestamp, nftName).
 * Returns the number of entries added. Safe to call repeatedly.
 */
export function mergeHistoryEntries(remote: unknown[]): number {
  if (!Array.isArray(remote) || remote.length === 0) return 0;
  const keyOf = (e: any): string =>
    e?.txSignature ? `sig:${e.txSignature}` : `${e?.type}|${e?.timestamp}|${e?.nftName}`;
  const existing = new Set(_history.map(keyOf));
  let added = 0;
  for (const raw of remote) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as MarketplaceHistoryEntry;
    if (!e.type || typeof e.timestamp !== 'number') continue;
    const k = keyOf(e);
    if (existing.has(k)) continue;
    _history.push(e);
    existing.add(k);
    added++;
  }
  if (added > 0) {
    _history.sort((a, b) => b.timestamp - a.timestamp);
    if (_history.length > 200) _history = _history.slice(0, 200);
    _persistHistory();
  }
  return added;
}

// ── In-memory state ────────────────────────────────────────────────────────

let _listings: NftListing[] = [];
let _bids: Map<string, NftBid[]> = new Map(); // listingId → bids
let _offers: Map<string, NftSwapOffer[]> = new Map(); // listingId → monke-swap notices

// ── Message parsing ─────────────────────────────────────────────────────────

export function parseMarketplaceMessage(raw: string): {
  type: 'list' | 'bid' | 'bid_cancel' | 'offer' | 'accept' | 'delist' | 'swap' | 'complete';
  data: any;
} | null {
  const prefixes = [
    'NFT_LIST:', 'NFT_BID_CANCEL:', 'NFT_BID:', 'NFT_OFFER:', 'NFT_ACCEPT:',
    'NFT_DELIST:', 'NFT_SWAP:', 'NFT_COMPLETE:',
  ] as const;
  const types = ['list', 'bid_cancel', 'bid', 'offer', 'accept', 'delist', 'swap', 'complete'] as const;
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
        if (types[i] === "bid_cancel" && (!data.listingId || !data.bidderInboxId)) return null;
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

/** Parse an NFT_LIST payload we just built so local cache and the group share the same listing id. */
export function listingPayloadFromListMessage(msg: string): Record<string, unknown> | null {
  const parsed = parseMarketplaceMessage(msg);
  if (!parsed || parsed.type !== 'list') return null;
  return parsed.data as Record<string, unknown>;
}

export function buildDelistMessage(listingId: string): string {
  return `NFT_DELIST:${JSON.stringify({ listingId })}`;
}

// ── Private message builders (DM to seller/buyer) ───────────────────────────

export function buildBidMessage(
  bid: Omit<NftBid, 'bidAt' | 'expiresAt'>,
  extra?: { sellerInboxId?: string; listingName?: string },
): string {
  const bidAt = Date.now();
  return `NFT_BID:${JSON.stringify({ ...bid, ...extra, bidAt, expiresAt: bidAt + BID_EXPIRY_MS })}`;
}

/** Buyer cancels their own pending bid — always allowed, any time before the seller accepts. */
export function buildBidCancelMessage(listingId: string, bidderInboxId: string): string {
  return `NFT_BID_CANCEL:${JSON.stringify({ listingId, bidderInboxId, cancelledAt: Date.now() })}`;
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
  const price = complete.skrPrice;
  const sig = complete.signature.slice(0, 8);
  return `MSG:AI Agent #9385:🐒 **SOLD** — ${name}\n${seller} → ${buyer} for ${price} SKR\ntx: ${sig}…`;
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
  const bidAt = typeof data.bidAt === "number" ? data.bidAt : Date.now();
  const bid: NftBid = {
    listingId: data.listingId,
    bidderInboxId: data.bidderInboxId,
    bidderUsername: data.bidderUsername,
    bidderWallet: data.bidderWallet,
    bidPrice: data.bidPrice,
    bidAt: new Date(bidAt),
    // Fallback covers a bid sent before this field existed — treat as
    // expiring a full window from now rather than crashing on a missing value.
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : bidAt + BID_EXPIRY_MS,
  };
  const existing = _bids.get(data.listingId) ?? [];
  existing.push(bid);
  _bids.set(data.listingId, existing);
  return bid;
}

/**
 * Buyer cancels their own pending bid(s) on a listing. Cancels ALL of the bidder's
 * non-cancelled bids on this listing, not just one — the UI only ever shows a buyer their most
 * recent bid, so if more than one somehow exists (e.g. a resend after a dropped connection),
 * leaving an older one live would let the seller "accept" a bid the buyer thinks is gone.
 * No-op if none are found (already gone/accepted).
 */
export function cancelBid(listingId: string, bidderInboxId: string): void {
  const bids = _bids.get(listingId);
  if (!bids) return;
  for (const bid of bids) {
    if (bid.bidderInboxId === bidderInboxId && !bid.cancelled) bid.cancelled = true;
  }
}

export function addSwapOffer(data: any): NftSwapOffer | null {
  const listing = _listings.find(l => l.id === data.listingId);
  if (!listing || listing.status !== 'active') return null;
  if (!isValidSolAddress(data.offeredMint) || !isValidSolAddress(data.offererWallet)) return null;
  const offer: NftSwapOffer = {
    listingId: data.listingId,
    offererInboxId: data.offererInboxId,
    offererUsername: data.offererUsername,
    offererWallet: data.offererWallet,
    offeredMint: data.offeredMint,
    offeredName: data.offeredName ?? 'Saga Monke',
    offeredImage: data.offeredImage ?? null,
    solTopUp: typeof data.solTopUp === 'number' ? data.solTopUp : undefined,
    offeredAt: new Date(typeof data.offeredAt === 'number' ? data.offeredAt : Date.now()),
  };
  const existing = _offers.get(data.listingId) ?? [];
  const next = existing.filter(o => o.offererInboxId !== offer.offererInboxId);
  next.push(offer);
  _offers.set(data.listingId, next);
  return offer;
}

export function getOffersForListing(listingId: string): NftSwapOffer[] {
  return [...(_offers.get(listingId) ?? [])].sort(
    (a, b) => b.offeredAt.getTime() - a.offeredAt.getTime(),
  );
}

/** Hide a listing locally (stale / sold off-app). Do not broadcast NFT_DELIST for someone else's mint. */
export function hideListing(listingId: string): void {
  const listing = _listings.find(l => l.id === listingId);
  if (listing && (listing.status === 'active' || listing.status === 'pending_swap')) {
    listing.status = 'delisted';
    _persist();
  }
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

/** Get active (not cancelled, not expired) bids for a listing, highest first. */
export function getBidsForListing(listingId: string): NftBid[] {
  const now = Date.now();
  return (_bids.get(listingId) ?? [])
    .filter(b => !b.cancelled && b.expiresAt > now)
    .sort((a, b) => b.bidPrice - a.bidPrice);
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
