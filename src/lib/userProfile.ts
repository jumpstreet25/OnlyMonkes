import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SK_USERNAME      = 'profile_username';
const SK_BIO           = 'profile_bio';
const SK_XACCOUNT      = 'profile_xaccount';
const SK_TIP_WALLET    = 'profile_tip_wallet';
const SK_SELECTED_MINT = 'profile_selected_nft_mint';

export interface UserProfile {
  username: string | null;
  bio: string | null;
  xAccount: string | null;
  tipWallet: string | null;
}

export async function loadUserProfile(): Promise<UserProfile> {
  const [username, bio, xAccount, tipWallet] = await Promise.all([
    SecureStore.getItemAsync(SK_USERNAME),
    SecureStore.getItemAsync(SK_BIO),
    SecureStore.getItemAsync(SK_XACCOUNT),
    SecureStore.getItemAsync(SK_TIP_WALLET),
  ]);
  return { username, bio, xAccount, tipWallet };
}

export async function saveUserProfile(
  username: string,
  bio: string,
  xAccount: string = '',
  tipWallet: string = ''
): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(SK_USERNAME, username.trim()),
    SecureStore.setItemAsync(SK_BIO, bio.trim()),
    SecureStore.setItemAsync(SK_XACCOUNT, xAccount.trim()),
    SecureStore.setItemAsync(SK_TIP_WALLET, tipWallet.trim()),
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
  nftImage?: string | null;
}

const AK_PROFILE_CACHE = 'profile_cache_v2';
const _profileCache = new Map<string, CachedProfile>();
let _persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Load persisted profile cache from AsyncStorage (call once on app start). */
export async function loadProfileCache(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(AK_PROFILE_CACHE);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, CachedProfile>;
    for (const [k, v] of Object.entries(obj)) {
      _profileCache.set(k, { ..._profileCache.get(k), ...v });
    }
  } catch { /* ignore */ }
}

function _schedulePersist() {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(async () => {
    try {
      const obj: Record<string, CachedProfile> = {};
      _profileCache.forEach((v, k) => { obj[k] = v; });
      await AsyncStorage.setItem(AK_PROFILE_CACHE, JSON.stringify(obj));
    } catch { /* ignore */ }
  }, 600);
}

export function cacheProfile(inboxId: string, profile: CachedProfile): void {
  const merged = { ..._profileCache.get(inboxId), ...profile };
  // Strip explicit undefined/null nftImage so we don't overwrite a good image with null
  if (profile.nftImage === null && _profileCache.get(inboxId)?.nftImage) {
    merged.nftImage = _profileCache.get(inboxId)!.nftImage;
  }
  _profileCache.set(inboxId, merged);
  _schedulePersist();
}

export function getCachedProfile(inboxId: string): CachedProfile | null {
  return _profileCache.get(inboxId) ?? null;
}
