/**
 * Web wallet layer: every browser wallet (Phantom, Solflare, Backpack, …) and
 * Seeker Connect (the Seeker's own wallet, from the phone's browser) through
 * one Wallet Standard interface. src/web/mwaCompat.ts puts the MWA
 * `transact()` API on top of this, so app call sites stay unchanged.
 */

import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

const CHAIN = "solana:mainnet";
const SEEKER_CONNECT_NAME = "Seeker Connect";
const SELECTED_KEY = "om_web_wallet";

export const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: typeof window !== "undefined" && window.location ? window.location.origin : "https://onlymonkes-actions.jumpstreet25.workers.dev",
  icon: "favicon.ico",
};

export function isAndroidBrowser(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

/**
 * Android in-app browsers (Google app / Lens camera scans, other apps' link viewers) are WebViews:
 * Mobile Wallet Adapter refuses to register there and Seeker Connect's App
 * Link opens solanamobile.com instead of the wallet. Same test as
 * @solana-mobile/wallet-standard-mobile's isWebView.
 */
export function isInAppBrowser(): boolean {
  if (!isAndroidBrowser()) return false;
  const ua = navigator.userAgent;
  if (/SolanaMobileWebShell/i.test(ua)) return false;
  return /(WebView|Version\/.+(Chrome)\/(\d+)\.(\d+)\.(\d+)\.(\d+)|; wv\).+(Chrome)\/(\d+)\.(\d+)\.(\d+)\.(\d+))/i.test(ua);
}

/** Reopen the current page (path + #fragment) in Chrome via an Android intent link. */
export function openInChrome(): void {
  const { host, pathname, search, hash } = window.location;
  window.location.href = `intent://${host}${pathname}${search}${hash}#Intent;scheme=https;package=com.android.chrome;end`;
}

export const SOLANA_MOBILE_RELAY = "relay.solanamobile.com";
/** Wallet Standard name of Solana Mobile's QR (remote) wallet adapter. */
export const QR_WALLET_NAME = "Remote Mobile Wallet Adapter";
export const SEEKER_CONNECT_WALLET_NAME = SEEKER_CONNECT_NAME;
/** Wallet Standard name of Solana Mobile's local (same-phone) wallet adapter. */
export const MWA_WALLET_NAME = "Mobile Wallet Adapter";

let _mobileRegistered = false;
/**
 * Off until Seed Vault supports Seeker Connect: today its connect.solanamobile.com
 * link falls through to the dApp Store (owner's Seeker, 2026-10-22). Mobile
 * Wallet Adapter covers Seed Vault in Chrome meanwhile.
 */
const SEEKER_CONNECT_ENABLED = false;

/**
 * Solana Mobile wallets, both over Solana Mobile's Nostr relay (using it
 * requires accepting their terms:
 * https://docs.solanamobile.com/solana-mobile-stack/seeker-connect-quickstart).
 *  - Android browser: Mobile Wallet Adapter registers a local wallet (any MWA
 *    wallet app), and Seeker Connect talks to the Seeker's built-in wallet.
 *  - Desktop: nothing yet. registerMwa would add its remote QR wallet, but no
 *    production wallet supports remote association (Seed Vault reports "not
 *    compatible"; solana-mobile/mobile-wallet-adapter#1484, maintainer
 *    2026-05: "MWA remote has not been rolled out publicly yet"). Re-enable
 *    once Seed Vault ships it.
 */
async function registerMobileWalletsOnce(): Promise<void> {
  if (_mobileRegistered || typeof window === "undefined") return;
  _mobileRegistered = true;
  if (!isAndroidBrowser() || isInAppBrowser()) return;
  try {
    const mwa = await import("@solana-mobile/wallet-standard-mobile");
    mwa.registerMwa({
      appIdentity: APP_IDENTITY,
      authorizationCache: mwa.createDefaultAuthorizationCache(),
      chains: ["solana:mainnet"],
      chainSelector: mwa.createDefaultChainSelector(),
      onWalletNotFound: mwa.createDefaultWalletNotFoundHandler(),
      nostrRelay: SOLANA_MOBILE_RELAY,
    });
  } catch (e) {
    console.warn("[wallet] Mobile Wallet Adapter unavailable:", (e as Error)?.message);
  }
  if (!SEEKER_CONNECT_ENABLED) return;
  try {
    const { registerSeekerConnect } = await import("@solana-mobile/seeker-connect-wallet-standard");
    registerSeekerConnect({ identity: APP_IDENTITY, relayDomain: SOLANA_MOBILE_RELAY } as any);
  } catch (e) {
    console.warn("[wallet] Seeker Connect unavailable:", (e as Error)?.message);
  }
}

function isUsable(w: Wallet): boolean {
  const f = w.features as Record<string, unknown>;
  return (
    w.chains.some((c) => c === CHAIN || c === "solana:mainnet-beta") &&
    !!f["standard:connect"] &&
    !!f["solana:signMessage"] &&
    (!!f["solana:signTransaction"] || !!f["solana:signAndSendTransaction"])
  );
}

/**
 * Solana Mobile wallets first. Plain Mobile Wallet Adapter leads: it is what
 * the OnlyMonkes app already uses with Seed Vault. Seeker Connect launches
 * through the connect.solanamobile.com App Link, which in-app browsers and
 * wallets without Seeker Connect support turn into a dApp Store redirect.
 */
function mobileRank(w: Wallet): number {
  return /Mobile Wallet Adapter/.test(w.name) ? 2 : w.name === SEEKER_CONNECT_NAME ? 1 : 0;
}

export function listWallets(): Wallet[] {
  void registerMobileWalletsOnce();
  const seen = new Set<string>();
  return getWallets()
    .get()
    .filter(isUsable)
    .filter((w) => (seen.has(w.name) ? false : (seen.add(w.name), true)))
    .sort((a, b) => mobileRank(b) - mobileRank(a));
}

/** Calls back whenever a wallet extension registers late (they inject async). */
export function onWalletsChanged(cb: () => void): () => void {
  void registerMobileWalletsOnce();
  const api = getWallets();
  const offReg = api.on("register", cb);
  const offUnreg = api.on("unregister", cb);
  return () => { offReg(); offUnreg(); };
}

let _selected: string | null = null;

export function selectWallet(name: string): void {
  _selected = name;
  try { localStorage.setItem(SELECTED_KEY, name); } catch { /* storage blocked */ }
}

export function clearSelectedWallet(): void {
  _selected = null;
  try { localStorage.removeItem(SELECTED_KEY); } catch { /* storage blocked */ }
}

function selectedName(): string | null {
  if (_selected) return _selected;
  try { _selected = localStorage.getItem(SELECTED_KEY); } catch { /* storage blocked */ }
  return _selected;
}

/** The chosen wallet; waits briefly for its extension to register on page load. */
export async function getSelectedWallet(): Promise<Wallet> {
  const name = selectedName();
  const wallets = listWallets();
  if (!name) {
    if (wallets.length === 1) return wallets[0];
    throw new Error("Choose a wallet to continue.");
  }
  const found = wallets.find((w) => w.name === name);
  if (found) return found;
  return new Promise<Wallet>((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error(`${name} wallet not found in this browser.`)); }, 3000);
    const off = onWalletsChanged(() => {
      const w = listWallets().find((x) => x.name === name);
      if (w) { clearTimeout(timer); off(); resolve(w); }
    });
  });
}

export async function connectWallet(wallet: Wallet, silent: boolean): Promise<readonly WalletAccount[]> {
  const connect = (wallet.features as any)["standard:connect"].connect;
  if (silent) {
    try {
      const r = await connect({ silent: true });
      if (r?.accounts?.length) return r.accounts;
    } catch { /* fall through to an interactive connect */ }
  }
  if (wallet.accounts.length && silent) return wallet.accounts;
  const r = await connect();
  return r?.accounts?.length ? r.accounts : wallet.accounts;
}

export async function disconnectWallet(): Promise<void> {
  try {
    const w = await getSelectedWallet();
    await (w.features as any)["standard:disconnect"]?.disconnect?.();
  } catch { /* nothing connected */ }
  clearSelectedWallet();
}

function endsWith(a: Uint8Array, b: Uint8Array): boolean {
  if (b.length > a.length) return false;
  const off = a.length - b.length;
  for (let i = 0; i < b.length; i++) if (a[off + i] !== b[i]) return false;
  return true;
}

/**
 * Sign a message and return it in MWA's `sign_messages` format: the message
 * with the signature appended. The phone app feeds exactly those bytes into
 * the XMTP identity derivation, so web must produce the same bytes or a user
 * would get a new, empty inbox. Seeker Connect already returns that payload
 * as `signedMessage`; extension wallets return the bare message there.
 */
export async function signMessageMwaFormat(
  wallet: Wallet,
  account: WalletAccount,
  message: Uint8Array,
): Promise<Uint8Array> {
  const [out] = await (wallet.features as any)["solana:signMessage"].signMessage({ account, message });
  const signed: Uint8Array = out.signedMessage;
  const sig: Uint8Array = out.signature;
  if (endsWith(signed, sig) && signed.length > sig.length) return signed;
  const joined = new Uint8Array(signed.length + sig.length);
  joined.set(signed, 0);
  joined.set(sig, signed.length);
  return joined;
}

export async function signTransactionBytes(wallet: Wallet, account: WalletAccount, tx: Uint8Array): Promise<Uint8Array> {
  const f = (wallet.features as any)["solana:signTransaction"];
  if (!f) throw new Error(`${wallet.name} can't sign transactions without sending them.`);
  const [out] = await f.signTransaction({ account, transaction: tx, chain: CHAIN });
  return out.signedTransaction;
}

export async function signAndSendTransactionBytes(
  wallet: Wallet,
  account: WalletAccount,
  tx: Uint8Array,
  options?: { minContextSlot?: number; skipPreflight?: boolean; maxRetries?: number; commitment?: string },
): Promise<Uint8Array | null> {
  const f = (wallet.features as any)["solana:signAndSendTransaction"];
  if (!f) return null;
  const [out] = await f.signAndSendTransaction({
    account,
    transaction: tx,
    chain: CHAIN,
    options: options
      ? {
          minContextSlot: options.minContextSlot,
          skipPreflight: options.skipPreflight,
          maxRetries: options.maxRetries,
          preflightCommitment: options.commitment,
        }
      : undefined,
  });
  return out.signature;
}

/** Bare 64-byte Ed25519 signature over `message` (server-side sign-in check). */
export async function signMessageRaw(wallet: Wallet, account: WalletAccount, message: Uint8Array): Promise<Uint8Array> {
  const [out] = await (wallet.features as any)["solana:signMessage"].signMessage({ account, message });
  const sig: Uint8Array = out.signature;
  if (sig?.length !== 64) throw new Error(`${wallet.name} returned an unexpected signature`);
  return sig;
}

// Register Solana Mobile's wallets as soon as the web app loads, so the QR
// option is already in the list when the connect sheet opens.
if (typeof window !== "undefined") void registerMobileWalletsOnce();
