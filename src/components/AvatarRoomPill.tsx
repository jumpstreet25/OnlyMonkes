/**
 * AvatarRoomPill
 *
 * Floating pill overlay shown at the top of ChatScreen when the user is in
 * an avatar room but has minimized to Main Chat.
 *
 * Shows animated PFP of current speaker, mute button, reaction button,
 * expand/end controls. Same position and z-index as LiveAudioPill.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated } from "react-native";
import { FONTS } from "@/lib/constants";
import { getCachedProfile } from "@/lib/userProfile";
import { AnimatedAvatar } from "@/components/AnimatedAvatar";
import { DEFAULT_MOUTH_TRAIT } from "@/lib/mouthOverlays";
import {
  addAvatarStateListener,
  getActiveSpeaker,
  toggleMute,
  getMuted,
  type AvatarRoomState,
  type AvatarParticipant,
} from "@/lib/avatarRoom";

interface AvatarRoomPillProps {
  hostName: string;
  isHost: boolean;
  onExpand: () => void;
  onEnd: () => void;
  onLeave: () => void;
  onReaction: () => void;
}

export function AvatarRoomPill({
  hostName,
  isHost,
  onExpand,
  onEnd,
  onLeave,
  onReaction,
}: AvatarRoomPillProps) {
  const [participantCount, setParticipantCount] = useState(0);
  const [isMuted, setIsMuted] = useState(getMuted());
  const [speaker, setSpeaker] = useState<AvatarParticipant | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  // Pulsing red dot
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);

  // Subscribe to avatar room state
  useEffect(() => {
    const unsub = addAvatarStateListener((state: AvatarRoomState) => {
      setParticipantCount(state.participants.length);
      setIsMuted(state.localMuted);
      setSpeaker(getActiveSpeaker());
    });
    return unsub;
  }, []);

  const handleMuteToggle = useCallback(async () => {
    const newMuted = await toggleMute();
    setIsMuted(newMuted);
  }, []);

  // Speaker PFP
  const speakerProfile = speaker ? getCachedProfile(speaker.identity) : null;
  const speakerPfp = speakerProfile?.nftImage ?? null;

  return (
    <Pressable onPress={onExpand} style={styles.pill}>
      {/* Animated speaker PFP */}
      <AnimatedAvatar
        pfpUri={speakerPfp}
        mouthTrait={speaker?.mouthTrait ?? DEFAULT_MOUTH_TRAIT}
        audioEnergy={speaker?.audioEnergy ?? 0}
        isSpeaking={speaker?.isSpeaking ?? false}
        size={32}
        fallbackName={speaker?.name}
      />

      {/* Pulsing red LIVE dot */}
      <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
      <Text style={styles.liveLabel}>LIVE</Text>

      {/* Host name + count */}
      <Text style={styles.hostText} numberOfLines={1}>@{hostName}</Text>
      <Text style={styles.countText}>
        · {participantCount}
      </Text>

      <View style={{ flex: 1 }} />

      {/* Mute */}
      <Pressable
        onPress={handleMuteToggle}
        style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
        hitSlop={8}
      >
        <Text style={styles.iconText}>{isMuted ? "🔇" : "🎤"}</Text>
      </Pressable>

      {/* Reactions */}
      <Pressable
        onPress={onReaction}
        style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
        hitSlop={8}
      >
        <Text style={styles.iconText}>🐵</Text>
      </Pressable>

      {/* End / Expand */}
      {isHost ? (
        <Pressable
          onPress={onEnd}
          style={({ pressed }) => [styles.endBtn, pressed && { opacity: 0.7 }]}
          hitSlop={8}
        >
          <Text style={styles.endBtnText}>End</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={onLeave}
          style={({ pressed }) => [styles.leaveBtn, pressed && { opacity: 0.7 }]}
          hitSlop={8}
        >
          <Text style={styles.leaveBtnText}>Leave</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    top: 8,
    left: 16,
    right: 16,
    zIndex: 50,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#6CB4EE",
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: "#6CB4EE",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
    gap: 5,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#EF4444",
  },
  liveLabel: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: "#fff",
    letterSpacing: 1.5,
  },
  hostText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 12,
    color: "#fff",
    maxWidth: 80,
  },
  countText: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: "rgba(255,255,255,0.8)",
  },
  iconBtn: {
    padding: 3,
  },
  iconText: {
    fontSize: 15,
  },
  endBtn: {
    backgroundColor: "rgba(239,68,68,0.25)",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.5)",
  },
  endBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 10,
    color: "#FCA5A5",
  },
  leaveBtn: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  leaveBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 10,
    color: "#fff",
  },
});
