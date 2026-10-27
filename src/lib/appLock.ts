/**
 * Fingerprint lock (3.1, opt-in). Wallet signing already sits behind the Seeker's Seed Vault
 * biometrics; this guards what the app shows without a signature — chats, DMs, bags, P&L —
 * when someone else picks the phone up. Off by default; turning it on needs one successful
 * unlock so a phone with no enrolled fingerprint/PIN can't lock itself out.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { create } from "zustand";

const KEY = "om_app_lock_v1";
/** Away at least this long → locked again on return. */
export const APP_LOCK_AFTER_MS = 5 * 60_000;

interface AppLockState {
  enabled: boolean;
  locked: boolean;
  loaded: boolean;
  setLocked: (locked: boolean) => void;
}

export const useAppLock = create<AppLockState>((set) => ({
  enabled: false,
  locked: false,
  loaded: false,
  setLocked: (locked) => set({ locked }),
}));

/** Read the setting once at startup; an enabled lock starts locked. */
export async function loadAppLock(): Promise<void> {
  let enabled = false;
  try { enabled = (await AsyncStorage.getItem(KEY)) === "1"; } catch { /* default off */ }
  useAppLock.setState({ enabled, locked: enabled, loaded: true });
}

export async function biometricsAvailable(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

export async function authenticate(prompt: string): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, disableDeviceFallback: false });
    return r.success;
  } catch {
    return false;
  }
}

/** Turning it on proves an unlock works first; turning it off needs an unlock too. */
export async function setAppLockEnabled(on: boolean, prompt: string): Promise<boolean> {
  if (on && !(await biometricsAvailable())) return false;
  if (!(await authenticate(prompt))) return false;
  try { await AsyncStorage.setItem(KEY, on ? "1" : "0"); } catch { /* memory value still applies */ }
  useAppLock.setState({ enabled: on, locked: false });
  return true;
}
