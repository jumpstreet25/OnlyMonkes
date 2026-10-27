/**
 * .skr names (3.1): a wallet's PRIMARY .skr domain — the one its owner chose — via Solana
 * Mobile's @solana-mobile/skr-domain. Only the primary name: anyone can send a .skr name to
 * any wallet, so a non-primary one proves nothing (Solana Mobile docs). Cached 24h (6h when
 * the wallet has none). The package only needs crypto.subtle.digest(SHA-256), polyfilled
 * here from @noble/hashes when the runtime lacks it — the rest of global crypto is untouched.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { sha256 } from "@noble/hashes/sha256";
import { HELIUS_RPC_URL } from "@/lib/constants";

const SK = "om_skr_v1:";
const TTL_MS = 24 * 3600_000;
const NONE_TTL_MS = 6 * 3600_000;
const mem = new Map<string, { name: string | null; at: number }>();
const inflight = new Map<string, Promise<string | null>>();

function ensureDigest(): void {
  const g = globalThis as unknown as { crypto?: { subtle?: { digest?: unknown } } & Record<string, unknown> };
  if (g.crypto?.subtle?.digest) return;
  const subtle = {
    async digest(alg: string | { name: string }, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer> {
      const name = (typeof alg === "string" ? alg : alg.name).toUpperCase();
      if (name !== "SHA-256") throw new Error(`digest ${name} unsupported`);
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      return sha256(bytes).slice().buffer;
    },
  };
  if (g.crypto) Object.defineProperty(g.crypto, "subtle", { value: subtle, configurable: true });
  else (g as Record<string, unknown>).crypto = { subtle };
}

async function lookup(wallet: string): Promise<string | null> {
  ensureDigest();
  const [{ getPrimarySkrDomain }, { address, createSolanaRpc }] = await Promise.all([
    import("@solana-mobile/skr-domain"),
    import("@solana/kit"),
  ]);
  const name = await getPrimarySkrDomain(createSolanaRpc(HELIUS_RPC_URL) as never, address(wallet));
  return name ? String(name) : null;
}

/** Primary .skr name for a wallet, or null. Never throws. */
export async function getSkrName(wallet: string): Promise<string | null> {
  const now = Date.now();
  const fresh = (e: { name: string | null; at: number }) => now - e.at < (e.name ? TTL_MS : NONE_TTL_MS);
  const m = mem.get(wallet);
  if (m && fresh(m)) return m.name;
  try {
    const raw = await AsyncStorage.getItem(SK + wallet);
    const e = raw ? (JSON.parse(raw) as { name: string | null; at: number }) : null;
    if (e && fresh(e)) { mem.set(wallet, e); return e.name; }
  } catch { /* look it up */ }
  let p = inflight.get(wallet);
  if (!p) {
    p = lookup(wallet).catch(() => null).finally(() => inflight.delete(wallet));
    inflight.set(wallet, p);
  }
  const name = await p;
  const e = { name, at: Date.now() };
  mem.set(wallet, e);
  AsyncStorage.setItem(SK + wallet, JSON.stringify(e)).catch(() => {});
  return name;
}

export function useSkrName(wallet: string | null | undefined): string | null {
  const [name, setName] = useState<string | null>(wallet ? mem.get(wallet)?.name ?? null : null);
  useEffect(() => {
    let live = true;
    if (wallet) getSkrName(wallet).then((n) => { if (live) setName(n); });
    else setName(null);
    return () => { live = false; };
  }, [wallet]);
  return name;
}
