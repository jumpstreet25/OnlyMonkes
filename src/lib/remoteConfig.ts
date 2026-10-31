/**
 * remoteConfig
 *
 * Stores the XMTP group IDs and admin inboxId in the public GitHub repo so every app
 * finds the same groups without a rebuild.
 *
 * Reads:  raw.githubusercontent.com — no auth, always fast.
 * SDK 8 (self-hosted backend) reads config/app-config.v8.json; config/app-config.json
 * stays 3.4's old-network groups. Staging uses the bundled staging file. No app-side writes.
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

import { configFileUrl } from "@/lib/configUrl";
import { XMTP_ON_STAGING } from '@/lib/xmtpBackend';
import STAGING_CONFIG from '../../config/app-config.staging.json';
import V8_CONFIG from '../../config/app-config.v8.json';

const REPO   = 'jumpstreet25/OnlyMonkes';
const BRANCH = 'master';
// SDK 8 on the production self-hosted backend: config/app-config.json is 3.4's (old network).
const FILE   = 'config/app-config.v8.json';
const RAW    = configFileUrl(FILE); // raw GitHub; same-origin on the website

// Bundled copy of the v8 file, used when the fetch fails.
const BUNDLED = V8_CONFIG as AppRemoteConfig;

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function fetchAppConfig(): Promise<AppRemoteConfig> {
  // On the staging XMTP backend (SDK 8 build, same switch as the 3.1 phone build) the groups
  // only exist there — bundled staging IDs; master's config points at the old network's groups.
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

/** Old admin publish path (worker → config/app-config.json); refused on SDK 8. */
export async function publishAppConfig(
  _config: AppRemoteConfig,
  _wallet: string,
  _signMessage: (bytes: Uint8Array) => Promise<Uint8Array>,
  _opts?: { force?: boolean },
): Promise<void> {
  // The worker writes config/app-config.json (3.4's old-network groups). SDK 8 groups are
  // created by the bot (`--create-v8-groups`) and go into config/app-config.v8.json by commit.
  throw new Error('SDK 8 group IDs live in config/app-config.v8.json — set them from the bot, not the app');
}
