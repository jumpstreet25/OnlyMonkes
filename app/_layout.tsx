import '../global';
import 'react-native-get-random-values';
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
import { useAppStore } from '../src/store/appStore';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
    registerBackgroundSync();

    // Request notification permissions and get Expo push token on every launch
    registerForPushNotifications().then(token => {
      if (token) useAppStore.getState().setExpoPushToken(token);
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
