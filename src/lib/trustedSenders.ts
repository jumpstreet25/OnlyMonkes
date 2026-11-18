/**
 * Who may send which system message (audit 2026-11-04, app spoofing batch).
 * XMTP proves the real sender inbox (`senderInboxId`); payload fields like
 * a name, `from` or an inboxId inside the JSON are whatever the sender typed.
 */
import { BOT_INBOX_IDS, BOT_DISPLAY_NAME, TREASURY_BOT_INBOX_IDS, TREASURY_BOT_DISPLAY_NAME } from '@/lib/constants';

/** The main bot (AI Agent #9385) — the only sender of LOCATION_SYNC, BADGE_GRANT, POLL_* and bot styling. */
export function isBotSender(inboxId: string | null | undefined): boolean {
  return !!inboxId && BOT_INBOX_IDS.includes(inboxId);
}

function isAnyBotSender(inboxId: string): boolean {
  return BOT_INBOX_IDS.includes(inboxId) || TREASURY_BOT_INBOX_IDS.includes(inboxId);
}

export function isAdminSender(inboxId: string | null | undefined, adminInboxId: string | null | undefined): boolean {
  return !!inboxId && !!adminInboxId && inboxId === adminInboxId;
}

/** A display name only the bots may wear (case/space-insensitive). */
export function isReservedBotName(name: string | null | undefined): boolean {
  const n = (name ?? '').toLowerCase().replace(/\s+/g, '');
  if (!n) return false;
  return [BOT_DISPLAY_NAME, TREASURY_BOT_DISPLAY_NAME, 'AI Agent', 'MonkeBot', 'MonkeBrain', 'AutonoMonke']
    .some((r) => n.includes(r.toLowerCase().replace(/\s+/g, '')));
}

/** The name to show for a sender: a bot name worn by anyone but the bot gets marked. */
export function displayNameFor(senderInboxId: string, claimed: string): string {
  if (isAnyBotSender(senderInboxId) || !isReservedBotName(claimed)) return claimed;
  return `${claimed} (not the bot)`;
}

// Blinks: our own actions only. A third-party Blink shows as a plain link.
const BLINK_HOSTS = new Set(['onlymonkes.app', 'www.onlymonkes.app', 'onlymonkes-actions.jumpstreet25.workers.dev']);

export function isTrustedBlinkUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url.replace(/^solana-action:/, ''));
    return u.protocol === 'https:' && BLINK_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** The worker's tip claim link and nothing else. */
const TIPLINK_RE = /^https:\/\/onlymonkes\.app\/claim\?token=[A-Za-z0-9_-]{40,64}$/;
export function isTrustedTipLink(url: string): boolean {
  return TIPLINK_RE.test(url);
}

/** Attachments open only over https. */
export function safeAttachmentUrl(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** Wallet-bridge pages must never get a signature over OnlyMonkes' own sign-in/admin texts. */
export function isOnlyMonkesSigningText(text: string): boolean {
  return /onlymonkes/i.test(text);
}
