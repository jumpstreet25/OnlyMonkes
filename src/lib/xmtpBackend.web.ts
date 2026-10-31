/**
 * Web build of xmtpBackend.ts. Production (https://xmtp.onlymonkes.app, identifier onlymonkes)
 * only on the public onlymonkes.app hosts; localhost, the harness and any other origin stay on
 * staging (onlymonkes-staging). Decided from where the page is served, so a local or test
 * build can never connect to production.
 */
export const XMTP_STAGING_URL = "https://157-173-192-39.sslip.io";
export const XMTP_PRODUCTION_URL = "https://xmtp.onlymonkes.app";

const PRODUCTION_HOSTS = new Set([
  "onlymonkes.app",
  "www.onlymonkes.app",
  "app.onlymonkes.app",
  "onlymonkes-web.jumpstreet25.workers.dev",
]);

export function pickXmtpBackend(hostname: string | null | undefined): string {
  return hostname && PRODUCTION_HOSTS.has(hostname) ? XMTP_PRODUCTION_URL : XMTP_STAGING_URL;
}

export const XMTP_BACKEND_URL = pickXmtpBackend(
  typeof location !== "undefined" ? location.hostname : null,
);
export const XMTP_ON_STAGING = XMTP_BACKEND_URL === XMTP_STAGING_URL;
