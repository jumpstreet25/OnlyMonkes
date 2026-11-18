/**
 * MonkeCaves remote config — config/monkecaves.json on master, read raw from
 * GitHub like config/monkememe.json, so the tile can go live without an OTA:
 *   { "testersOnly": false } → every holder sees MonkeCaves
 *   { "enabled": false }     → kill switch
 * Dark launch by default: only the admin and testerWalletHashes (lowercase hex
 * SHA-256 of the wallet — the file is public, never raw wallets) see it, and a
 * failed fetch keeps it hidden.
 */
import { walletHash } from "@/lib/monkeMeme/config";

const RAW = "https://raw.githubusercontent.com/jumpstreet25/OnlyMonkes/master/config/monkecaves.json";
const TTL_MS = 10 * 60 * 1000;

export interface MonkeCavesConfig {
  enabled: boolean;
  testersOnly: boolean;
  testerWalletHashes: string[];
}

export const DEFAULT_MONKECAVES_CONFIG: MonkeCavesConfig = { enabled: true, testersOnly: true, testerWalletHashes: [] };

export function parseMonkeCavesConfig(json: unknown): MonkeCavesConfig {
  const j = (json && typeof json === "object" ? json : {}) as Partial<MonkeCavesConfig>;
  const d = DEFAULT_MONKECAVES_CONFIG;
  return {
    enabled: typeof j.enabled === "boolean" ? j.enabled : d.enabled,
    testersOnly: typeof j.testersOnly === "boolean" ? j.testersOnly : d.testersOnly,
    testerWalletHashes: Array.isArray(j.testerWalletHashes)
      ? j.testerWalletHashes.filter((h): h is string => typeof h === "string" && /^[0-9a-f]{64}$/.test(h))
      : d.testerWalletHashes,
  };
}

export function monkeCavesVisible(cfg: MonkeCavesConfig | null, isAdmin: boolean, wallet?: string | null): boolean {
  if (!cfg || !cfg.enabled) return false;
  if (!cfg.testersOnly || isAdmin) return true;
  return !!wallet && cfg.testerWalletHashes.includes(walletHash(wallet));
}

let _cache: { cfg: MonkeCavesConfig; at: number } | null = null;

export async function getMonkeCavesConfig(): Promise<MonkeCavesConfig> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.cfg;
  let cfg = DEFAULT_MONKECAVES_CONFIG;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${RAW}?t=${Date.now()}`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) cfg = parseMonkeCavesConfig(await res.json());
  } catch {
    // keep defaults
  }
  _cache = { cfg, at: Date.now() };
  return cfg;
}
