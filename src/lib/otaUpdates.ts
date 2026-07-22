/**
 * EAS Update (OTA) — one-time migration guard, run on app launch.
 *
 * 2026-07-22: the actual per-launch check/download/reload cycle moved to
 * <OtaUpdateIndicator /> (root-mounted component using expo-updates'
 * useUpdates() hook) — that component owns checking, downloading, and
 * auto-reloading once ready, with a branded non-blocking progress toast
 * instead of the old Alert.alert("Restart?") flow. This file now only
 * keeps the runtimeVersion-migration cache-clear guard, which is a
 * one-time thing unrelated to normal update checking and doesn't belong
 * inside a component that re-runs its effects on every mount.
 */
import * as Updates from 'expo-updates';

/** Call once on app launch, before anything else touches the OTA cache. */
export async function clearStaleOtaCacheIfNeeded() {
  if (__DEV__) return; // skip in dev mode

  // Force clear stale OTA cache from old runtimeVersion on first v3.1 launch
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const cleared = await AsyncStorage.getItem('ota_cache_cleared_v3.1');
    if (!cleared) {
      await AsyncStorage.setItem('ota_cache_cleared_v3.1', '1');
      console.log('[OTA] First launch on 3.1 — reloading from embedded bundle');
      await Updates.reloadAsync();
    }
  } catch { /* continue normally */ }
}
