import '../global';
import 'react-native-get-random-values';
import '../src/lib/backgroundSync'; // registers the TaskManager task definition at module level
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner-native';
import { BananaBetPopup } from '../src/components/BananaBetPopup';
import { BananaBetResultPopup } from '../src/components/BananaBetResultPopup';
import { PollPopup } from '../src/components/PollPopup';
import { PollResultPopup } from '../src/components/PollResultPopup';
import { THEME } from '../src/lib/constants';
import { useThemeColor } from '../src/lib/shopTheme';
import { registerForPushNotifications } from '../src/lib/notifications';
import { triggerProfileRebroadcast } from '../src/hooks/useXmtp';
import { useAppStore, loadPersistedPrefs } from '../src/store/appStore';
import { getEquippedStyles } from '../src/lib/bananaShop';
import { applyThemeFromShop } from '../src/lib/shopTheme';
import { clearLegacyKeys, startNftOwnershipGuard } from '../src/lib/session';
import { initSentry } from '../src/lib/sentry';
import { clearStaleOtaCacheIfNeeded } from '../src/lib/otaUpdates';
import { OtaUpdateIndicator } from '../src/components/OtaUpdateIndicator';
import { logAppOpen, logDailySession } from '../src/lib/analytics';
import { loadBadgeData, setOnBadgeEarned, getBadgeBananaReward, type BadgeDef } from '../src/lib/badges';
import { addBananas } from '../src/lib/bananaRewards';
import { Alert, Linking } from 'react-native';
import { router } from 'expo-router';
import { useFreeRasp } from 'freerasp-react-native';
import { useFonts } from 'expo-font';
import { RASP_CONFIG, THREAT_ACTIONS } from '../src/lib/security';

// Initialize Sentry crash reporting (no-op if SENTRY_DSN not set)
initSentry();

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function RootLayout() {
  useFreeRasp(RASP_CONFIG, THREAT_ACTIONS);

  // (v35 2026-05-09) Load Fredoka-Bold for Banana Grove carved text via
  // expo-font. RN <Text> automatically falls back to system emoji font
  // for glyphs missing from Fredoka, so emojis render correctly without
  // needing the Skia text rendering path.
  useFonts({
    'Fredoka-Bold': require('../assets/fonts/Fredoka-Bold.ttf'),
  });

  useEffect(() => {
    // Load shop styles BEFORE hiding splash — prevents flash from standard to premium bubbles
    const shopReady = getEquippedStyles().then(s => {
      useAppStore.getState().setShopStyles(s);
      applyThemeFromShop(s);
    }).catch(() => {});

    // Hide splash once shop styles are loaded (or 500ms timeout, whichever is first)
    Promise.race([shopReady, new Promise(r => setTimeout(r, 500))]).then(() => {
      SplashScreen.hideAsync();
    });

    logAppOpen().catch(() => {});
    const streak = useAppStore.getState().loginStreak;
    logDailySession(streak).catch(() => {});
    clearStaleOtaCacheIfNeeded();
    clearLegacyKeys();
    loadPersistedPrefs();

    // Proactive AsyncStorage rescue: if the profile cache is over 4MB on
    // boot, trim it before any write blows up with SQLITE_FULL. Cheap no-op
    // when the cache is small. Native APK can raise the 6MB SQLite cap via
    // gradle.properties (queued separately).
    import('../src/lib/storageRescue').then(m =>
      m.maybeProactiveShrink().catch(() => {}),
    ).catch(() => {});

    import('../src/store/tradesStore').then(m => m.useTradesStore.getState().hydrate());
    import('../src/lib/positions').then(m => m.loadOpenPositions());

    // One-time wallet-keyed grants (Rugdoctor, future OG drops). Runs in
    // parallel with the dev-restore subscription below; grants.ts gates per-
    // device with an AsyncStorage flag so it only fires once. Listed wallets
    // live in src/lib/grants.ts.
    const unsubGrants = useAppStore.subscribe((state) => {
      const addr = state.wallet?.address;
      if (!addr) return;
      unsubGrants();
      import('../src/lib/grants')
        .then((m) => m.applyGrantIfEligible(addr))
        .then((res) => {
          if (res.applied && res.label) {
            Alert.alert('Account Granted', res.label);
          }
        })
        .catch(() => { /* silent — grant failures don't block boot */ });
    });

    // One-time dev account restore (after keystore loss 2026-04-19)
    // Runs when wallet becomes available (not at init — wallet is null at startup)
    const unsubRestore = useAppStore.subscribe((state) => {
      const addr = state.wallet?.address;
      if (!addr) return; // wallet not set yet
      unsubRestore(); // only run once
      if (addr !== '7tLrnPvgcR5mLtyUcVwvmhAD1wXbAKgWcLBPWxpwyZ1J') return;
      (async () => {
        try {
          const restored = await AsyncStorage.getItem('dev_restore_v1');
          if (restored) return;
          const { loadBananaState, saveBananaState } = await import('../src/lib/bananaRewards');
          const { loadShopState, saveShopState } = await import('../src/lib/bananaShop');
          const { applyThemeFromShop: applyTheme } = await import('../src/lib/shopTheme');
          const bs = await loadBananaState();
          bs.balance = 600;
          bs.totalEarned = Math.max(bs.totalEarned, 600);
          await saveBananaState(bs);
          useAppStore.getState().setBananaBalance(600);
          const ss = await loadShopState();
          ss.owned = ['theme_pfp_full', 'theme_matrix', 'bubble_neon_green'];
          ss.equipped = { bubble: 'bubble_neon_green', text: null, pfp: null, theme: 'theme_matrix', world: null };
          await saveShopState(ss);
          const styles = await getEquippedStyles();
          useAppStore.getState().setShopStyles(styles);
          applyTheme(styles);
          await AsyncStorage.setItem('dev_restore_v1', '1');
          Alert.alert('Account Restored', '600 bananas + PFP Full Theme + Matrix Green + Neon Green Glow');
        } catch (e: any) {
          Alert.alert('Restore Failed', e?.message ?? 'Unknown error');
        }
      })();
    });

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

    // Deep link handler — onlymonkes://chat, onlymonkes://dm/<inboxId>, etc.
    // Guard: only navigate if user is authenticated (has wallet + XMTP client)
    const handleDeepLink = ({ url }: { url: string }) => {
      try {
        const { wallet, myInboxId } = useAppStore.getState();
        if (!wallet || !myInboxId) return; // Not authenticated yet — ignore deep link
        const path = url.replace(/^onlymonkes:\/\//, "").replace(/^exp\+onlymonkes:\/\//, "");
        if (!path) return;
        if (path === "chat") router.push("/chat" as any);
        else if (path === "dms") router.push("/dms" as any);
        else if (path.startsWith("dm/")) router.push(`/dm/${path.slice(3)}` as any);
        else if (path === "globe") router.push("/globe" as any);
        else if (path === "marketplace") router.push("/marketplace" as any);
        else if (path.startsWith("channel/")) router.push(`/bot-channel?channelId=${path.slice(8)}` as any);
      } catch { /* ignore invalid deep links */ }
    };
    const sub = Linking.addEventListener("url", handleDeepLink);
    // Check if app was opened via deep link
    Linking.getInitialURL().then(url => { if (url) handleDeepLink({ url }); }).catch(() => {});
    return () => sub.remove();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: useThemeColor('bg') }}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: 'transparent' },
              animation: 'slide_from_right',
            }}
          />
          <Toaster
            position="top-center"
            toastOptions={{
              style: { backgroundColor: '#1A1A2E', borderColor: '#2A2A4A', borderWidth: 1 },
              titleStyle: { color: '#FFFFFF', fontFamily: 'System' },
              descriptionStyle: { color: '#8888AA' },
            }}
          />
          <BananaBetPopup />
          <BananaBetResultPopup />
          <PollPopup />
          <PollResultPopup />
          <OtaUpdateIndicator />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
