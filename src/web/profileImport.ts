/**
 * Bring the user's phone profile to the web app: the latest public profile
 * their own wallet-bound inbox broadcast in the OnlyMonkes app (actions worker
 * /api/profile/me → bot /web-profile). The web client has the same inbox ID as
 * the phone, so only that wallet's own broadcasts can come back.
 *
 * Saved exactly like a typed profile (userProfile.ts) and restored like
 * /reclaim (bananas, shop items, PFP bindings).
 */
import { useAppStore } from "@/store/appStore";
import { saveUserProfile } from "@/lib/userProfile";
import { applyProfileSnapshot } from "@/lib/reclaim";
import { getXmtpClient } from "@/hooks/useXmtp";
import { getXmtpCredential } from "./webAuth";

const WORKER = "https://onlymonkes-actions.jumpstreet25.workers.dev";
const INBOX_WAIT_MS = 60_000;

export type ImportedProfile = {
  username: string;
  bio: string;
  xAccount: string;
  tipWallet: string;
  location: string;
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function waitForInbox(): Promise<string | null> {
  const now = useAppStore.getState().myInboxId;
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { unsub(); resolve(null); }, INBOX_WAIT_MS);
    const unsub = useAppStore.subscribe((s) => {
      if (s.myInboxId) { clearTimeout(timer); unsub(); resolve(s.myInboxId); }
    });
  });
}

let _once: Promise<ImportedProfile | null> | null = null;

export function importPhoneProfile(): Promise<ImportedProfile | null> {
  if (_once) return _once;
  _once = (async () => {
    const inboxId = await waitForInbox();
    const wallet = useAppStore.getState().wallet?.address;
    if (!inboxId || !wallet) return null;
    const { value } = await getXmtpCredential();
    const res = await fetch(`${WORKER}/api/profile/me`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: value },
      // Same derived identity key the phone app uses; the bot finds the phone
      // inbox it belongs to, even when that inbox ID differs from this one.
      body: JSON.stringify({ inboxId, identifier: (getXmtpClient() as any)?.publicIdentity?.identifier?.toLowerCase?.() }),
    });
    if (!res.ok) return null;
    const p = ((await res.json()) as { profile?: Record<string, unknown> | null }).profile;
    const username = str(p?.u, 20);
    if (!p || !username) return null;
    const imported: ImportedProfile = {
      username,
      bio: str(p.b, 100),
      xAccount: str(p.x, 30),
      tipWallet: str(p.tw, 44),
      location: str(p.loc, 80),
    };
    await saveUserProfile(imported.username, imported.bio, imported.xAccount, imported.tipWallet, imported.location);
    await applyProfileSnapshot({
      wallet,
      username,
      bananaBalance: typeof p.bb === "number" && p.bb >= 0 ? p.bb : undefined,
      shopOwned: Array.isArray(p.so) ? p.so.filter((x): x is string => typeof x === "string") : undefined,
      pfpBindings: p.pb && typeof p.pb === "object" ? (p.pb as Record<string, string[]>) : undefined,
      legendary: p.lg === 1,
    }).catch(() => {});
    return imported;
  })().catch(() => null);
  // Don't remember a miss: the next chat screen mount tries again.
  void _once.then((r) => { if (!r) _once = null; });
  return _once;
}
