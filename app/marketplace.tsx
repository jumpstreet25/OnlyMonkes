import React, { Suspense, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppStore } from '../src/store/appStore';
import { THEME } from '../src/lib/constants';

const MarketplaceScreen = React.lazy(() => import('../src/screens/MarketplaceScreen'));

const Loading = () => (
  <View style={{ flex: 1, backgroundColor: THEME.bg, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator size="large" color={THEME.accent} />
  </View>
);

export default function MarketplaceRoute() {
  const router = useRouter();
  const { wallet, verified, isGuest } = useAppStore();

  useEffect(() => {
    // Allow access if verified holder OR guest with wallet
    if (!wallet) router.replace('/');
    else if (!verified && !isGuest) router.replace('/verify');
  }, [wallet, verified, isGuest]);

  if (!wallet || (!verified && !isGuest)) return null;

  return (
    <Suspense fallback={<Loading />}>
      <MarketplaceScreen />
    </Suspense>
  );
}
