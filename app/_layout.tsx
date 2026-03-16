import '../global';
import 'react-native-get-random-values';
import { registerGlobals as registerLiveKitGlobals } from '@livekit/react-native';
import '../src/lib/backgroundSync'; // registers the TaskManager task definition at module level
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { COLORS } from '../src/lib/constants';
import { registerBackgroundSync } from '../src/lib/backgroundSync';
import { registerForPushNotifications } from '../src/lib/notifications';
import { triggerProfileRebroadcast } from '../src/hooks/useXmtp';
import { useAppStore, loadPersistedPrefs } from '../src/store/appStore';
import { clearLegacyKeys, startNftOwnershipGuard } from '../src/lib/session';
import { initSentry } from '../src/lib/sentry';
import { checkForOtaUpdate } from '../src/lib/otaUpdates';
import { logAppOpen, logDailySession } from '../src/lib/analytics';

// Register LiveKit WebRTC globals (must be called before any LiveKit usage)
registerLiveKitGlobals();

// Initialize Sentry crash reporting (no-op if SENTRY_DSN not set)
initSentry();

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
    registerBackgroundSync();
    logAppOpen().catch(() => {});
    const streak = useAppStore.getState().loginStreak;
    logDailySession(streak).catch(() => {});
    checkForOtaUpdate(); // OTA update check (no-op in dev)
    clearLegacyKeys(); // remove stale Matrica keys from old installs
    loadPersistedPrefs(); // restore muted sports, muted channels, notification prefs

    // Re-check NFT ownership every 24h; force logout if user no longer holds one
    startNftOwnershipGuard(() => {
      useAppStore.getState().reset();
    });

    // Request notification permissions and get Expo push token on every launch.
    // After obtaining the token, re-broadcast our XMTP profile so the bot relay
    // always has a fresh valid ExponentPushToken (fixes first-launch race condition).
    registerForPushNotifications().then(async token => {
      if (token) {
        useAppStore.getState().setExpoPushToken(token);
        // If XMTP is already initialized (common on second+ launch), push the token
        // to the group immediately so the relay bot picks it up right away.
        await triggerProfileRebroadcast(token);
      }
    }).catch(err => console.warn('[Layout] Push token error:', err));
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: COLORS.background },
              animation: 'slide_from_right',
            }}
          />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
