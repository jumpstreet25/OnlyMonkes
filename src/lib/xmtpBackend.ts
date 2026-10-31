/**
 * Which self-hosted XMTP deployment this build talks to (3.1, SDK 8).
 *
 * Production (https://xmtp.onlymonkes.app, identifier onlymonkes) only for the store package
 * `com.onlymonkes.app` in a release build. Everything else — the `next` / `canary` test flavors
 * and any dev build — stays on staging (onlymonkes-staging). Decided from the installed package,
 * not a build-time env var, so a JS OTA (one channel for every 3.1 flavor) can never move a
 * build between deployments.
 */
import * as Application from "expo-application";

export const XMTP_STAGING_URL = "https://157-173-192-39.sslip.io";
export const XMTP_PRODUCTION_URL = "https://xmtp.onlymonkes.app";

export function pickXmtpBackend(applicationId: string | null | undefined, isDev: boolean): string {
  return applicationId === "com.onlymonkes.app" && !isDev ? XMTP_PRODUCTION_URL : XMTP_STAGING_URL;
}

export const XMTP_BACKEND_URL = pickXmtpBackend(Application.applicationId, __DEV__);
export const XMTP_ON_STAGING = XMTP_BACKEND_URL === XMTP_STAGING_URL;
