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
import { THEME } from '../src/lib/constants';
import { registerForPushNotifications } from '../src/lib/notifications';
import { triggerProfileRebroadcast } from '../src/hooks/useXmtp';
import { useAppStore, loadPersistedPrefs } from '../src/store/appStore';
import { clearLegacyKeys, startNftOwnershipGuard } from '../src/lib/session';
import { initSentry } from '../src/lib/sentry';
import { checkForOtaUpdate } from '../src/lib/otaUpdates';
import { logAppOpen, logDailySession } from '../src/lib/analytics';
import { loadBadgeData, setOnBadgeEarned, getBadgeBananaReward, type BadgeDef } from '../src/lib/badges';
import { addBananas } from '../src/lib/bananaRewards';
import { Alert } from 'react-native';
import { useFreeRasp } from 'freerasp-react-native';
import { RASP_CONFIG, THREAT_ACTIONS } from '../src/lib/security';

// Register LiveKit WebRTC globals (must be called before any LiveKit usage)
registerLiveKitGlobals();

// Initialize Sentry crash reporting (no-op if SENTRY_DSN not set)
initSentry();

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function RootLayout() {
  useFreeRasp(RASP_CONFIG, THREAT_ACTIONS);

  useEffect(() => {
    SplashScreen.hideAsync();
    logAppOpen().catch(() => {});
    const streak = useAppStore.getState().loginStreak;
    logDailySession(streak).catch(() => {});
    checkForOtaUpdate(); // OTA update check (no-op in dev)
    clearLegacyKeys(); // remove stale Matrica keys from old installs
    loadPersistedPrefs(); // restore muted sports, muted channels, notification prefs

    // Load badge progress from storage + register badge-earned callback
    loadBadgeData().catch(() => {});
    setOnBadgeEarned(async (badge: BadgeDef) => {
      const reward = getBadgeBananaReward(badge.id);
      await addBananas(reward).catch(() => {});
      useAppStore.getState().setBananaBalance(
        (useAppStore.getState().bananaBalance ?? 0) + reward,
      );
      Alert.alert(
        `${badge.emoji} Badge Earned!`,
        `${badge.name} — ${badge.description}\n+${reward} bananas!`,
      );
    });

    // Re-check NFT ownership every 24h; force logout if user no longer holds one
    startNftOwnershipGuard(() => {
      useAppStore.getState().reset();
    });

    // Defer push notification registration — runs after 2s to avoid blocking startup.
    // XMTP init doesn't need the token; profile rebroadcast sends it when ready.
    setTimeout(() => {
      registerForPushNotifications().then(async token => {
        if (token) {
          useAppStore.getState().setExpoPushToken(token);
          await triggerProfileRebroadcast(token);
        }
      }).catch(err => console.warn('[Layout] Push token error:', err));
    }, 2000);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: THEME.bg },
              animation: 'slide_from_right',
            }}
          />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
