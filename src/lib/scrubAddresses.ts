// Solana addresses (wallets, mints) are 32–44 base58 chars. They reach Sentry
// through request URLs (MonkeLedger /wallet/<addr>) and log lines; CLAUDE.md
// keeps wallets out of Sentry, so every string is scrubbed before it's kept.
const SOLANA_ADDR = /(?<![0-9A-Za-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![0-9A-Za-z])/g;

export function scrubAddresses<T>(v: T, depth = 0): T {
  if (typeof v === 'string') return v.replace(SOLANA_ADDR, '<addr>') as T;
  if (depth > 6 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => scrubAddresses(x, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = scrubAddresses(x, depth + 1);
  return out as T;
}
