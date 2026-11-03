/**
 * "Update OnlyMonkes" banner — config/app-update.json on master, read from
 * raw.githubusercontent.com (same zero-cost pattern as monkeMeme/config.ts).
 * Turned on for switch day of the XMTP move: the 3.0 binary (runtime 3.4)
 * stays on the old network, so its users have to install 3.1 from the dApp
 * Store. Flip it without an OTA:
 *
 *   { "enabled": true }                    → dismissible banner (hides for a day)
 *   { "enabled": true, "required": true }  → no dismiss (after switch day)
 *   { "runtimes": ["3.4"] }                → which binaries see it
 *
 * Master is merged into the 3.1 branch, so the runtime check keeps 3.1
 * (runtime 3.5) from telling its own users to update.
 */

import { Platform } from "react-native";
import * as Updates from "expo-updates";

const RAW = "https://raw.githubusercontent.com/jumpstreet25/OnlyMonkes/master/config/app-update.json";

export const STORE_DEEP_LINK = "solanadappstore://details?id=com.onlymonkes.app";
export const STORE_FALLBACK_URL = "https://onlymonkes.app/get";
export const DISMISS_MS = 24 * 60 * 60 * 1000;

export interface AppUpdateConfig {
  enabled: boolean;
  required: boolean;
  runtimes: string[];
}

const OFF: AppUpdateConfig = { enabled: false, required: false, runtimes: [] };

export function parseAppUpdateConfig(json: unknown): AppUpdateConfig {
  const j = (json && typeof json === "object" ? json : {}) as Partial<AppUpdateConfig>;
  return {
    enabled: j.enabled === true,
    required: j.required === true,
    runtimes: Array.isArray(j.runtimes) ? j.runtimes.filter((r): r is string => typeof r === "string") : [],
  };
}

export function shouldShowUpdateBanner(
  cfg: AppUpdateConfig,
  runtime: string | null | undefined,
  dismissedAt: number | null,
  now: number,
): boolean {
  if (!cfg.enabled || !runtime || !cfg.runtimes.includes(runtime)) return false;
  if (cfg.required) return true;
  // A dismiss "in the future" (clock changed) counts as expired, not as hidden for weeks.
  return !dismissedAt || dismissedAt > now || now - dismissedAt >= DISMISS_MS;
}

export function currentRuntime(): string | null {
  if (Platform.OS === "web" || __DEV__) return null;
  return Updates.runtimeVersion ?? null;
}

export async function fetchAppUpdateConfig(): Promise<AppUpdateConfig> {
  try {
    // No cache-buster: GitHub's ~5 min CDN cache is fine for a switch, and on switch day every
    // open would otherwise hit GitHub's origin (rate limit → OFF exactly when it's needed).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(RAW, { signal: controller.signal });
      return res.ok ? parseAppUpdateConfig(await res.json()) : OFF;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return OFF;
  }
}
