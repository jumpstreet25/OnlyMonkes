/**
 * adminConfig.ts — server-side write path for config/app-config.json.
 *
 * Replaces the old app-side flow where the admin's phone held a classic
 * (repo-scope) GitHub PAT in SecureStore and called the GitHub Contents API
 * directly. Now the phone signs a domain-separated message with its wallet;
 * this worker verifies that signature against the pinned ADMIN_WALLET_PUBKEY,
 * then performs the GitHub write itself using a worker-only secret
 * (ADMIN_GITHUB_PAT — should be a fine-grained PAT scoped to just this repo,
 * Contents: read/write, nothing else).
 */

import { verifyEd25519, base58ToBytes } from "./cryptoVerify";
import { CORS_HEADERS } from "./index";
import type { Env } from "./index";

const REPO = "jumpstreet25/OnlyMonkes";
const BRANCH = "master";
const FILE = "config/app-config.json";
const API = `https://api.github.com/repos/${REPO}/contents/${FILE}`;

const AUTH_MAX_AGE_MS = 5 * 60 * 1000;

interface AppRemoteConfig {
  globalGroupId: string;
  adminInboxId: string;
  botInboxId?: string;
  botChannels?: { trades?: string };
  genesisGroupId?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function verifyAdminAuth(
  wallet: string,
  ts: number,
  signatureB64: string,
  configJson: string,
  env: Env,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.ADMIN_WALLET_PUBKEY) return { ok: false, error: "Admin publish not configured" };
  if (wallet !== env.ADMIN_WALLET_PUBKEY) return { ok: false, error: "Not the admin wallet" };
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > AUTH_MAX_AGE_MS) {
    return { ok: false, error: "Signature expired — try again" };
  }

  let pubkeyBytes: Uint8Array;
  try {
    pubkeyBytes = base58ToBytes(wallet) ?? new Uint8Array();
    if (pubkeyBytes.length !== 32) throw new Error("bad key length");
  } catch {
    return { ok: false, error: "Invalid wallet address" };
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
  } catch {
    return { ok: false, error: "Invalid signature encoding" };
  }

  // configJson is bound into the signed message so a captured signature can't
  // be replayed to publish a different config within the freshness window.
  const message = new TextEncoder().encode(
    `OnlyMonkes Admin Publish\n${wallet}\n${ts}\n${configJson}`,
  );
  const sigOk = await verifyEd25519(pubkeyBytes, message, sigBytes);
  if (!sigOk) return { ok: false, error: "Signature verification failed" };

  return { ok: true };
}

export async function handlePublishAppConfig(request: Request, env: Env): Promise<Response> {
  let body: { config?: AppRemoteConfig; wallet?: string; ts?: number; signature?: string; force?: boolean };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { config, wallet, ts, signature, force } = body;
  if (!config || typeof config.globalGroupId !== "string" || typeof config.adminInboxId !== "string") {
    return jsonResponse({ ok: false, error: "Malformed config" }, 400);
  }
  if (typeof wallet !== "string" || typeof ts !== "number" || typeof signature !== "string") {
    return jsonResponse({ ok: false, error: "Missing wallet/ts/signature" }, 400);
  }

  const configJson = JSON.stringify(config, null, 2);
  const auth = await verifyAdminAuth(wallet, ts, signature, configJson, env);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, 401);

  if (!env.ADMIN_GITHUB_PAT) {
    return jsonResponse({ ok: false, error: "Worker missing ADMIN_GITHUB_PAT" }, 500);
  }

  try {
    // Safety guard mirrors the old app-side behavior: refuse to overwrite a
    // working config unless explicitly forced.
    if (!force) {
      const rawRes = await fetch(
        `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE}?t=${Date.now()}`,
      );
      if (rawRes.ok) {
        const existing = (await rawRes.json()) as Partial<AppRemoteConfig>;
        if (existing.globalGroupId && existing.botChannels?.trades) {
          return jsonResponse({
            ok: false,
            error: "Remote config already has valid group IDs — pass force:true to override.",
          }, 409);
        }
      }
    }

    const infoRes = await fetch(API, {
      headers: {
        Authorization: `token ${env.ADMIN_GITHUB_PAT}`,
        "User-Agent": "OnlyMonkes-Worker",
      },
    });
    if (!infoRes.ok) {
      return jsonResponse({ ok: false, error: `GitHub API error ${infoRes.status}` }, 502);
    }
    const info = (await infoRes.json()) as { sha?: string };
    if (!info.sha) {
      return jsonResponse({ ok: false, error: "GitHub API response missing SHA" }, 502);
    }

    const content = btoa(unescape(encodeURIComponent(configJson)));
    const putRes = await fetch(API, {
      method: "PUT",
      headers: {
        Authorization: `token ${env.ADMIN_GITHUB_PAT}`,
        "Content-Type": "application/json",
        "User-Agent": "OnlyMonkes-Worker",
      },
      body: JSON.stringify({
        message: "chore: update app config [skip ci]",
        content,
        sha: info.sha,
      }),
    });

    if (!putRes.ok) {
      const err = (await putRes.json().catch(() => ({}))) as { message?: string };
      return jsonResponse({ ok: false, error: err.message ?? `Publish failed: ${putRes.status}` }, 502);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: (err as Error).message ?? "Publish failed" }, 500);
  }
}
