import React, { Suspense, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppStore } from '../src/store/appStore';
import { THEME } from '../src/lib/constants';

const ChatScreen = React.lazy(() => import('../src/screens/ChatScreen'));

const Loading = () => (
  <View style={{ flex: 1, backgroundColor: THEME.bg, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator size="large" color={THEME.accent} />
  </View>
);

export default function ChatRoute() {
  const router = useRouter();
  const { verified, wallet } = useAppStore();

  useEffect(() => {
    if (!wallet) {
      router.replace('/');
    } else if (!verified) {
      router.replace('/verify');
    }
  }, [verified, wallet]);

  if (!wallet || !verified) return null;

  return (
    <Suspense fallback={<Loading />}>
      <ChatScreen />
    </Suspense>
  );
}
