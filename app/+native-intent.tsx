import { routeForLink, holdLink } from '../src/lib/deepLinks';
import { useAppStore } from '../src/store/appStore';

/** Every incoming URL passes through here before expo-router matches it.
 *  Ours go to their screen when logged in; otherwise they wait on the
 *  connect screen and _layout opens them after login. Anything else
 *  (wallet / OAuth callbacks) passes through unchanged. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
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
