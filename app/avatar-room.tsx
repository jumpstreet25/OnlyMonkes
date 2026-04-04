/**
 * Avatar Room route — lazy-loaded to avoid pulling LiveKit into initial bundle
 */

import React, { Suspense, useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { FONTS } from "@/lib/constants";
import { router, useLocalSearchParams } from "expo-router";
import { useAppStore } from "@/store/appStore";
import { THEME } from "@/lib/constants";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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
        <Text style={styles.connectText}>Connecting to avatar room…</Text>
      </View>
    );
  }

  return (
    <ErrorBoundary fallbackMessage="Avatar room hit an error. Go back and try again.">
      <Suspense
        fallback={
          <View style={styles.center}>
            <Text style={styles.connectText}>Loading avatar room…</Text>
          </View>
        }
      >
        <AvatarRoomScreen />
      </Suspense>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: "#0D0518", alignItems: "center", justifyContent: "center" },
  connectText: { fontFamily: FONTS.displayMed, fontSize: 16, color: THEME.textMuted },
});
