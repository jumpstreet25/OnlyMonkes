import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAppStore } from '@/store/appStore';
import DmInboxScreen from '@/screens/DmInboxScreen';

export default function DmsRoute() {
  const router = useRouter();
  const { wallet, verified } = useAppStore();
  useEffect(() => {
    if (!wallet || !verified) router.replace('/');
  }, [wallet, verified]);
  if (!wallet || !verified) return null;
  return <DmInboxScreen />;
}
