import React, { Suspense } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { THEME } from '../src/lib/constants';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

const MarketplaceOnChainTestScreen = React.lazy(() => import('../src/screens/MarketplaceOnChainTestScreen'));

const Loading = () => (
  <View style={{ flex: 1, backgroundColor: THEME.bg, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator size="large" color={THEME.accent} />
  </View>
);

/** Dev-only devnet debug harness for the MonkeMarkets escrow program — see MarketplaceOnChainTestScreen.tsx. */
export default function MarketplaceOnChainTestRoute() {
  return (
    <ErrorBoundary fallbackMessage="On-chain test harness hit an error.">
      <Suspense fallback={<Loading />}>
        <MarketplaceOnChainTestScreen />
      </Suspense>
    </ErrorBoundary>
  );
}
