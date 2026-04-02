/**
 * Sentry crash reporting & performance monitoring.
 *
 * Initialized once in app/_layout.tsx.
 * Captures unhandled exceptions, ANRs, and slow transactions automatically.
 */
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { SENTRY_DSN_ENV } from '@/lib/constants';

const SENTRY_DSN: string = SENTRY_DSN_ENV;

export function initSentry() {
  if (!SENTRY_DSN) {
    console.log('[Sentry] No DSN configured — crash reporting disabled');
    return;
  }

  const appVersion = Constants.expoConfig?.version ?? '0.0.0';
  const buildNumber = Constants.expoConfig?.android?.versionCode?.toString() ?? '0';

  Sentry.init({
    dsn: SENTRY_DSN,
    release: `com.onlymonkes.app@${appVersion}+${buildNumber}`,
    dist: buildNumber,
    tracesSampleRate: 0.2, // 20% of transactions for performance monitoring
    environment: __DEV__ ? 'development' : 'production',
    enabled: !__DEV__, // disabled in dev builds
    beforeSend(event) {
      // Strip any wallet private keys or auth tokens from breadcrumbs
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
}

/** Tag the current Sentry scope with user info (call after XMTP init) */
export function identifySentryUser(inboxId: string, username?: string) {
  Sentry.setUser({ id: inboxId, username: username ?? undefined });
}

/** Add context breadcrumb for debugging crash reports */
export function addBreadcrumb(category: string, message: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({ category, message, data, level: 'info' });
}

/** Manually capture a non-fatal error */
export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

export { Sentry };
