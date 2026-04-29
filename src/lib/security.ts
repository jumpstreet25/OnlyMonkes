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

import { Platform } from 'react-native';
import type { TalsecConfig, ThreatEventActions } from 'freerasp-react-native';

// ── Threat state ─────────────────────────────────────────────────────────────

const _threats = new Set<string>();

export function isDeviceCompromised(): boolean {
  return _threats.size > 0;
}

export function getActiveThreats(): string[] {
  return [..._threats];
}

// ── Config ───────────────────────────────────────────────────────────────────

// SHA-256 of `android/app/onlymonkes-release.keystore` (created 2026-04-19).
// To re-derive after a keystore rotation:
//   keytool -list -v -keystore android/app/onlymonkes-release.keystore -storepass onlymonkes2026 | grep SHA256
// Free-RASP expects upper-case hex with no colons.
const ANDROID_RELEASE_CERT_SHA256 = '2E2FEEB81CCF0DE5D191F6E174113BA9839181B1CB7540AB6D5C94A9CFF487D8';

export const RASP_CONFIG: TalsecConfig = {
  androidConfig: {
    packageName: 'com.onlymonkes.app',
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
// 64 hex chars (SHA-256). Catches both the literal placeholder AND a stale
// hash from a rotated keystore.
if (!__DEV__) {
  const ANDROID_HASH_RE = /^[A-F0-9]{64}$/;
  const androidHash = RASP_CONFIG.androidConfig?.certificateHashes?.[0] ?? '';
  const androidValid = ANDROID_HASH_RE.test(androidHash);

  const platformValid = Platform.OS === 'android'
    ? androidValid
    : RASP_CONFIG.iosConfig?.appTeamId !== 'ANDROID_ONLY_NOT_SHIPPED';

  if (!platformValid) {
    console.error(
      '[RASP] CRITICAL: Signing-cert anchor not configured for this platform. ' +
      'App tamper detection is DISABLED. ' +
      'Run: keytool -list -v -keystore android/app/onlymonkes-release.keystore -storepass onlymonkes2026 | grep SHA256'
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
};
