/**
 * Web build of src/lib/sentry.ts (Metro picks this file on web only; the
 * phone app keeps sentry.ts unchanged).
 *
 * @sentry/react-native pulls in @sentry/browser, replay, feedback, … — about a
 * fifth of the web entry bundle. Here it is loaded with import() once the page
 * is idle after first paint, so it leaves the entry bundle. Calls made before
 * it has loaded (setUser, breadcrumbs, captures) are queued and replayed.
 * Errors thrown before Sentry loads are not captured on the web; the phone
 * app is unaffected.
 */
import Constants from 'expo-constants';
import { SENTRY_DSN_ENV } from '@/lib/constants';

type SentryModule = typeof import('@sentry/react-native');

const SENTRY_DSN: string = SENTRY_DSN_ENV;

let _sentry: SentryModule | null = null;
let _loading: Promise<SentryModule | null> | null = null;
const _queue: Array<(s: SentryModule) => void> = [];

function run(fn: (s: SentryModule) => void) {
  if (!SENTRY_DSN) return;
  if (_sentry) { fn(_sentry); return; }
  if (_queue.length < 100) _queue.push(fn);
}

function whenIdle(cb: () => void) {
  const ric = (globalThis as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => number) | undefined;
  if (ric) ric(cb, { timeout: 4000 });
  else setTimeout(cb, 2000);
}

function load(): Promise<SentryModule | null> {
  if (!_loading) {
    _loading = import('@sentry/react-native')
      .then((S) => {
        const appVersion = Constants.expoConfig?.version ?? '0.0.0';
        const buildNumber = Constants.expoConfig?.android?.versionCode?.toString() ?? '0';
        S.init({
          dsn: SENTRY_DSN,
          release: `com.onlymonkes.app@${appVersion}+${buildNumber}`,
          dist: buildNumber,
          tracesSampleRate: 0,
          environment: __DEV__ ? 'development' : 'production',
          enabled: !__DEV__,
          ignoreErrors: [/Object captured as exception with keys: _bubbles/],
          beforeSend(event) {
            if (event.breadcrumbs) {
              event.breadcrumbs = event.breadcrumbs.map((b) => {
                if (b.data && typeof b.data === 'object') {
                  const d = { ...b.data };
                  delete d.authToken;
                  delete d.mwaAuthToken;
                  delete d.privateKey;
                  return { ...b, data: d };
                }
                return b;
              });
            }
            return event;
          },
        });
        _sentry = S;
        _queue.splice(0).forEach((fn) => { try { fn(S); } catch { /* ignore */ } });
        return S;
      })
      .catch((e) => { console.warn('[Sentry] failed to load:', (e as Error)?.message); return null; });
  }
  return _loading;
}

export function initSentry() {
  if (!SENTRY_DSN) {
    console.log('[Sentry] No DSN configured — crash reporting disabled');
    return;
  }
  // After first paint, when the browser is idle.
  whenIdle(() => { void load(); });
}

export function identifySentryUser(inboxId: string, username?: string) {
  run((S) => S.setUser({ id: inboxId, username: username ?? undefined }));
}

export function addBreadcrumb(category: string, message: string, data?: Record<string, unknown>) {
  run((S) => S.addBreadcrumb({ category, message, data, level: 'info' }));
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  run((S) => {
    if (context) {
      S.withScope((scope) => { scope.setExtras(context); S.captureException(error); });
    } else {
      S.captureException(error);
    }
  });
}

/** The subset of the Sentry API the app calls directly (useXmtp.ts). */
export const Sentry = {
  captureMessage: (...args: Parameters<SentryModule['captureMessage']>) => { run((S) => { S.captureMessage(...args); }); },
  captureException: (...args: Parameters<SentryModule['captureException']>) => { run((S) => { S.captureException(...args); }); },
  setUser: (...args: Parameters<SentryModule['setUser']>) => { run((S) => S.setUser(...args)); },
  addBreadcrumb: (...args: Parameters<SentryModule['addBreadcrumb']>) => { run((S) => S.addBreadcrumb(...args)); },
};
