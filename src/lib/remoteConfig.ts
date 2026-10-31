/**
 * remoteConfig
 *
 * Stores the XMTP global group ID and admin inboxId in the public GitHub repo so every
 * app finds the same groups without rebuilding the APK. 3.1 on the production self-hosted
 * backend reads config/app-config.v8.json — config/app-config.json belongs to 3.4, whose
 * groups stay on the old network. Staging builds use the bundled staging file.
 *
 * Reads:  raw.githubusercontent.com — no auth, always fast.
 * Writes: routed through the Cloudflare Worker (POST /api/admin/publish-app-config).
 *         The admin's wallet signs a domain-separated message proving identity;
 *         the worker verifies it against ADMIN_WALLET_PUBKEY and holds the
 *         actual GitHub credential — no GitHub token ever touches the phone.
 */

export interface AppRemoteConfig {
  globalGroupId: string;
  adminInboxId: string;
  botInboxId?: string;
  botChannels?: {
    trades?: string;
  };
  /** Genesis Chat's XMTP group ID. Not part of botChannels — Genesis is its own
   *  group with a separate, genesis-token-gated join flow, never auto-joined
   *  alongside Main Chat/Trades. */
  genesisGroupId?: string;
}

import { XMTP_ON_STAGING } from '@/lib/xmtpBackend';
import STAGING_CONFIG from '../../config/app-config.staging.json';
import V8_CONFIG from '../../config/app-config.v8.json';

const REPO   = 'jumpstreet25/OnlyMonkes';
const BRANCH = 'master';
const FILE   = 'config/app-config.v8.json';
const RAW    = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE}`;

// Bundled copy of the v8 file: used when GitHub can't be reached, so a fresh install still
// finds the groups.
const BUNDLED = V8_CONFIG as AppRemoteConfig;

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function fetchAppConfig(): Promise<AppRemoteConfig> {
  // 3.1 on the staging XMTP backend: its groups only exist there (staging helper's IDs,
  // bundled — master's config points at the old network's groups).
  if (XMTP_ON_STAGING) return STAGING_CONFIG as AppRemoteConfig;
  try {
    // Cache-bust so testers always get the latest group ID.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${RAW}?t=${Date.now()}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return BUNDLED;
    const json = await res.json();
    if (!json.globalGroupId) return BUNDLED;
    return {
      globalGroupId:  json.globalGroupId  ?? '',
      adminInboxId:   json.adminInboxId   ?? '',
      botInboxId:     json.botInboxId     ?? undefined,
      botChannels:    json.botChannels    ?? undefined,
      genesisGroupId: json.genesisGroupId ?? undefined,
    };
  } catch {
    return BUNDLED;
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

/** Old admin publish path (worker → config/app-config.json); refused on 3.1. */
export async function publishAppConfig(
  _config: AppRemoteConfig,
  _wallet: string,
  _signMessage: (bytes: Uint8Array) => Promise<Uint8Array>,
  _opts?: { force?: boolean },
): Promise<void> {
  // The worker writes config/app-config.json (3.4's old-network groups). 3.1's groups are
  // created by the bot (`--create-v8-groups`) and go into config/app-config.v8.json by commit.
  throw new Error('3.1 group IDs live in config/app-config.v8.json — set them from the bot, not the app');
}
