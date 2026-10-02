import React, { Suspense } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { THEME } from '../src/lib/constants';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

const MonkeMemeScreen = React.lazy(() => import('../src/screens/MonkeMemeScreen'));

const Loading = () => (
  <View style={{ flex: 1, backgroundColor: THEME.bg, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator size="large" color={THEME.accent} />
  </View>
);

export default function MonkeMemeRoute() {
  return (
    <ErrorBoundary fallbackMessage="MonkeMeme hit an error. Go back and try again.">
      <Suspense fallback={<Loading />}>
        <MonkeMemeScreen />
      </Suspense>
    </ErrorBoundary>
  );
}
