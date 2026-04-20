/**
 * EAS Update (OTA) — checks for and applies JS bundle updates
 * without requiring a full APK/dApp Store resubmission.
 *
 * Call `checkForOtaUpdate()` on app launch.
 * If an update is available, it downloads in the background and
 * applies on next cold start (or forces reload if critical).
 */
import * as Updates from 'expo-updates';
import { Alert } from 'react-native';

/** Check for OTA update on launch — downloads silently, prompts if ready */
export async function checkForOtaUpdate() {
  if (__DEV__) return; // skip in dev mode

  // Force clear stale OTA cache from old runtimeVersion on first v2.36 launch
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const cleared = await AsyncStorage.getItem('ota_cache_cleared_v3.1');
    if (!cleared) {
      await AsyncStorage.setItem('ota_cache_cleared_v3.1', '1');
      console.log('[OTA] First launch on 3.1 — reloading from embedded bundle');
      await Updates.reloadAsync();
      return;
    }
  } catch { /* continue normally */ }

  try {
    const update = await Updates.checkForUpdateAsync();
    if (!update.isAvailable) return;

    console.log('[OTA] Update available, downloading…');
    const result = await Updates.fetchUpdateAsync();

    if (result.isNew) {
      // Prompt user to restart for the update
      Alert.alert(
        'Update Available',
        'A new version of OnlyMonkes has been downloaded. Restart to apply?',
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Restart',
            onPress: async () => {
              await Updates.reloadAsync();
            },
          },
        ],
      );
    }
  } catch (err) {
    // Non-critical — app continues with current bundle
    console.log('[OTA] Update check failed:', err);
  }
}
