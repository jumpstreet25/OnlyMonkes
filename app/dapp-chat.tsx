import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { useAppStore } from "../src/store/appStore";
import DAppChatScreen from "../src/screens/DAppChatScreen";

export default function DAppChatRoute() {
  const router = useRouter();
  const { dappId } = useLocalSearchParams<{ dappId: string }>();
  const { verified, wallet } = useAppStore();

  useEffect(() => {
    if (!wallet) router.replace("/");
    else if (!verified) router.replace("/verify");
  }, [verified, wallet]);

  if (!wallet || !verified || !dappId) return null;

  return <DAppChatScreen dappId={dappId} />;
}
