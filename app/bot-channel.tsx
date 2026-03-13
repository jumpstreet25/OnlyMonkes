import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { useAppStore } from "../src/store/appStore";
import BotChannelScreen from "../src/screens/BotChannelScreen";

export default function BotChannelRoute() {
  const router = useRouter();
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const { verified, wallet } = useAppStore();

  useEffect(() => {
    if (!wallet) router.replace("/");
    else if (!verified) router.replace("/verify");
  }, [verified, wallet]);

  const validIds = ["bets", "trades", "sales", "predictions"] as const;
  if (!wallet || !verified || !channelId || !validIds.includes(channelId as any)) return null;

  return <BotChannelScreen channelId={channelId as "bets" | "trades" | "sales" | "predictions"} />;
}
