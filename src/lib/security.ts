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

export const RASP_CONFIG: TalsecConfig = {
  androidConfig: {
    packageName: 'com.onlymonkes.app',
    certificateHashes: ['PLACEHOLDER_HASH'], // Replace with actual signing cert SHA-256
  },
  iosConfig: {
    appBundleId: 'com.onlymonkes.app',
    appTeamId: 'PLACEHOLDER', // Replace with Apple Team ID
  },
  watcherMail: 'security@onlymonkes.com',
  isProd: !__DEV__,
};

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
