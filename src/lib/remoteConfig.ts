/**
 * remoteConfig
 *
 * Stores the XMTP global group ID and admin inboxId in the public GitHub repo
 * (config/app-config.json) so every tester's app automatically finds the same
 * group without rebuilding the APK.
 *
 * Reads:  raw.githubusercontent.com — no auth, always fast.
 * Writes: GitHub Contents API — requires a classic PAT (repo scope).
 *         The admin enters their PAT once in-app; it's saved to SecureStore.
 */

import * as SecureStore from 'expo-secure-store';

export interface AppRemoteConfig {
  globalGroupId: string;
  adminInboxId: string;
}

const REPO   = 'jumpstreet25/OnlyMonkes';
const BRANCH = 'master';
const FILE   = 'config/app-config.json';
const RAW    = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE}`;
const API    = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
const SK_TOKEN = 'admin_gh_token';

const EMPTY: AppRemoteConfig = { globalGroupId: '', adminInboxId: '' };

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function fetchAppConfig(): Promise<AppRemoteConfig> {
  try {
    // Cache-bust so testers always get the latest group ID.
    const res = await fetch(`${RAW}?t=${Date.now()}`);
    if (!res.ok) return EMPTY;
    const json = await res.json();
    return {
      globalGroupId: json.globalGroupId ?? '',
      adminInboxId:  json.adminInboxId  ?? '',
    };
  } catch {
    return EMPTY;
  }
}

// ─── Admin token (stored in SecureStore, never in source code) ────────────────

export async function getAdminToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SK_TOKEN);
}

export async function saveAdminToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SK_TOKEN, token.trim());
}

export async function clearAdminToken(): Promise<void> {
  await SecureStore.deleteItemAsync(SK_TOKEN);
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function publishAppConfig(config: AppRemoteConfig): Promise<void> {
  const token = await getAdminToken();
  if (!token) throw new Error('No admin token — enter your GitHub PAT in Admin Settings.');

  // Fetch current SHA (required by GitHub API to update a file).
  const infoRes = await fetch(API, {
    headers: {
      Authorization: `token ${token}`,
      'User-Agent': 'OnlyMonkes-App',
    },
  });
  if (!infoRes.ok) throw new Error(`GitHub API error ${infoRes.status} — check your PAT.`);
  const info = await infoRes.json();

  const content = Buffer.from(JSON.stringify(config, null, 2), 'utf8').toString('base64');

  const putRes = await fetch(API, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'OnlyMonkes-App',
    },
    body: JSON.stringify({
      message: 'chore: update app config [skip ci]',
      content,
      sha: info.sha,
    }),
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Publish failed: ${putRes.status}`);
  }
}
