/**
 * Avatar Room route — lazy-loaded to avoid pulling LiveKit into initial bundle
 */

import React, { Suspense, useEffect } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAppStore } from "@/store/appStore";
import { THEME } from "@/lib/constants";

const AvatarRoomScreen = React.lazy(() => import("@/screens/AvatarRoomScreen"));

export default function AvatarRoomRoute() {
  const { token, isHost } = useLocalSearchParams<{ token: string; isHost?: string }>();
  const activeAvatarRoom = useAppStore(s => s.activeAvatarRoom);

  useEffect(() => {
    if (!activeAvatarRoom || !token) {
      router.back();
    }
  }, []);

  if (!activeAvatarRoom || !token) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={THEME.accent} />
      </View>
    );
  }

  return (
    <Suspense
      fallback={
        <View style={styles.center}>
          <ActivityIndicator size="large" color={THEME.accent} />
        </View>
      }
    >
      <AvatarRoomScreen />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: "#0D0518", alignItems: "center", justifyContent: "center" },
});
