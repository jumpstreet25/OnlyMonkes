/**
 * Deep links (2026-10-22). onlymonkes.app/open/<target> fires the app's own
 * `onlymonkes://` scheme; older links use `onlymonkes://chat`, `dm/<inboxId>`
 * and `channel/<id>`. A link that arrives before login (cold start) is held
 * and opened once the wallet + XMTP inbox are ready.
 */

const OPEN: Record<string, string> = {
  chat: '/chat',
  genesis: '/genesis-chat',
  'genesis-chat': '/genesis-chat',
  trades: '/bot-channel?channelId=trades',
  marketplace: '/marketplace',
  monkememe: '/monkememe',
  dms: '/dms',
  watchlist: '/watchlist',
  portfolio: '/portfolio',
  globe: '/globe',
  treasury: '/treasury',
  settings: '/settings',
  about: '/about',
};
const CHANNELS = new Set(['trades']);

/** The in-app route for a deep link, or null when it isn't one of ours. */
export function routeForLink(url: string): string | null {
  const m = url.match(/^(?:onlymonkes|exp\+onlymonkes|exp\+monkesonly):\/\/\/?(.*)$/i)
    ?? url.match(/^https:\/\/(?:www\.)?onlymonkes\.app\/(.*)$/i)
    ?? url.match(/^\/(.*)$/);
  if (!m) return null;
  const [rawPath, query = ''] = m[1].split('?');
  const path = rawPath.replace(/\/+$/, '').replace(/^open\//, '');
  if (path === 'bot-channel') {
    const id = new URLSearchParams(query).get('channelId');
    return id && CHANNELS.has(id) ? `/bot-channel?channelId=${id}` : null;
  }
  if (path.startsWith('channel/')) {
    const id = path.slice(8);
    return CHANNELS.has(id) ? `/bot-channel?channelId=${id}` : null;
  }
  if (/^dm\/[0-9a-f]{64}$/i.test(path)) return `/${path}`;
  // Invites: onlymonkes://invite/<code> (the /r/<code> page) or the link itself.
  const invite = path.match(/^(?:invite|r)\/([2-9a-hj-np-z]{6})$/i);
  if (invite) return `/invite?code=${invite[1].toUpperCase()}`;
  return OPEN[path] ?? null;
}

let pending: string | null = null;

export function holdLink(route: string): void {
  pending = route;
}

export function takeHeldLink(): string | null {
  const r = pending;
  pending = null;
  if (r?.startsWith('/invite?')) forgetWebInvite();
  return r;
}

/** The invite code in `?ref=<code>`, or null. */
export function inviteCodeFromSearch(search: string): string | null {
  const code = new URLSearchParams(search).get('ref')?.trim().toUpperCase();
  return code && /^[2-9A-HJ-NP-Z]{6}$/.test(code) ? code : null;
}

// Web: the /r/<code> page's "Use the web app" opens onlymonkes.app/?ref=<code>.
// Sign-in can reload the page (wallet pairing), so the code waits in
// localStorage for a day and opens once the holder reaches chat.
const WEB_INVITE_KEY = 'om:heldInvite';
const WEB_INVITE_TTL_MS = 24 * 60 * 60_000;

export function holdWebInvite(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  try {
    const fromUrl = inviteCodeFromSearch(window.location.search);
    if (fromUrl) {
      localStorage.setItem(WEB_INVITE_KEY, JSON.stringify({ ref: fromUrl, t: Date.now() }));
      const url = new URL(window.location.href);
      url.searchParams.delete('ref');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
    const held = JSON.parse(localStorage.getItem(WEB_INVITE_KEY) ?? 'null') as { ref?: string; t?: number } | null;
    const code = inviteCodeFromSearch(`ref=${held?.ref ?? ''}`);
    if (code && Date.now() - (held?.t ?? 0) < WEB_INVITE_TTL_MS) {
      pending = pending ?? `/invite?code=${code}`;
    } else if (held) {
      forgetWebInvite();
    }
  } catch { /* storage blocked: the invite still works from the menu */ }
}

function forgetWebInvite(): void {
  if (typeof document === 'undefined') return;
  try { localStorage.removeItem(WEB_INVITE_KEY); } catch { /* ignore */ }
}
