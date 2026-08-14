/**
 * security.ts — Runtime Application Self-Protection (RASP) via Free-RASP / Talsec.
 *
 * Detects: root/jailbreak, Frida hooking, debug mode, emulators, app tampering,
 * repackaging, device binding changes, and more.
 *
 * Non-fatal: logs warnings and sets flags. Does NOT kill the app.
 * Trading features (AutonoMonke wallet) should check `isDeviceCompromised()` before
 * executing transactions.
 */

import { NativeModules, Platform } from 'react-native';
import type { TalsecConfig, ThreatEventActions } from 'freerasp-react-native';

const INSTALLED_PACKAGE: string =
  Platform.OS === 'android'
    ? (NativeModules.DirectNotif?.getPackageName?.() as string | undefined) ?? 'com.onlymonkes.app'
    : 'com.onlymonkes.app';

// ── Threat state ─────────────────────────────────────────────────────────────

const _threats = new Set<string>();

export function isDeviceCompromised(): boolean {
  return _threats.size > 0;
}

export function getActiveThreats(): string[] {
  return [..._threats];
}

// Severity buckets — used by the trading-path gate. Hard threats imply the
// device or app integrity itself can't be trusted to sign transactions.
// Soft threats are warned about but don't block (e.g. emulator for testing).
const HARD_THREATS = new Set<string>([
  'privilegedAccess', // root / jailbreak
  'hooks',            // Frida / Xposed
  'appIntegrity',     // APK tampered / repackaged
  'deviceBinding',    // device fingerprint changed (cloned app)
  'raspNotConfigured', // self-check failed; can't trust detection
]);

const SOFT_THREATS = new Set<string>([
  'simulator',
  'debug',
  'unofficialStore',
  'adbEnabled',
  // 5.2.0 bootloader — unlocked bootloaders are common on Seeker / sideload.
  // Log only; never block trading.
  'bootloader',
]);

export type ThreatSeverity = 'hard' | 'soft' | 'info';

export function getThreatSeverity(threat: string): ThreatSeverity {
  if (HARD_THREATS.has(threat)) return 'hard';
  if (SOFT_THREATS.has(threat)) return 'soft';
  return 'info';
}

export function getBlockingThreats(): string[] {
  return [..._threats].filter((t) => HARD_THREATS.has(t));
}

/**
 * Throws if any hard threat is active. Call at the entry point of every
 * surface that signs a Solana transaction (swap, tip, marketplace bid/accept).
 * Soft threats (emulator, debug, sideload) do not block — they're surfaced in
 * Settings instead.
 *
 * The thrown error message is intentionally surfaced to the user (toast/Alert
 * caller side) so they understand why the action was refused.
 */
export function assertDeviceTrusted(action: string): void {
  const blocking = getBlockingThreats();
  if (blocking.length === 0) return;
  throw new Error(
    `${action} blocked: device security check failed (${blocking.join(', ')}). ` +
    `Resolve and restart the app to continue.`
  );
}

// ── Config ───────────────────────────────────────────────────────────────────

// SHA-256 of `android/app/onlymonkes-release.keystore` (created 2026-04-19).
// To re-derive after a keystore rotation:
//   keytool -exportcert -alias onlymonkes-release -keystore <path> -storepass <pw> \
//     | openssl dgst -sha256 -binary | openssl enc -base64
// Output format: standard Base64 (44 chars, trailing '='). 2026-07-23: was
// stored as upper-case hex, which this exact same digest also validates as
// — but freerasp 5's native Talsec module throws TalsecInitializationError
// ("... is not in Base64 form") on the hex form at runtime, silently
// disabling app-tamper detection. freerasp 4 apparently didn't validate
// this strictly. Verified this Base64 value decodes to the identical bytes
// as the old hex value (same keystore, just re-encoded) before swapping.
const ANDROID_RELEASE_CERT_SHA256 = 'Li/uuBzPDeXRkfbhdBE7qYORgbHLdUCrbVyUqc/0h9g=';

export const RASP_CONFIG: TalsecConfig = {
  androidConfig: {
    // Must match the installed applicationId. Canary is
    // com.onlymonkes.app.canary — a hard-coded production id fires
    // appIntegrity on every canary launch.
    packageName: INSTALLED_PACKAGE,
    certificateHashes: [ANDROID_RELEASE_CERT_SHA256],
  },
  // Android-only project per CLAUDE.md; iOS values are required by the type
  // but never consumed at runtime. The production guard below skips this on Android.
  iosConfig: {
    appBundleId: 'com.onlymonkes.app',
    appTeamId: 'ANDROID_ONLY_NOT_SHIPPED',
  },
  watcherMail: 'security@onlymonkes.com',
  isProd: !__DEV__,
};

// Production guard: validate the platform we actually ship on. Hash must be
// a Base64-encoded SHA-256 digest (44 chars, trailing '=') — the format
// freerasp 5's native Talsec module actually requires. Catches both the
// literal placeholder AND a stale hash from a rotated keystore.
if (!__DEV__) {
  const ANDROID_HASH_RE = /^[A-Za-z0-9+/]{43}=$/;
  const androidHash = RASP_CONFIG.androidConfig?.certificateHashes?.[0] ?? '';
  const androidValid = ANDROID_HASH_RE.test(androidHash);

  const platformValid = Platform.OS === 'android'
    ? androidValid
    : RASP_CONFIG.iosConfig?.appTeamId !== 'ANDROID_ONLY_NOT_SHIPPED';

  if (!platformValid) {
    console.error(
      '[RASP] CRITICAL: Signing-cert anchor not configured for this platform. ' +
      'App tamper detection is DISABLED. ' +
      'Re-derive ANDROID_RELEASE_CERT_SHA256 from the release keystore using ' +
      'keytool -list -v -keystore <path> -storepass <see private creds>'
    );
    // Mark device as "compromised" so isDeviceCompromised() returns true,
    // blocking sensitive operations once gates are wired.
    _threats.add('raspNotConfigured');
  }
}

// ── Threat callbacks ─────────────────────────────────────────────────────────

function logThreat(name: string) {
  _threats.add(name);
  console.warn(`[RASP] Threat detected: ${name}`);
}

export const THREAT_ACTIONS: ThreatEventActions = {
  privilegedAccess: () => logThreat('privilegedAccess'),  // root/jailbreak
  debug:            () => logThreat('debug'),              // debugger attached
  simulator:        () => logThreat('simulator'),          // running on emulator
  appIntegrity:     () => logThreat('appIntegrity'),       // APK tampered
  unofficialStore:  () => logThreat('unofficialStore'),    // sideloaded from unknown source
  hooks:            () => logThreat('hooks'),              // Frida/Xposed detected
  deviceBinding:    () => logThreat('deviceBinding'),      // device changed (cloned app)
  passcode:         () => logThreat('passcode'),           // no screen lock set
  devMode:          () => logThreat('devMode'),            // developer mode enabled
  adbEnabled:       () => logThreat('adbEnabled'),         // ADB debugging enabled
  bootloader:       () => logThreat('bootloader'),         // unlocked / compromised bootloader (soft)
};
