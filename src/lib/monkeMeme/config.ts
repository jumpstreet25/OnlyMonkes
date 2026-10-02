/**
 * MonkeMeme remote config — config/monkememe.json on master, read from
 * raw.githubusercontent.com (same zero-cost pattern as remoteConfig.ts and
 * sagaMonkesIndex.ts). Lets us switch the feature off or point it at a
 * different generator Space without an OTA:
 *
 *   { "enabled": false }                       → kill switch
 *   { "spaceUrl": "https://<you>-<space>.hf.space" } → own Space (Jumpstre3t HF account, eligible from ~2026-10-31)
 *
 * Missing file / network failure → DEFAULTS, so a GitHub hiccup never
 * breaks the screen.
 */

import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

const RAW = "https://raw.githubusercontent.com/jumpstreet25/OnlyMonkes/master/config/monkememe.json";

export interface MonkeMemeConfig {
  enabled: boolean;
  /** Gradio Space base URL (no trailing slash, no /gradio_api). */
  spaceUrl: string;
  /** Our own house-style reference image (image 2). Empty → words only. */
  styleRefUrl: string;
  /** Worker base URL for the Workers AI fallback. Empty → no fallback. */
  fallbackUrl: string;
  /** Per-device daily cap across both providers. Anonymous ZeroGPU callers
   *  get only ~3 runs/day and the Worker allows 6 per IP, so 6 keeps the
   *  counter honest without promising memes neither provider will draw. */
  dailyLimit: number;
  /** Dark launch: only the app admin (store isGroupAdmin) sees MonkeMeme.
   *  Defaults to true so a failed config fetch keeps it hidden, never open;
   *  set "testersOnly": false in config/monkememe.json to launch. */
  testersOnly: boolean;
  /** Extra testers during the dark launch, as lowercase hex SHA-256 of the
   *  wallet address — config/monkememe.json is public, so never raw wallets. */
  testerWalletHashes: string[];
}

export const DEFAULT_MONKEMEME_CONFIG: MonkeMemeConfig = {
  enabled: true,
  spaceUrl: "https://black-forest-labs-flux-2-klein-4b.hf.space",
  styleRefUrl: "https://raw.githubusercontent.com/jumpstreet25/OnlyMonkes/master/config/monkememe/style-ref-1.png",
  fallbackUrl: "https://onlymonkes-actions.jumpstreet25.workers.dev",
  dailyLimit: 6,
  testersOnly: true,
  testerWalletHashes: [],
};

let _cache: { cfg: MonkeMemeConfig; at: number } | null = null;

export function walletHash(wallet: string): string {
  return bytesToHex(sha256(utf8ToBytes(wallet)));
}

/** Whether this user should see MonkeMeme at all (menu tile + page). */
export function monkeMemeVisible(cfg: MonkeMemeConfig | null, isAdmin: boolean, wallet?: string | null): boolean {
  if (!cfg || !cfg.enabled) return false;
  if (!cfg.testersOnly || isAdmin) return true;
  return !!wallet && cfg.testerWalletHashes.includes(walletHash(wallet));
}
const TTL_MS = 10 * 60 * 1000;

export function parseMonkeMemeConfig(json: unknown): MonkeMemeConfig {
  const j = (json && typeof json === "object" ? json : {}) as Partial<MonkeMemeConfig>;
  const d = DEFAULT_MONKEMEME_CONFIG;
  return {
    enabled: typeof j.enabled === "boolean" ? j.enabled : d.enabled,
    spaceUrl: typeof j.spaceUrl === "string" && /^https:\/\//.test(j.spaceUrl) ? j.spaceUrl.replace(/\/+$/, "") : d.spaceUrl,
    styleRefUrl: typeof j.styleRefUrl === "string" ? j.styleRefUrl : d.styleRefUrl,
    fallbackUrl:
      typeof j.fallbackUrl === "string" && (j.fallbackUrl === "" || /^https:\/\//.test(j.fallbackUrl))
        ? j.fallbackUrl.replace(/\/+$/, "")
        : d.fallbackUrl,
    dailyLimit: typeof j.dailyLimit === "number" && j.dailyLimit > 0 ? Math.floor(j.dailyLimit) : d.dailyLimit,
    testersOnly: typeof j.testersOnly === "boolean" ? j.testersOnly : d.testersOnly,
    testerWalletHashes: Array.isArray(j.testerWalletHashes)
      ? j.testerWalletHashes.filter((h): h is string => typeof h === "string" && /^[0-9a-f]{64}$/.test(h))
      : d.testerWalletHashes,
  };
}

export async function getMonkeMemeConfig(): Promise<MonkeMemeConfig> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.cfg;
  let cfg = DEFAULT_MONKEMEME_CONFIG;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${RAW}?t=${Date.now()}`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) cfg = parseMonkeMemeConfig(await res.json());
  } catch {
    // keep defaults
  }
  _cache = { cfg, at: Date.now() };
  return cfg;
}
