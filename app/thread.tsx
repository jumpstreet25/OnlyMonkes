import React, { Suspense } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { THEME } from '../src/lib/constants';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

const ThreadScreen = React.lazy(() => import('../src/screens/ThreadScreen'));

const Loading = () => (
  <View style={{ flex: 1, backgroundColor: THEME.bg, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator size="large" color={THEME.accent} />
  </View>
);

export default function ThreadRoute() {
  return (
    <ErrorBoundary fallbackMessage="Thread hit an error. Go back and try again.">
      <Suspense fallback={<Loading />}>
        <ThreadScreen />
      </Suspense>
    </ErrorBoundary>
  );
}
