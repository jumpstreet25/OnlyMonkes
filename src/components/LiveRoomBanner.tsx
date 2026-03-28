/**
 * LiveRoomBanner
 *
 * Pinned at the top of ChatScreen (above messages) when a live audio room is active.
 * Styled like a Twitter/X pinned post.
 * Host sees an "End" button; others see a "Join" button (informational for now).
 */

import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Animated } from "react-native";
import { Image } from "expo-image";
import { THEME, FONTS } from "@/lib/constants";
import { getCachedProfile } from "@/lib/userProfile";
import type { LiveRoomState } from "@/store/appStore";

interface LiveRoomBannerProps {
  room: LiveRoomState;
  isHost: boolean;
  onEnd: () => void;
  onJoin: () => void;
}

export function LiveRoomBanner({ room, isHost, onEnd, onJoin }: LiveRoomBannerProps) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,   duration: 900, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const hostProfile = getCachedProfile(room.hostId);
  const avatarUri   = hostProfile?.nftImage ?? null;
  const displayName = room.host ?? "Unknown";
  const count       = room.participantCount ?? 0;

  return (
    <View style={styles.wrapper}>
      {/* Pin label row */}
      <View style={styles.pinRow}>
        <Text style={styles.pinIcon}>📌</Text>
        <Text style={styles.pinLabel}>Live Audio</Text>
        <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
      </View>

      {/* Main row */}
      <View style={styles.main}>
        {/* Avatar */}
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{displayName[0]?.toUpperCase() ?? "?"}</Text>
          </View>
        )}

        {/* Text */}
        <View style={styles.info}>
          <Text style={styles.hostLine} numberOfLines={1}>
            Hosted by{" "}
            <Text style={styles.atName}>@{displayName}</Text>
          </Text>
          <Text style={styles.countLine}>
            {count} {count === 1 ? "Monke" : "Monkes"} In-Chat
          </Text>
        </View>

        {/* Action button */}
        <Pressable
          style={({ pressed }) => [
            styles.btn,
            isHost ? styles.endBtn : styles.joinBtn,
            pressed && { opacity: 0.7 },
          ]}
          onPress={isHost ? onEnd : onJoin}
        >
          <Text style={[styles.btnText, isHost && styles.endBtnText]}>
            {isHost ? "End" : "Join"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderBottomWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
  },

  pinRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 8,
  },
  pinIcon: { fontSize: 11 },
  pinLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    flex: 1,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#EF4444",
  },

  main: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  avatarFallback: {
    backgroundColor: THEME.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontFamily: FONTS.display,
    fontSize: 14,
    color: THEME.text,
  },

  info: { flex: 1, gap: 2 },
  hostLine: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: THEME.text,
  },
  atName: {
    fontFamily: FONTS.bodySemi,
    color: THEME.accent,
  },
  countLine: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
  },

  btn: {
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  joinBtn: {
    backgroundColor: THEME.accent,
  },
  endBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: THEME.border,
  },
  btnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 13,
    color: "#fff",
  },
  endBtnText: {
    color: THEME.textMuted,
  },
});
