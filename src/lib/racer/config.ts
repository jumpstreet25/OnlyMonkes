/**
 * Monke RC tile — config/racer.json on master, read raw like config/monkecaves.json
 * (same shape and rules: dark launch for the admin + testerWalletHashes,
 * { "testersOnly": false } opens it to every holder without an OTA,
 * { "enabled": false } is the kill switch, a failed fetch stays hidden).
 */
import { DEFAULT_MONKECAVES_CONFIG, monkeCavesVisible, parseMonkeCavesConfig, type MonkeCavesConfig } from "@/lib/monkeCaves/config";

const RAW = "https://raw.githubusercontent.com/jumpstreet25/OnlyMonkes/master/config/racer.json";
const TTL_MS = 10 * 60 * 1000;

export type RacerConfig = MonkeCavesConfig;
export const parseRacerConfig = parseMonkeCavesConfig;
export const racerVisible = monkeCavesVisible;

let _cache: { cfg: RacerConfig; at: number } | null = null;

export async function getRacerConfig(): Promise<RacerConfig> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.cfg;
  let cfg = DEFAULT_MONKECAVES_CONFIG;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${RAW}?t=${Date.now()}`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) cfg = parseRacerConfig(await res.json());
  } catch {
    // keep defaults
  }
  _cache = { cfg, at: Date.now() };
  return cfg;
}
