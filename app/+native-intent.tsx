import { routeForLink, holdLink } from '../src/lib/deepLinks';
import { useAppStore } from '../src/store/appStore';

/** Every incoming URL passes through here before expo-router matches it.
 *  Ours go to their screen when logged in; otherwise they wait on the
 *  connect screen and _layout opens them after login. Anything else
 *  (wallet / OAuth callbacks) passes through unchanged. */
// decode-uri-component (expo-router → query-string) takes quadratic time on long
// malformed %-runs: ~224 KB freezes the JS thread ~20 s, and no CJS fix exists.
// Real links (ours, wallet callbacks) are a few KB at most.
const MAX_LINK_CHARS = 16_384;

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (typeof path !== 'string' || path.length > MAX_LINK_CHARS) return '/';
  try {
    const route = routeForLink(path);
    if (!route) return path;
    const { wallet, myInboxId } = useAppStore.getState();
    if (wallet && myInboxId) return route;
    holdLink(route);
    return '/';
  } catch {
    return path;
  }
}
