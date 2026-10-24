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
  return r;
}
