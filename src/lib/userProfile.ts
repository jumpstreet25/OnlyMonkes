import { useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeStorageSet } from '@/lib/storageRescue';

const SK_USERNAME      = 'profile_username';
const SK_BIO           = 'profile_bio';
const SK_XACCOUNT      = 'profile_xaccount';
const SK_TIP_WALLET    = 'profile_tip_wallet';
const SK_LOCATION      = 'profile_location';
const SK_SELECTED_MINT = 'profile_selected_nft_mint';

export interface UserProfile {
  username: string | null;
  bio: string | null;
  xAccount: string | null;
  tipWallet: string | null;
  location: string | null;
}

export async function loadUserProfile(): Promise<UserProfile> {
  const [username, bio, xAccount, tipWallet, location] = await Promise.all([
    SecureStore.getItemAsync(SK_USERNAME),
    SecureStore.getItemAsync(SK_BIO),
    SecureStore.getItemAsync(SK_XACCOUNT),
    SecureStore.getItemAsync(SK_TIP_WALLET),
    SecureStore.getItemAsync(SK_LOCATION),
  ]);
  return { username, bio, xAccount, tipWallet, location };
}

export async function saveUserProfile(
  username: string,
  bio: string,
  xAccount: string = '',
  tipWallet: string = '',
  location: string = '',
): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(SK_USERNAME, username.trim()),
    SecureStore.setItemAsync(SK_BIO, bio.trim()),
    SecureStore.setItemAsync(SK_XACCOUNT, xAccount.trim()),
    SecureStore.setItemAsync(SK_TIP_WALLET, tipWallet.trim()),
    SecureStore.setItemAsync(SK_LOCATION, location.trim()),
  ]);
}

// ─── Selected NFT mint persistence ───────────────────────────────────────────

export async function saveSelectedNftMint(mint: string): Promise<void> {
  await SecureStore.setItemAsync(SK_SELECTED_MINT, mint);
}

export async function loadSelectedNftMint(): Promise<string | null> {
  return SecureStore.getItemAsync(SK_SELECTED_MINT);
}

// ─── Profile cache for other users (populated via PROFILE_UPDATE messages) ────

export interface CachedProfile {
  username?: string;
  bio?: string;
  xAccount?: string;
  walletAddress?: string;
  tipWallet?: string;
  location?: string;
  nftImage?: string | null;
  badges?: string[];           // earned badge IDs (broadcast via PROFILE_UPDATE)
  cachedAt?: number;          // epoch ms of last write
  accessedAt?: number;        // epoch ms of last read (LRU eviction)
  legendary?: boolean;
  pushToken?: string;         // Raw FCM token for bot's server-side push
  expoPushToken?: string;     // ExponentPushToken[...] for client-side DM relay
  mouthTrait?: string;        // Saga Monke Mouth trait: 'Beaming' | 'Doobie' | 'None' | 'OwO'
  shopStyles?: Record<string, string | number | boolean>;  // equipped Banana Shop cosmetics (broadcast to all users)
  statusMessage?: string;  // "What's on your mind" — ephemeral status text
}

const AK_PROFILE_CACHE = 'profile_cache_v2';
const AK_LOCATION_MAP = 'user_locations_v1'; // Dedicated persistent location store — survives cache eviction
// Reduced 200 → 80 (2026-05-05): Android AsyncStorage SQLite hard-caps at 6MB
// by default. 200 entries × ~50KB base64 avatar = ~10MB → SQLITE_FULL crashes.
// 80 × 50KB = 4MB leaves headroom for messageCache + other stores. Native APK
// can raise the cap via gradle.properties (queued for next build) — until then
// this is the OTA-safe ceiling.
const MAX_PROFILE_CACHE = 80;
const _profileCache = new Map<string, CachedProfile>();
const _locationMap = new Map<string, string>(); // inboxId → location (never evicted)
let _persistTimer: ReturnType<typeof setTimeout> | null = null;
let _locationPersistTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Instant-update subscriber system ────────────────────────────────────────
// Call useProfileVersion() in any component to auto-rerender on PFP changes.
const _cacheListeners = new Set<() => void>();

function _notifyProfileListeners() {
  _cacheListeners.forEach(fn => fn());
}

export function useProfileVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const handler = () => setV(n => n + 1);
    _cacheListeners.add(handler);
    return () => { _cacheListeners.delete(handler); };
  }, []);
  return v;
}

/** Load persisted profile cache from AsyncStorage (call once on app start). */
export async function loadProfileCache(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(AK_PROFILE_CACHE);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, CachedProfile>;
    for (const [k, v] of Object.entries(obj)) {
      _profileCache.set(k, { ..._profileCache.get(k), ...v });
    }
    _rebuildWalletPrimary();
    _bumpProfileCacheVersion();
  } catch { /* ignore */ }

  // Load dedicated location map (survives cache eviction)
  try {
    const raw = await AsyncStorage.getItem(AK_LOCATION_MAP);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(obj)) {
        _locationMap.set(k, v);
        // Restore location to profile cache — create minimal entry if evicted
        const cached = _profileCache.get(k);
        if (cached) {
          if (!cached.location && v) cached.location = v;
        } else if (v) {
          _profileCache.set(k, { location: v, cachedAt: 0 });
        }
      }
      _bumpProfileCacheVersion();
    }
  } catch { /* ignore */ }
}

function _scheduleLocationPersist() {
  if (_locationPersistTimer) clearTimeout(_locationPersistTimer);
  _locationPersistTimer = setTimeout(async () => {
    try {
      const obj: Record<string, string> = {};
      _locationMap.forEach((v, k) => { obj[k] = v; });
      await AsyncStorage.setItem(AK_LOCATION_MAP, JSON.stringify(obj));
    } catch { /* ignore */ }
  }, 600);
}

function _schedulePersist() {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(async () => {
    try {
      const obj: Record<string, CachedProfile> = {};
      _profileCache.forEach((v, k) => { obj[k] = v; });
      // safeStorageSet self-heals on SQLITE_FULL by trimming this same cache
      // and retrying — prevents profile-broadcast spam from blocking writes
      // when the SQLite DB nears its Android cap.
      await safeStorageSet(AK_PROFILE_CACHE, JSON.stringify(obj));
    } catch { /* ignore */ }
  }, 2000); // 2s debounce — batches rapid profile updates into single write
}

export function cacheProfile(inboxId: string, profile: CachedProfile): void {
  const existing = _profileCache.get(inboxId);

  // Never overwrite known-good fields with null or undefined.
  // `== null` covers both null and undefined (explicit spread of {field: undefined}
  // would otherwise silently wipe existing data).
  // A real change always arrives as a new truthy string value.
  if (profile.nftImage == null && existing?.nftImage) {
    delete profile.nftImage;
  }
  if (profile.location == null && existing?.location) {
    delete profile.location;
  }
  if (profile.legendary == null && existing?.legendary) {
    delete profile.legendary;
  }
  if (profile.shopStyles == null && existing?.shopStyles && Object.keys(existing.shopStyles).length > 0) {
    delete profile.shopStyles;
  }

  const merged = { ...existing, ...profile, cachedAt: Date.now() };

  // Persist location to dedicated map (survives cache eviction)
  if (merged.location) {
    _locationMap.set(inboxId, merged.location);
    _scheduleLocationPersist();
  } else if (_locationMap.has(inboxId)) {
    // Restore location from persistent map if profile lost it
    merged.location = _locationMap.get(inboxId);
  }

  _profileCache.set(inboxId, merged);
  _indexWalletPrimary(inboxId, merged);
  _bumpProfileCacheVersion();
  // LRU eviction — remove least recently accessed entry when cache exceeds max
  if (_profileCache.size > MAX_PROFILE_CACHE) {
    let lruKey: string | null = null;
    let lruAt = Infinity;
    for (const [k, v] of _profileCache) {
      const lastUsed = v.accessedAt ?? v.cachedAt ?? 0;
      if (lastUsed < lruAt) { lruAt = lastUsed; lruKey = k; }
    }
    if (lruKey) {
      if (__DEV__) console.log(`[ProfileCache] Evicting ${lruKey.slice(0, 8)}… (cache full at ${MAX_PROFILE_CACHE})`);
      const evicted = _profileCache.get(lruKey);
      _profileCache.delete(lruKey);
      if (evicted) _forgetWalletPrimary(lruKey, evicted);
    }
  }
  _schedulePersist();
  _notifyProfileListeners();
}

export function getCachedProfile(inboxId: string): CachedProfile | null {
  const profile = _profileCache.get(inboxId);
  if (profile) {
    profile.accessedAt = Date.now(); // LRU touch
    // Restore location from persistent map if missing
    if (!profile.location && _locationMap.has(inboxId)) {
      profile.location = _locationMap.get(inboxId);
    }
  }
  return profile ?? null;
}

/** Get a user's location from the persistent location map (never evicted). */
export function getPersistedLocation(inboxId: string): string | undefined {
  return _locationMap.get(inboxId);
}

/**
 * Apply a bot LOCATION_SYNC payload (inboxId → { u, loc, ni }) into the
 * local profile cache + all-time users so MonkeGlobe / 🌍 count can fill
 * without waiting for each monke's original PROFILE_UPDATE broadcast.
 */
export function applyLocationSync(
  locs: Record<string, { u?: string; loc?: string; ni?: string }>,
): number {
  let n = 0;
  for (const [inboxId, data] of Object.entries(locs)) {
    if (!inboxId || !data?.loc?.trim()) continue;
    cacheProfile(inboxId, {
      username: data.u || undefined,
      location: data.loc.trim(),
      nftImage: data.ni || undefined,
    });
    trackUser(inboxId, data.u || undefined);
    n++;
  }
  return n;
}

// ─── All-time user registry ───────────────────────────────────────────────────
// Persistent set of every unique inboxId that has ever appeared in the chat.
// Never shrinks, survives app restarts, never double-counts the same wallet.

const AK_ALL_TIME_USERS = 'all_time_users_v1';
// inboxId → display name (empty string if unknown at time of first sighting)
const _allTimeUsers = new Map<string, string>();
let _allTimePersistTimer: ReturnType<typeof setTimeout> | null = null;

function _scheduleAllTimePersist() {
  if (_allTimePersistTimer) clearTimeout(_allTimePersistTimer);
  _allTimePersistTimer = setTimeout(async () => {
    try {
      const obj: Record<string, string> = {};
      _allTimeUsers.forEach((v, k) => { obj[k] = v; });
      await AsyncStorage.setItem(AK_ALL_TIME_USERS, JSON.stringify(obj));
    } catch { /* ignore */ }
  }, 600);
}

/**
 * Load the all-time user registry from AsyncStorage, then seed any entries
 * that are already known from the profile cache but not yet in the registry.
 * Call once on app startup, after loadProfileCache().
 */
export async function loadAllTimeUsers(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(AK_ALL_TIME_USERS);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(obj)) {
        _allTimeUsers.set(k, v);
      }
    }
  } catch { /* ignore */ }

  // Seed from profile cache so users seen before this feature existed are counted
  _profileCache.forEach((profile, inboxId) => {
    if (!_allTimeUsers.has(inboxId)) {
      _allTimeUsers.set(inboxId, profile.username ?? "");
    }
  });

  // Build prefix index after loading all users
  _rebuildPrefixIndex();
}

/**
 * Record a user as having ever used the app. Safe to call many times for the
 * same inboxId — only the first call per wallet counts; subsequent calls only
 * update the stored name if we now have one we didn't have before.
 */
export function trackUser(inboxId: string, username?: string): void {
  if (!inboxId) return;
  const existing = _allTimeUsers.get(inboxId);
  if (existing !== undefined) {
    // Already tracked — update name if we have a new one that differs
    if (username && existing !== username) {
      _allTimeUsers.set(inboxId, username);
      _rebuildPrefixIndex();
      _scheduleAllTimePersist();
      _notifyProfileListeners();
    }
    return;
  }
  _allTimeUsers.set(inboxId, username ?? "");
  if (username) _indexUser(inboxId, username);
  _scheduleAllTimePersist();
  _notifyProfileListeners();
}

/** Returns the full all-time user map: inboxId → name. */
export function getAllTimeUsers(): Map<string, string> {
  return _allTimeUsers;
}

/**
 * Deduplicate users by wallet address.
 * When the same wallet has multiple inbox IDs (multi-device), returns only
 * the most recently active one. This prevents duplicate globe markers,
 * duplicate member entries, and duplicate usernames.
 */
export function getDeduplicatedUsers(): Map<string, string> {
  const walletToInbox = new Map<string, { inboxId: string; name: string; badgeCount: number; cachedAt: number }>();
  const result = new Map<string, string>();

  for (const [inboxId, name] of _allTimeUsers.entries()) {
    const profile = _profileCache.get(inboxId);
    const wallet = profile?.walletAddress;
    const badgeCount = profile?.badges?.length ?? 0;
    const cachedAt = profile?.cachedAt ?? 0;

    if (wallet) {
      const existing = walletToInbox.get(wallet);
      // Prefer the account with more badges; tie-break by most recent activity
      const isBetter = !existing
        || badgeCount > existing.badgeCount
        || (badgeCount === existing.badgeCount && cachedAt > existing.cachedAt);
      if (isBetter) {
        if (existing) result.delete(existing.inboxId);
        walletToInbox.set(wallet, { inboxId, name, badgeCount, cachedAt });
        result.set(inboxId, name);
      }
      // Skip lesser inbox ID for same wallet
    } else {
      // No wallet info — include (can't dedup)
      result.set(inboxId, name);
    }
  }
  return result;
}

/** Count deduplicated users that have a location (profile cache OR persistent location map).
 * Bot inboxes are pinned to a hardcoded coordinate on the Globe screen
 * (see GlobeScreen "Pin the bot(s) at Solana Beach" block), so include them
 * in the header counter even if their PROFILE_UPDATE never carried a `loc`
 * field. Avoid double-counting if a bot ever does broadcast a location.
 *
 * Also folds in any inboxId that only lives in the persistent location map
 * (e.g. restored from disk after profile-cache LRU eviction, before
 * trackUser re-seeds all-time users) so the 🌍 pill doesn't under-count
 * relative to MonkeGlobe markers. */
export function getLocatedUserCount(): number {
  // Lazy require to avoid a circular import at module load (constants ↔ profile).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BOT_INBOX_IDS } = require('@/lib/constants') as { BOT_INBOX_IDS: string[] };
  const deduped = getDeduplicatedUsers();
  const counted = new Set<string>();
  for (const inboxId of deduped.keys()) {
    const profile = _profileCache.get(inboxId);
    if (profile?.location || _locationMap.has(inboxId)) {
      counted.add(inboxId);
    }
  }
  // Location-map-only entries (not yet in all-time users) still count —
  // wallet-dedup when possible via profile cache.
  for (const inboxId of _locationMap.keys()) {
    if (counted.has(inboxId)) continue;
    const wallet = _profileCache.get(inboxId)?.walletAddress;
    if (wallet) {
      let already = false;
      for (const id of counted) {
        if (_profileCache.get(id)?.walletAddress === wallet) {
          already = true;
          break;
        }
      }
      if (already) continue;
    }
    counted.add(inboxId);
  }
  for (const botId of BOT_INBOX_IDS) {
    counted.add(botId);
  }
  return counted.size;
}

let _profileCacheVersion = 0;
export function _bumpProfileCacheVersion(): void {
  _profileCacheVersion++;
  // Also wake UI subscribers (ChatHeader globe count, MessageBubble PFP,
  // etc.) — previously only cacheProfile/trackUser notified, so paths that
  // only bumped the version left the 🌍 pill stuck on a stale number.
  _notifyProfileListeners();
}

// wallet → most-recently-cached inbox. Maintained on write so MessageBubble
// getPrimaryInboxId is O(1) instead of walking the whole profile cache
// (and the old per-inbox memo was wiped on every PROFILE_UPDATE).
const _walletPrimary = new Map<string, { inboxId: string; cachedAt: number }>();

function _indexWalletPrimary(inboxId: string, profile: CachedProfile): void {
  const wallet = profile.walletAddress;
  if (!wallet) return;
  const cachedAt = profile.cachedAt ?? 0;
  const cur = _walletPrimary.get(wallet);
  if (!cur || cachedAt >= cur.cachedAt) {
    _walletPrimary.set(wallet, { inboxId, cachedAt });
  }
}

function _forgetWalletPrimary(inboxId: string, profile: CachedProfile): void {
  const wallet = profile.walletAddress;
  if (!wallet) return;
  const cur = _walletPrimary.get(wallet);
  if (cur?.inboxId !== inboxId) return;
  _walletPrimary.delete(wallet);
  for (const [id, p] of _profileCache) {
    if (p.walletAddress !== wallet) continue;
    const cachedAt = p.cachedAt ?? 0;
    const next = _walletPrimary.get(wallet);
    if (!next || cachedAt > next.cachedAt) {
      _walletPrimary.set(wallet, { inboxId: id, cachedAt });
    }
  }
}

function _rebuildWalletPrimary(): void {
  _walletPrimary.clear();
  for (const [id, p] of _profileCache) {
    _indexWalletPrimary(id, p);
  }
}

/**
 * Resolve an inbox ID to its "primary" inbox ID (most recently active device).
 * If the wallet is known and another inbox ID for the same wallet is newer,
 * returns that one. Otherwise returns the input unchanged.
 * Use this to merge shop styles from the same wallet across devices.
 */
export function getPrimaryInboxId(inboxId: string): string {
  const profile = _profileCache.get(inboxId);
  const wallet = profile?.walletAddress;
  if (!wallet) return inboxId;
  return _walletPrimary.get(wallet)?.inboxId ?? inboxId;
}

// ─── Username prefix index for fast @mention lookups ─────────────────────
// Maps lowercase prefix (2 chars) → Set of inboxIds with matching usernames.
const _prefixIndex = new Map<string, Set<string>>();

function _indexUser(inboxId: string, username: string) {
  if (!username) return;
  const prefix = username.toLowerCase().slice(0, 2);
  if (!prefix) return;
  let set = _prefixIndex.get(prefix);
  if (!set) { set = new Set(); _prefixIndex.set(prefix, set); }
  set.add(inboxId);
}

function _rebuildPrefixIndex() {
  _prefixIndex.clear();
  _allTimeUsers.forEach((name, id) => _indexUser(id, name));
}

/**
 * Fast @mention lookup — returns up to `limit` users whose username starts with `query`.
 * Uses a 2-char prefix index to avoid scanning all 300+ users.
 */
export function searchUsersByPrefix(
  query: string,
  excludeInboxId?: string,
  limit = 6,
): { inboxId: string; username: string }[] {
  if (!query) return [];
  const q = query.toLowerCase();
  const prefix = q.slice(0, 2);
  const candidates = _prefixIndex.get(prefix);
  if (!candidates) return [];

  // Use deduplicated users to avoid showing stale multi-device accounts
  const deduped = getDeduplicatedUsers();
  const results: { inboxId: string; username: string }[] = [];
  for (const inboxId of candidates) {
    if (inboxId === excludeInboxId) continue;
    if (!deduped.has(inboxId)) continue; // skip stale duplicate inboxIds
    const name = deduped.get(inboxId);
    if (name && name.toLowerCase().startsWith(q)) {
      results.push({ inboxId, username: name });
      if (results.length >= limit) break;
    }
  }
  return results;
}
