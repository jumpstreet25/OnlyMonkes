import React, { Suspense, useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAppStore } from "../src/store/appStore";
import { THEME } from "../src/lib/constants";

const DAppChatScreen = React.lazy(() => import("../src/screens/DAppChatScreen"));

const Loading = () => (
  <View style={{ flex: 1, backgroundColor: THEME.bg, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator size="large" color={THEME.accent} />
  </View>
);

export default function DAppChatRoute() {
  const router = useRouter();
  const { dappId } = useLocalSearchParams<{ dappId: string }>();
  const { verified, wallet } = useAppStore();

  useEffect(() => {
    if (!wallet) router.replace("/");
    else if (!verified) router.replace("/verify");
  }, [verified, wallet]);

  if (!wallet || !verified || !dappId) return null;

  return (
    <Suspense fallback={<Loading />}>
      <DAppChatScreen dappId={dappId} />
    </Suspense>
  );
}
