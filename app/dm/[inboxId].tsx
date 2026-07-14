import React, { Suspense, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAppStore } from '@/store/appStore';
import { THEME } from '@/lib/constants';

const DmScreen = React.lazy(() => import('@/screens/DmScreen'));

const Loading = () => (
  <View style={{ flex: 1, backgroundColor: THEME.bg, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator size="large" color={THEME.accent} />
  </View>
);

export default function DmRoute() {
  const { inboxId } = useLocalSearchParams<{ inboxId: string }>();
  const router = useRouter();
  const { wallet, verified } = useAppStore();
  useEffect(() => {
    if (!wallet || !verified) router.replace('/');
  }, [wallet, verified]);
  if (!wallet || !verified || !inboxId) return null;
  return (
    <Suspense fallback={<Loading />}>
      <DmScreen peerInboxId={inboxId} />
    </Suspense>
  );
}
