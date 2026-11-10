/**
 * Sentry crash reporting & performance monitoring.
 *
 * Initialized once in app/_layout.tsx.
 * Captures unhandled exceptions, ANRs, and slow transactions automatically.
 */
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { SENTRY_DSN_ENV } from '@/lib/constants';

import { scrubAddresses } from '@/lib/scrubAddresses';

const SECRET_KEYS = ['authToken', 'mwaAuthToken', 'privateKey'];

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
    // 2026-08-13: re-enabled after ~3mo disabled (2026-05-23 v2.38 flash
    // diagnostic never reverted). tracesSampleRate held at 0 — the native
    // frame tracker + auto-perf tracing was the original flash suspect;
    // ramp this back up only after confirming the flash doesn't return.
    tracesSampleRate: 0,
    environment: __DEV__ ? 'development' : 'production',
    enabled: !__DEV__, // disabled in dev builds
    // A raw WebSocket/DOM error Event rejected inside LiveKit's own reconnect
    // (after the screen turns off) carries no message or stack — Sentry
    // ONLYMONKES-10, "Object captured as exception with keys: _bubbles, …".
    // The room recovers by itself; nothing to act on.
    ignoreErrors: [/Object captured as exception with keys: _bubbles/],
    // Breadcrumbs are cleaned when they're recorded, so native crash reports
    // (which never pass through beforeSend) get the clean copy too.
    beforeBreadcrumb(b) {
      const data = b.data && typeof b.data === 'object' ? { ...b.data } : b.data;
      if (data && typeof data === 'object') for (const k of SECRET_KEYS) delete (data as Record<string, unknown>)[k];
      return { ...b, message: scrubAddresses(b.message), data: scrubAddresses(data) };
    },
    beforeSend(event) {
      return {
        ...event,
        message: scrubAddresses(event.message),
        breadcrumbs: scrubAddresses(event.breadcrumbs),
        extra: scrubAddresses(event.extra),
        request: scrubAddresses(event.request),
        exception: event.exception && {
          ...event.exception,
          values: event.exception.values?.map((e) => ({ ...e, value: scrubAddresses(e.value) })),
        },
      };
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
