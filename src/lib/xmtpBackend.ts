/**
 * Which self-hosted XMTP deployment this build talks to (3.1, SDK 8).
 * Staging (identifier onlymonkes-staging) until app, bot and web cut over together to
 * production, https://xmtp.onlymonkes.app (identifier onlymonkes).
 */
export const XMTP_STAGING_URL = "https://157-173-192-39.sslip.io";
export const XMTP_BACKEND_URL = XMTP_STAGING_URL;
export const XMTP_ON_STAGING = XMTP_BACKEND_URL === XMTP_STAGING_URL;
