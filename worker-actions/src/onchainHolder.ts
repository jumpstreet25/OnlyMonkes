/**
 * Last-resort Saga Monkes ownership check with no DAS indexer.
 * Public RPC only — used when Helius/QuickNode/Alchemy/holder-index all fail.
 * Same Bubblegum transfer layout as the app's onchainCnftVerify.ts, capped
 * so it fits a Worker request budget.
 */

const BUBBLEGUM = "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";
const SAGA_TREE = "2uH9TkmYkAKGrK7EPnd4Y7JVYswpQ2aED9deMn8QoYVy";
const DISC_TRANSFER = "a334c8e78c0345ba";
const DISC_MINT_V1 = "9912b22fc59e560f";
const DISC_BURN = "746e1d386bdb2a5d";
const DISC_COMPRESS = "52c1b075b01573fd";

const RPCS = [
  // publicnode often returns a clean empty signature list (not an error).
  // Official RPC first so we don't treat "no history" as inconclusive.
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
];

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58decode(str: string): Uint8Array {
  let num = 0n;
  for (const ch of str) {
    const idx = B58.indexOf(ch);
    if (idx < 0) throw new Error("bad b58");
    num = num * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num /= 256n;
  }
  for (const ch of str) {
    if (ch === "1") bytes.unshift(0);
    else break;
  }
  return new Uint8Array(bytes);
}

function discHex(dataB58: string): string | null {
  try {
    const b = b58decode(dataB58);
    if (b.length < 8) return null;
    return [...b.slice(0, 8)].map((x) => x.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let last: Error | null = null;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { result?: T; error?: { message?: string } };
      if (json.error) throw new Error(json.error.message ?? "rpc error");
      return json.result as T;
    } catch (err) {
      last = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw last ?? new Error("rpc failed");
}

type Sig = { signature: string; err: unknown };
type ParsedTx = {
  transaction?: {
    message?: {
      accountKeys?: Array<{ pubkey: string } | string>;
      instructions?: Array<{ programId?: string; accounts?: string[]; data?: string }>;
    };
  };
} | null;

function keyStr(k: { pubkey: string } | string): string {
  return typeof k === "string" ? k : k.pubkey;
}

export async function verifySagaOnChain(wallet: string): Promise<{
  verified: boolean;
  mint: string | null;
  inconclusive: boolean;
  error?: string;
}> {
  let before: string | undefined;
  try {
    for (let page = 0; page < 2; page++) {
      const opts: Record<string, unknown> = { limit: 25 };
      if (before) opts.before = before;
      const sigs = await rpc<Sig[]>("getSignaturesForAddress", [wallet, opts]);
      if (!sigs?.length) {
        // Empty page after the first means history is exhausted, not "no NFTs".
        return { verified: false, mint: null, inconclusive: page === 0 };
      }
      before = sigs[sigs.length - 1].signature;
      const wanted = sigs.filter((s) => !s.err).map((s) => s.signature);
      if (!wanted.length) continue;

      const batch = wanted.map((sig, i) => ({
        jsonrpc: "2.0",
        id: i,
        method: "getTransaction",
        params: [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
      }));
      let batchRes: Array<{ result?: ParsedTx }> | null = null;
      for (const url of RPCS) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(batch),
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          batchRes = await res.json() as Array<{ result?: ParsedTx }>;
          break;
        } catch { /* next rpc */ }
      }
      if (!batchRes) continue;

      for (const row of batchRes) {
        const tx = row?.result;
        const msg = tx?.transaction?.message;
        if (!msg?.instructions) continue;
        const keys = (msg.accountKeys ?? []).map(keyStr);
        if (!keys.includes(BUBBLEGUM)) continue;
        const ix = msg.instructions.find((i) => i.programId === BUBBLEGUM);
        if (!ix?.accounts || !ix.data) continue;
        const acc = ix.accounts;
        if (!acc.includes(SAGA_TREE)) continue;
        const d = discHex(ix.data);
        if (d === DISC_TRANSFER) {
          const newOwner = acc[3];
          const oldOwner = acc[1];
          if (newOwner === wallet) return { verified: true, mint: null, inconclusive: false };
          if (oldOwner === wallet) continue; // gave up this leaf; keep scanning
        }
        if (d === DISC_BURN && acc[1] === wallet) continue;
        if (d === DISC_COMPRESS && acc[1] === wallet) {
          return { verified: true, mint: acc[3] ?? null, inconclusive: false };
        }
        if (d === DISC_MINT_V1 && acc.includes(wallet)) {
          return { verified: true, mint: null, inconclusive: false };
        }
      }
    }
    return { verified: false, mint: null, inconclusive: true };
  } catch (err) {
    return {
      verified: false,
      mint: null,
      inconclusive: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
