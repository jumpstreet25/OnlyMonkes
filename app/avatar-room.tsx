/**
 * Avatar Room route — lazy-loaded to avoid pulling LiveKit into initial bundle
 */

import React, { Suspense, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { FONTS, THEME } from "@/lib/constants";
import { router, useLocalSearchParams } from "expo-router";
import { useAppStore } from "@/store/appStore";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const AvatarRoomScreen = React.lazy(() => import("@/screens/AvatarRoomScreen"));

export default function AvatarRoomRoute() {
  const { token, isHost } = useLocalSearchParams<{ token: string; isHost?: string }>();
  const activeAvatarRoom = useAppStore((s) => s.activeAvatarRoom);
  // Avoid bounce on first paint before store/params hydrate
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setReady(true);
      if (!activeAvatarRoom || !token) {
        setMissing(true);
        // Brief delay so user can read state before pop
        setTimeout(() => {
          if (router.canGoBack()) router.back();
        }, 400);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [activeAvatarRoom, token]);

  if (!ready || !activeAvatarRoom || !token) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={THEME.accent} />
        <Text style={styles.connectText}>
          {missing ? "Room unavailable — going back…" : "Connecting to avatar room…"}
        </Text>
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
  center: {
    flex: 1,
    backgroundColor: "#0D0518",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  connectText: {
    fontFamily: FONTS.displayMed,
    fontSize: 16,
    color: THEME.textMuted,
    textAlign: "center",
  },
});
