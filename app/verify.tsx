import React, { Suspense } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { THEME } from '../src/lib/constants';

const VerifyScreen = React.lazy(() => import('../src/screens/VerifyScreen'));

const Loading = () => (
  <View style={{ flex: 1, backgroundColor: THEME.bg, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator size="large" color={THEME.accent} />
  </View>
);

export default function VerifyRoute() {
  return (
    <Suspense fallback={<Loading />}>
      <VerifyScreen />
    </Suspense>
  );
}
