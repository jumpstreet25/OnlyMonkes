/**
 * Live Audio Room route — lazy-loaded to avoid pulling LiveKit into initial bundle
 */

import React, { Suspense, useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAppStore } from "@/store/appStore";
import { THEME, FONTS } from "@/lib/constants";

const LiveAudioRoomScreen = React.lazy(() => import("@/screens/LiveAudioRoomScreen"));

export default function LiveRoomRoute() {
  const { token, isHost } = useLocalSearchParams<{ token: string; isHost?: string }>();
  const { activeLiveRoom } = useAppStore();

  useEffect(() => {
    if (!activeLiveRoom || !token) {
      router.back();
    }
  }, []);

  if (!activeLiveRoom || !token) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Loading…</Text>
      </View>
    );
  }

  const handleLeave = () => {
    router.back();
  };

  const handleMinimize = () => {
    router.back();
  };

  return (
    <Suspense
      fallback={
        <View style={styles.center}>
          <ActivityIndicator size="large" color={THEME.accent} />
        </View>
      }
    >
      <LiveAudioRoomScreen
        room={activeLiveRoom}
        token={token}
        isHost={isHost === "1"}
        onLeave={handleLeave}
        onMinimize={handleMinimize}
      />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: "#0D0518", alignItems: "center", justifyContent: "center" },
  text: { fontFamily: FONTS.body, color: THEME.textMuted, fontSize: 14 },
});
