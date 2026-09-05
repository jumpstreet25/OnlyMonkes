/**
 * portfolioHttp.ts — direct-to-worker /portfolio fetch, bypassing XMTP.
 *
 * 2026-09-05: /portfolio DM replies occasionally sit on XMTP's own send-side
 * "database locked" retry loop (single local MLS SQLite store on the bot,
 * one writer, shared with every scan/stream it runs). This hits
 * worker-actions' /api/portfolio (wallet-signature verified, relays to the
 * bot's own /api/portfolio over a trusted server-to-server hop) as a
 * fast-path RACE alongside the normal /portfolio DM send — never a
 * replacement. Every failure mode here (network, auth, bot down, timeout)
 * resolves to null; callers MUST still rely on the existing XMTP DM reply
 * to eventually populate the portfolio, this is a speed optimization only.
 *
 * Auth: signs a domain-separated message with the connected wallet
 * (signBytesWithMwa — same MWA prompt used elsewhere in the app). The first
 * cut of this cached the signature in memory for 9 minutes, which in
 * practice meant a real MWA prompt on almost every /portfolio tap (any
 * backgrounding/app-restart between taps drops in-memory state) — reported
 * live as "keeps making me sign a transaction." This endpoint only ever
 * reads the caller's own portfolio (never moves funds), so a much longer
 * replay window is an acceptable trade for far fewer prompts: cached
 * 23h in-memory AND in SecureStore (survives app restarts), matched by the
 * worker's 24h signature-age acceptance. Re-prompts roughly once a day
 * instead of every few minutes.
 */
import * as SecureStore from 'expo-secure-store';
import { signBytesWithMwa } from '@/hooks/useMobileWallet';
import { fetchWithTimeout } from './fetchWithTimeout';
import { parsePortfolioResponseData } from './xmtp';
import type { ParsedPortfolioResponse } from './xmtp';

const ACTIONS_BASE = 'https://onlymonkes-actions.jumpstreet25.workers.dev';
const AUTH_CACHE_WINDOW_MS = 23 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const SECURE_STORE_KEY = 'portfolio_http_auth';

interface PortfolioAuth { wallet: string; ts: number; signature: string }

let cachedAuth: PortfolioAuth | null = null;

function isFresh(auth: PortfolioAuth, walletAddress: string): boolean {
  return auth.wallet === walletAddress && Date.now() - auth.ts < AUTH_CACHE_WINDOW_MS;
}

async function getPortfolioAuth(walletAddress: string): Promise<PortfolioAuth> {
  if (cachedAuth && isFresh(cachedAuth, walletAddress)) return cachedAuth;

  try {
    const stored = await SecureStore.getItemAsync(SECURE_STORE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as PortfolioAuth;
      if (isFresh(parsed, walletAddress)) {
        cachedAuth = parsed;
        return parsed;
      }
    }
  } catch { /* corrupt/missing entry — fall through to a fresh signature */ }

  const ts = Date.now();
  const message = new TextEncoder().encode(`OnlyMonkes Portfolio\nfetch\n${walletAddress}\n${ts}`);
  const sigBytes = await signBytesWithMwa(walletAddress, message);
  const signature = Buffer.from(sigBytes).toString('base64');
  const auth: PortfolioAuth = { wallet: walletAddress, ts, signature };
  cachedAuth = auth;
  SecureStore.setItemAsync(SECURE_STORE_KEY, JSON.stringify(auth)).catch(() => {});
  return auth;
}

/** Drop the cached signature — call on wallet disconnect/switch. */
export function clearPortfolioAuthCache(): void {
  cachedAuth = null;
  SecureStore.deleteItemAsync(SECURE_STORE_KEY).catch(() => {});
}

export async function fetchPortfolioViaHttp(walletAddress: string): Promise<ParsedPortfolioResponse | null> {
  try {
    const { ts, signature } = await getPortfolioAuth(walletAddress);
    const url = `${ACTIONS_BASE}/api/portfolio?wallet=${encodeURIComponent(walletAddress)}&ts=${ts}&signature=${encodeURIComponent(signature)}`;
    const res = await fetchWithTimeout(url, { timeoutMs: FETCH_TIMEOUT_MS });
    if (!res.ok) return null;
    const data = await res.json();
    return parsePortfolioResponseData(data);
  } catch {
    return null;
  }
}
