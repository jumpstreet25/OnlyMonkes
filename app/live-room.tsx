/**
 * Live Audio Room route
 *
 * Reads room state from appStore (set when user taps Join in LiveRoomBanner
 * or hosts a room from ChatScreen). Token is generated on-device before navigation.
 */

import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import LiveAudioRoomScreen from "@/screens/LiveAudioRoomScreen";
import { useAppStore } from "@/store/appStore";
import { THEME, FONTS } from "@/lib/constants";

export default function LiveRoomRoute() {
  const { token, isHost } = useLocalSearchParams<{ token: string; isHost?: string }>();
  const { activeLiveRoom, setActiveLiveRoom, myInboxId } = useAppStore();

  // Safety: if room disappeared while navigating, go back
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
    // If host left, end the room for everyone (done in ChatScreen via broadcastLiveRoom)
    router.back();
  };

  return (
    <LiveAudioRoomScreen
      room={activeLiveRoom}
      token={token}
      isHost={isHost === "1"}
      onLeave={handleLeave}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: "#0D0518", alignItems: "center", justifyContent: "center" },
  text: { fontFamily: FONTS.body, color: THEME.textMuted, fontSize: 14 },
});
