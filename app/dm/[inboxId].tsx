import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import DmScreen from '@/screens/DmScreen';

export default function DmRoute() {
  const { inboxId } = useLocalSearchParams<{ inboxId: string }>();
  const router = useRouter();
  const { wallet, verified } = useAppStore();
  useEffect(() => {
    if (!wallet || !verified) router.replace('/');
  }, [wallet, verified]);
  if (!wallet || !verified || !inboxId) return null;
  return <DmScreen peerInboxId={inboxId} />;
}
