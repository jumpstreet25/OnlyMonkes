import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import GroupDmScreen from '@/screens/GroupDmScreen';

export default function GroupDmRoute() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const { wallet, verified } = useAppStore();
  useEffect(() => {
    if (!wallet || !verified) router.replace('/');
  }, [wallet, verified]);
  if (!wallet || !verified || !groupId) return null;
  return <GroupDmScreen groupId={groupId} />;
}
