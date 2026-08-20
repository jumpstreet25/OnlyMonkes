/**
 * PROFILE_SNAPSHOT / MY_INBOXES parsing — kept free of native XMTP imports
 * so restore logic is unit-testable without the RN SDK.
 */

export interface ParsedProfileSnapshot {
  wallet: string;
  bananaBalance?: number;
  shopOwned?: string[];
  pfpBindings?: Record<string, string[]>;
  username?: string;
  legendary?: boolean;
  badges?: string[];
  marketplaceHistory?: unknown[];
  updatedAt?: number;
}

export interface ParsedMyInboxes {
  wallet: string;
  inboxIds: string[];
}

/** True when this snapshot belongs to the wallet currently signed in. */
export function snapshotWalletAllowed(
  snapshotWallet: string,
  connectedWallet: string | null | undefined,
): boolean {
  if (!snapshotWallet) return false;
  if (!connectedWallet) return true;
  return snapshotWallet === connectedWallet;
}

/** Strip the bot's `MSG:<name>:` envelope so structured prefixes still parse. */
export function unwrapBotEnvelope(raw: string): string {
  if (typeof raw !== "string" || !raw.startsWith("MSG:")) return raw;
  const rest = raw.slice(4);
  const colon = rest.indexOf(":");
  return colon >= 0 ? rest.slice(colon + 1) : rest;
}

export function parseProfileSnapshot(raw: string): ParsedProfileSnapshot | null {
  const inner = unwrapBotEnvelope(raw);
  if (!inner.startsWith("PROFILE_SNAPSHOT:")) return null;
  const jsonStr = inner.slice("PROFILE_SNAPSHOT:".length);
  if (jsonStr.length > 200_000) return null;

  let data: any;
  try { data = JSON.parse(jsonStr); } catch { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (typeof data.wallet !== "string" || !data.wallet) return null;

  return {
    wallet: data.wallet,
    bananaBalance: typeof data.bb === "number" ? data.bb : undefined,
    shopOwned: Array.isArray(data.so) ? data.so.filter((s: unknown) => typeof s === "string") : undefined,
    pfpBindings: data.pb && typeof data.pb === "object" && !Array.isArray(data.pb) ? data.pb : undefined,
    username: typeof data.u === "string" ? data.u : undefined,
    legendary: data.lg === 1 || data.lg === true,
    badges: Array.isArray(data.bd) ? data.bd.filter((b: unknown) => typeof b === "string") : undefined,
    marketplaceHistory: Array.isArray(data.mh) ? data.mh : undefined,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : undefined,
  };
}

export function parseMyInboxes(raw: string): ParsedMyInboxes | null {
  const inner = unwrapBotEnvelope(raw);
  if (!inner.startsWith("MY_INBOXES:")) return null;
  const jsonStr = inner.slice("MY_INBOXES:".length);
  if (jsonStr.length > 20_000) return null;

  let data: any;
  try { data = JSON.parse(jsonStr); } catch { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (typeof data.wallet !== "string" || !data.wallet) return null;
  if (!Array.isArray(data.inboxIds)) return null;

  return {
    wallet: data.wallet,
    inboxIds: data.inboxIds.filter((id: unknown) => typeof id === "string"),
  };
}
