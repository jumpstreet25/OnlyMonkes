import React, { Suspense } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { THEME } from '../src/lib/constants';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

const VideoRoomScreen = React.lazy(() => import('../src/screens/VideoRoomScreen'));

const Loading = () => (
  <View style={{ flex: 1, backgroundColor: THEME.bg, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator size="large" color={THEME.accent} />
  </View>
);

export default function VideoRoomRoute() {
  return (
    <ErrorBoundary fallbackMessage="Video room hit an error. Go back and try again.">
      <Suspense fallback={<Loading />}>
        <VideoRoomScreen />
      </Suspense>
    </ErrorBoundary>
  );
}
