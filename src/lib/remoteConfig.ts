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
  botInboxId?: string;
  botChannels?: {
    trades?: string;
  };
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${RAW}?t=${Date.now()}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return EMPTY;
    const json = await res.json();
    return {
      globalGroupId: json.globalGroupId ?? '',
      adminInboxId:  json.adminInboxId  ?? '',
      botInboxId:    json.botInboxId    ?? undefined,
      botChannels:   json.botChannels   ?? undefined,
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

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Publish config to GitHub. By default, refuses to overwrite an existing valid
 * config (one with a non-empty globalGroupId AND the trades bot channel populated).
 * Pass `force: true` to bypass the guard — use only for intentional manual recovery.
 */
export async function publishAppConfig(
  config: AppRemoteConfig,
  opts?: { force?: boolean },
): Promise<void> {
  const token = await getAdminToken();
  if (!token) throw new Error('No admin token — enter your GitHub PAT in Admin Settings.');

  // ── Safety guard: don't overwrite a working config ────────────────────────
  if (!opts?.force) {
    const existing = await fetchAppConfig();
    const hasGroup = !!existing.globalGroupId;
    const hasAllChannels = !!existing.botChannels?.trades;

    if (hasGroup && hasAllChannels) {
      // Remote config is already complete — refuse silent overwrite.
      // This prevents admin self-heal from clobbering the bot's working group IDs
      // when the admin's local XMTP DB is wiped but everyone else is fine.
      console.warn(
        '[remoteConfig] BLOCKED auto-publish — remote config already has valid group IDs.',
        'Existing:', existing.globalGroupId.slice(0, 8) + '…',
        'Attempted:', config.globalGroupId.slice(0, 8) + '…',
        'Use force:true to override.',
      );
      return;
    }
  }

  // Fetch current SHA (required by GitHub API to update a file).
  const infoRes = await fetch(API, {
    headers: {
      Authorization: `token ${token}`,
      'User-Agent': 'OnlyMonkes-App',
    },
  });
  if (!infoRes.ok) throw new Error(`GitHub API error ${infoRes.status} — check your PAT.`);
  const info = await infoRes.json() as { sha?: string };
  if (!info.sha) throw new Error('GitHub API response missing SHA — cannot update config.');

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
