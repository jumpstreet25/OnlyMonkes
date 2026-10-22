/**
 * remoteConfig
 *
 * Stores the XMTP global group ID and admin inboxId in the public GitHub repo
 * (config/app-config.json) so every tester's app automatically finds the same
 * group without rebuilding the APK.
 *
 * Reads:  raw.githubusercontent.com — no auth, always fast.
 * Writes: routed through the Cloudflare Worker (POST /api/admin/publish-app-config).
 *         The admin's wallet signs a domain-separated message proving identity;
 *         the worker verifies it against ADMIN_WALLET_PUBKEY and holds the
 *         actual GitHub credential — no GitHub token ever touches the phone.
 */

const WORKER_BASE = 'https://onlymonkes-actions.jumpstreet25.workers.dev';

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

const REPO   = 'jumpstreet25/OnlyMonkes';
const BRANCH = 'master';
const FILE   = 'config/app-config.json';
const RAW    = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE}`;

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
      globalGroupId:  json.globalGroupId  ?? '',
      adminInboxId:   json.adminInboxId   ?? '',
      botInboxId:     json.botInboxId     ?? undefined,
      botChannels:    json.botChannels    ?? undefined,
      genesisGroupId: json.genesisGroupId ?? undefined,
    };
  } catch {
    return EMPTY;
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Publish config via the worker. By default, the worker refuses to overwrite
 * an existing valid config (one with a non-empty globalGroupId AND the trades
 * bot channel populated). Pass `force: true` to bypass — manual recovery only.
 *
 * `signMessage` is the admin's wallet signer (e.g. from useMobileWallet) — it
 * signs the exact same domain-separated message the worker reconstructs and
 * verifies, so the config payload itself is bound into the signature.
 */
export async function publishAppConfig(
  config: AppRemoteConfig,
  wallet: string,
  signMessage: (bytes: Uint8Array) => Promise<Uint8Array>,
  opts?: { force?: boolean },
): Promise<void> {
  const ts = Date.now();
  const configJson = JSON.stringify(config, null, 2);
  const message = `OnlyMonkes Admin Publish\n${wallet}\n${ts}\n${configJson}`;
  const sigBytes = await signMessage(new TextEncoder().encode(message));
  const signature = btoa(String.fromCharCode(...sigBytes));

  const res = await fetch(`${WORKER_BASE}/api/admin/publish-app-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, wallet, ts, signature, force: opts?.force ?? false }),
  });

  const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) {
    throw new Error(body.error ?? `Publish failed: ${res.status}`);
  }
}
