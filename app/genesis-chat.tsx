import React, { Suspense, useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAppStore } from "../src/store/appStore";
import { THEME } from "../src/lib/constants";

const GenesisChatScreen = React.lazy(() => import("../src/screens/GenesisChatScreen"));

const Loading = () => (
  <View style={{ flex: 1, backgroundColor: THEME.bg, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator size="large" color={THEME.accent} />
  </View>
);

export default function GenesisChatRoute() {
  const router = useRouter();
  const { wallet, verified, isGenesisHolder } = useAppStore();

  useEffect(() => {
    if (!wallet) { router.replace("/"); return; }
    if (!verified && !isGenesisHolder) { router.replace("/verify"); return; }
    // Monke-only (not a Genesis holder) has no reason to be here — send them home.
    if (verified && !isGenesisHolder) router.replace("/chat");
  }, [wallet, verified, isGenesisHolder]);

  if (!wallet || !isGenesisHolder) return null;

  return (
    <Suspense fallback={<Loading />}>
      <GenesisChatScreen />
    </Suspense>
  );
}
