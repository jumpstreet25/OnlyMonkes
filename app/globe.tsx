/**
 * Globe route — lazy-loaded 3D globe with Monke locations and Solana events.
 * Wrapped in ErrorBoundary to catch expo-gl native crashes gracefully.
 */

import React, { Suspense, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { router } from "expo-router";
import { THEME, FONTS } from "@/lib/constants";
import { UserProfileModal, type ProfileTarget } from "@/components/UserProfileModal";

const GlobeScreen = React.lazy(() => import("@/screens/GlobeScreen"));

class GlobeErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: "" };
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, error: err?.message ?? "Unknown error" };
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.center}>
          <Text style={{ fontSize: 48 }}>🌍</Text>
          <Text style={styles.title}>Globe unavailable</Text>
          <Text style={styles.text}>{this.state.error}</Text>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Go back</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function GlobeRoute() {
  const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null);

  return (
    <>
      <GlobeErrorBoundary>
        <Suspense
          fallback={
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#6CB4EE" />
              <Text style={styles.text}>Loading globe…</Text>
            </View>
          }
        >
          <GlobeScreen onPressUser={setProfileTarget} />
        </Suspense>
      </GlobeErrorBoundary>

      {profileTarget && (
        <UserProfileModal
          visible
          target={profileTarget}
          onClose={() => setProfileTarget(null)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: THEME.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: THEME.text,
  },
  text: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.textMuted,
    textAlign: "center",
  },
  backBtn: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: "rgba(108, 180, 238, 0.12)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(108, 180, 238, 0.2)",
  },
  backText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 14,
    color: "#6CB4EE",
  },
});
