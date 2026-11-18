/**
 * How OnlyMonkes introduces itself to Solana wallets (MWA authorize + Sign In With Solana).
 * Our own domain: onlymonkes.app publishes the app's signing key in assetlinks.json, so a
 * wallet can tie the request to this app. It used to be the actions worker's *.workers.dev
 * host — Backpack (Blockaid screening) blocked that origin as suspicious (2026-11-11).
 * A change here costs every user one fresh "Connect" approval: wallets key approvals by it.
 */
export const WALLET_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://onlymonkes.app",
  // Wallets load uri + icon; /favicon.ico is served as HTML (site fallback), so Seed Vault showed
  // a "?" badge on the connect sheet. This path is a real 180×180 PNG.
  icon: "site/apple-touch-icon.png",
};

/** Sign In With Solana `domain` — must match WALLET_IDENTITY.uri's host (wallets warn on a mismatch). */
export const SIGNIN_DOMAIN = "onlymonkes.app";
