import React, { Suspense } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { THEME, FONTS } from '../src/lib/constants';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { ChatSkeleton } from '../src/components/SkeletonLoader';

const VideoRoomScreen = React.lazy(() => import('../src/screens/VideoRoomScreen'));

const Loading = () => (
  <View style={s.container}>
    <Text style={s.title}>Connecting to room…</Text>
    <ChatSkeleton count={3} />
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

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg, padding: 20, paddingTop: 60 },
  title: { fontFamily: FONTS.displayMed, fontSize: 16, color: THEME.textMuted, textAlign: "center", marginBottom: 20 },
});
