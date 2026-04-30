/**
 * Live Audio Room — RETIRED v2.33 (replaced by Avatar Rooms).
 *
 * Stub kept so stale `LIVE_ROOM:` push notifications and old chat-bubble
 * navigations land somewhere graceful instead of a "screen not found" error.
 * Bounces the user to Main Chat with a one-time toast.
 */

import { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";
import { toast } from "sonner-native";
import { THEME, FONTS } from "@/lib/constants";

export default function LiveRoomRetiredStub() {
  useEffect(() => {
    toast("Live Audio Rooms have been retired. Try Avatar Rooms instead.");
    const t = setTimeout(() => router.replace("/" as any), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.center}>
      <Text style={styles.text}>Live Audio Rooms retired — redirecting…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: "#0D0518", alignItems: "center", justifyContent: "center" },
  text: { fontFamily: FONTS.body, color: THEME.textMuted, fontSize: 14 },
});
