/**
 * Matrica OAuth helper
 *
 * Flow:
 *   1. Call startMatricaAuth() — opens matrica.io login page in the device browser.
 *   2. Matrica redirects to onlymonkes://matrica-callback?code=<code>
 *   3. ConnectScreen listens for that URL via Linking.addEventListener.
 *   4. Call handleMatricaCallback(url) — exchanges code for token + wallet address.
 *   5. Call saveMatricaSession() from session.ts — 7-day persistence.
 *
 * Setup (one-time, from Matrica developer portal):
 *   → Register your app at https://matrica.io/developers
 *   → Set redirect URI to: onlymonkes://matrica-callback
 *   → Replace MATRICA_CLIENT_ID below with your issued client_id.
 */

import { Linking } from "react-native";

// ─── Config — fill in from matrica.io/developers ─────────────────────────────
const MATRICA_CLIENT_ID   = "YOUR_MATRICA_CLIENT_ID";
const MATRICA_REDIRECT    = "onlymonkes://matrica-callback";
const MATRICA_AUTH_URL    = "https://matrica.io/oauth/authorize";
const MATRICA_TOKEN_URL   = "https://api.matrica.io/oauth/token";
const MATRICA_USER_URL    = "https://api.matrica.io/v1/users/me";
// ─────────────────────────────────────────────────────────────────────────────

/** Open Matrica login page in the system browser. */
export async function startMatricaAuth(): Promise<void> {
  const params = [
    `client_id=${encodeURIComponent(MATRICA_CLIENT_ID)}`,
    `redirect_uri=${encodeURIComponent(MATRICA_REDIRECT)}`,
    `response_type=code`,
    `scope=wallet`,
  ].join("&");

  await Linking.openURL(`${MATRICA_AUTH_URL}?${params}`);
}

/**
 * Parse the deep-link callback URL and exchange the auth code for a token.
 * Returns { accessToken, walletAddress } on success, throws on error.
 */
export async function handleMatricaCallback(
  url: string
): Promise<{ accessToken: string; walletAddress: string }> {
  const params = parseQuery(url);

  if (params.error) {
    throw new Error(`Matrica auth error: ${params.error_description ?? params.error}`);
  }

  const code = params.code;
  if (!code) throw new Error("No auth code in Matrica callback URL.");

  // Exchange code → access token
  const tokenRes = await fetch(MATRICA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id:    MATRICA_CLIENT_ID,
      redirect_uri: MATRICA_REDIRECT,
      code,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Token exchange failed: ${tokenRes.status}`);
  }

  const { access_token: accessToken } = await tokenRes.json();

  // Fetch wallet address linked to this Matrica account
  const userRes = await fetch(MATRICA_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!userRes.ok) {
    throw new Error(`Failed to fetch Matrica user: ${userRes.status}`);
  }

  const user = await userRes.json();
  const walletAddress: string =
    user.wallet_address ?? user.walletAddress ?? user.public_key ?? user.publicKey;

  if (!walletAddress) throw new Error("Matrica did not return a wallet address.");

  return { accessToken, walletAddress };
}

/** Returns true if the URL is a Matrica OAuth callback. */
export function isMatricaCallback(url: string): boolean {
  return url.startsWith("onlymonkes://matrica-callback");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseQuery(url: string): Record<string, string> {
  const query = url.split("?")[1] ?? "";
  return Object.fromEntries(
    query
      .split("&")
      .filter(Boolean)
      .map((pair) => {
        const idx = pair.indexOf("=");
        const key = decodeURIComponent(idx === -1 ? pair : pair.slice(0, idx));
        const val = decodeURIComponent(idx === -1 ? "" : pair.slice(idx + 1));
        return [key, val];
      })
  );
}
