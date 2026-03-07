/**
 * LiveRoomBanner
 *
 * Pinned banner shown in ChatScreen when a live audio room is active.
 * Shows host name, participant count, live pulse, and Join/Leave button.
 */

import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Animated } from "react-native";
import { Image } from "expo-image";
import { THEME, FONTS } from "@/lib/constants";
import { getCachedProfile } from "@/lib/userProfile";
import type { LiveRoomState } from "@/store/appStore";

interface LiveRoomBannerProps {
  room: LiveRoomState;
  isInRoom: boolean;
  onJoin: () => void;
  onLeave: () => void;
}

export function LiveRoomBanner({ room, isInRoom, onJoin, onLeave }: LiveRoomBannerProps) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,   duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const hostProfile = getCachedProfile(room.hostId);
  const avatarUri   = hostProfile?.nftImage ?? null;

  return (
    <View style={styles.banner}>
      {/* Left: live indicator + avatar + info */}
      <View style={styles.left}>
        <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{(room.host ?? "?")[0].toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.info}>
          <View style={styles.infoRow}>
            <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>LIVE</Text></View>
            <Text style={styles.hostName} numberOfLines={1}>{room.host}</Text>
          </View>
          <Text style={styles.countText}>
            {room.participantCount} {room.participantCount === 1 ? "listener" : "listeners"}
          </Text>
        </View>
      </View>

      {/* Right: Join / Leave */}
      <Pressable
        style={({ pressed }) => [
          styles.joinBtn,
          isInRoom && styles.leaveBtn,
          pressed && { opacity: 0.75 },
        ]}
        onPress={isInRoom ? onLeave : onJoin}
      >
        <Text style={[styles.joinText, isInRoom && styles.leaveText]}>
          {isInRoom ? "Leave" : "Join"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1A0A2E",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#3D1E7A",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF4444",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#7C3AED",
  },
  avatarFallback: {
    backgroundColor: THEME.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontFamily: FONTS.display,
    fontSize: 13,
    color: THEME.text,
  },
  info: { flex: 1, gap: 1 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveBadge: {
    backgroundColor: "#EF4444",
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  liveBadgeText: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: "#fff",
    letterSpacing: 1,
  },
  hostName: {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: THEME.text,
    flex: 1,
  },
  countText: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textMuted,
  },
  joinBtn: {
    backgroundColor: "#7C3AED",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  leaveBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: THEME.border,
  },
  joinText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 13,
    color: "#fff",
  },
  leaveText: {
    color: THEME.textMuted,
  },
});
