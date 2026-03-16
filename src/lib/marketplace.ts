/**
 * NFT Marketplace — P2P Saga Monkes Trading
 *
 * Message formats:
 *   NFT_LIST:<json>    — seller lists an NFT for sale
 *   NFT_BID:<json>     — buyer places a bid
 *   NFT_ACCEPT:<json>  — seller accepts a bid
 *   NFT_DELIST:<json>  — seller removes listing
 *
 * Listings are broadcast to the group chat as system messages.
 * Actual transfer happens via MWA (Mobile Wallet Adapter).
 *
 * All prices are in SOL.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const AK_LISTINGS = 'om_nft_listings';

export interface NftListing {
  id: string;               // unique listing ID (mint + timestamp)
  mint: string;             // NFT mint address
  name: string;             // NFT name
  image: string | null;     // NFT image URI
  sellerInboxId: string;    // seller's XMTP inboxId
  sellerUsername?: string;
  sellerWallet: string;     // seller's Solana wallet address
  askPrice: number;         // asking price in SOL
  listedAt: Date;
  status: 'active' | 'sold' | 'delisted';
}

export interface NftBid {
  listingId: string;
  bidderInboxId: string;
  bidderUsername?: string;
  bidderWallet: string;
  bidPrice: number;         // bid price in SOL
  bidAt: Date;
}

let _listings: NftListing[] = [];
let _bids: Map<string, NftBid[]> = new Map(); // listingId → bids

// ── Message parsing ─────────────────────────────────────────────────────────

export function parseMarketplaceMessage(raw: string): {
  type: 'list' | 'bid' | 'accept' | 'delist';
  data: any;
} | null {
  const prefixes = ['NFT_LIST:', 'NFT_BID:', 'NFT_ACCEPT:', 'NFT_DELIST:'] as const;
  const types = ['list', 'bid', 'accept', 'delist'] as const;
  for (let i = 0; i < prefixes.length; i++) {
    if (raw.startsWith(prefixes[i])) {
      try {
        const data = JSON.parse(raw.slice(prefixes[i].length));
        return { type: types[i], data };
      } catch { return null; }
    }
  }
  return null;
}

export function buildListMessage(listing: Omit<NftListing, 'id' | 'listedAt' | 'status'>): string {
  const id = `${listing.mint}-${Date.now()}`;
  return `NFT_LIST:${JSON.stringify({ ...listing, id, listedAt: Date.now() })}`;
}

export function buildBidMessage(bid: Omit<NftBid, 'bidAt'>): string {
  return `NFT_BID:${JSON.stringify({ ...bid, bidAt: Date.now() })}`;
}

export function buildAcceptMessage(listingId: string, bidderInboxId: string): string {
  return `NFT_ACCEPT:${JSON.stringify({ listingId, bidderInboxId, acceptedAt: Date.now() })}`;
}

export function buildDelistMessage(listingId: string): string {
  return `NFT_DELIST:${JSON.stringify({ listingId })}`;
}

// ── State management ────────────────────────────────────────────────────────

export function addListing(data: any): NftListing {
  const listing: NftListing = {
    id: data.id,
    mint: data.mint,
    name: data.name,
    image: data.image ?? null,
    sellerInboxId: data.sellerInboxId,
    sellerUsername: data.sellerUsername,
    sellerWallet: data.sellerWallet,
    askPrice: data.askPrice,
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

export function acceptBid(listingId: string): void {
  const listing = _listings.find(l => l.id === listingId);
  if (listing) listing.status = 'sold';
  _persist();
}

export function delistNft(listingId: string): void {
  const listing = _listings.find(l => l.id === listingId);
  if (listing) listing.status = 'delisted';
  _persist();
}

/** Get all active listings */
export function getActiveListings(): NftListing[] {
  return _listings
    .filter(l => l.status === 'active')
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
