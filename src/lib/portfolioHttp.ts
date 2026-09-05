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
 * (signBytesWithMwa — same MWA prompt used elsewhere in the app) and caches
 * the signature for AUTH_CACHE_WINDOW_MS so repeated /portfolio taps in the
 * same sitting don't re-prompt every time. The worker accepts a signature
 * up to 10 minutes old; cached for 9 to stay clear of that edge.
 */
import { signBytesWithMwa } from '@/hooks/useMobileWallet';
import { fetchWithTimeout } from './fetchWithTimeout';
import { parsePortfolioResponseData } from './xmtp';
import type { ParsedPortfolioResponse } from './xmtp';

const ACTIONS_BASE = 'https://onlymonkes-actions.jumpstreet25.workers.dev';
const AUTH_CACHE_WINDOW_MS = 9 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

let cachedAuth: { wallet: string; ts: number; signature: string } | null = null;

async function getPortfolioAuth(walletAddress: string): Promise<{ ts: number; signature: string }> {
  if (cachedAuth && cachedAuth.wallet === walletAddress && Date.now() - cachedAuth.ts < AUTH_CACHE_WINDOW_MS) {
    return cachedAuth;
  }
  const ts = Date.now();
  const message = new TextEncoder().encode(`OnlyMonkes Portfolio\nfetch\n${walletAddress}\n${ts}`);
  const sigBytes = await signBytesWithMwa(walletAddress, message);
  const signature = Buffer.from(sigBytes).toString('base64');
  cachedAuth = { wallet: walletAddress, ts, signature };
  return cachedAuth;
}

/** Drop the cached signature — call on wallet disconnect/switch. */
export function clearPortfolioAuthCache(): void {
  cachedAuth = null;
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
