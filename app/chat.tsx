import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAppStore } from '../src/store/appStore';
import ChatScreen from '../src/screens/ChatScreen';

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

  return <ChatScreen />;
}
