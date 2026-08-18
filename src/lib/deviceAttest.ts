/**
 * deviceAttest.ts — thin wrapper around the native DeviceAttest module
 * (android/app/src/main/java/com/onlymonkes/app/DeviceAttestModule.kt).
 *
 * This is Data Oracle Phase 1's honest substitute for TEEPIN attestation — no public
 * TEEPIN API exists for third-party apps as of this writing. Every sentiment batch is
 * signed with a non-exportable EC P-256 key generated in Android Keystore (StrongBox-backed
 * where the device supports it). See DeviceAttestModule.kt's doc comment for the full
 * reasoning.
 */

import { NativeModules, Platform } from "react-native";

interface DeviceAttestNativeModule {
  getOrCreatePublicKey(): Promise<string>;
  getAttestationCertChain(): Promise<string[]>;
  getKeyInfo(): Promise<{ insideSecureHardware: boolean; strongBoxBacked: boolean }>;
  sign(payloadBase64: string): Promise<string>;
}

const DeviceAttest: DeviceAttestNativeModule | undefined =
  Platform.OS === "android" ? (NativeModules.DeviceAttest as DeviceAttestNativeModule | undefined) : undefined;

export function isDeviceAttestAvailable(): boolean {
  return !!DeviceAttest;
}

/** SPKI DER public key, base64-encoded. Generates the device key on first call. */
export async function getDevicePublicKeyBase64(): Promise<string> {
  if (!DeviceAttest) throw new Error("DeviceAttest native module unavailable (Android only)");
  return DeviceAttest.getOrCreatePublicKey();
}

export async function getDeviceAttestationCertChain(): Promise<string[]> {
  if (!DeviceAttest) return [];
  return DeviceAttest.getAttestationCertChain();
}

/** Informational only — never a gate. Lets consent copy say "StrongBox-backed" honestly
 *  only on devices where that's actually true, instead of overclaiming everywhere. */
export async function getDeviceKeyInfo(): Promise<{ insideSecureHardware: boolean; strongBoxBacked: boolean }> {
  if (!DeviceAttest) return { insideSecureHardware: false, strongBoxBacked: false };
  try {
    return await DeviceAttest.getKeyInfo();
  } catch {
    return { insideSecureHardware: false, strongBoxBacked: false };
  }
}

/** Signs base64-encoded bytes with the device's hardware-backed Keystore key. Returns a
 *  base64 DER-encoded ECDSA signature (SHA256withECDSA). */
export async function signWithDeviceKey(payloadBase64: string): Promise<string> {
  if (!DeviceAttest) throw new Error("DeviceAttest native module unavailable (Android only)");
  return DeviceAttest.sign(payloadBase64);
}
