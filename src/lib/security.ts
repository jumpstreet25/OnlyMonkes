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

// To get the correct hash, run:
//   keytool -list -v -keystore android/app/onlymonkes-release.keystore | grep SHA256
// Then replace PLACEHOLDER_HASH with the hex string (no colons).
export const RASP_CONFIG: TalsecConfig = {
  androidConfig: {
    packageName: 'com.onlymonkes.app',
    certificateHashes: ['69DD4EC7FE2A906808D61F2470BB02AC1C62F9D52DBB40548A5175CC15ABB693'],
  },
  iosConfig: {
    appBundleId: 'com.onlymonkes.app',
    appTeamId: 'PLACEHOLDER',
  },
  watcherMail: 'security@onlymonkes.com',
  isProd: !__DEV__,
};

// Production guard: RASP is non-functional with placeholder values.
// Log a critical warning so it's visible in release builds.
if (!__DEV__) {
  const hasPlaceholder =
    RASP_CONFIG.androidConfig?.certificateHashes?.[0] === 'PLACEHOLDER_HASH' ||
    RASP_CONFIG.iosConfig?.appTeamId === 'PLACEHOLDER';
  if (hasPlaceholder) {
    console.error(
      '[RASP] CRITICAL: Certificate hash / team ID not configured. ' +
      'App tamper detection is DISABLED in this production build. ' +
      'Run: keytool -list -v -keystore android/app/onlymonkes-release.keystore | grep SHA256'
    );
    // Mark device as "compromised" so isDeviceCompromised() returns true,
    // blocking sensitive operations until RASP is properly configured.
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
