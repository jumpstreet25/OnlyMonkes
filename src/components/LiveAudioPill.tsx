/**
 * LiveAudioPill
 *
 * Floating pill overlay shown at the top of ChatScreen when the local user
 * is connected to a live audio room. Overlays on the OnlyMonkes logo area.
 * Blue background, pill-shaped, white text.
 *
 * Controls:
 *   - Tap pill → expand back to full LiveAudioRoomScreen
 *   - Mute/unmute button (functional, connected to liveAudio singleton)
 *   - Shows host name + participant count
 */

import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated } from "react-native";
import { type Participant } from "livekit-client";
import * as liveAudio from "@/lib/liveAudio";
import type { LiveAudioState } from "@/lib/liveAudio";
import { FONTS } from "@/lib/constants";

interface LiveAudioPillProps {
  hostName: string;
  onExpand: () => void;
  onEnd: () => void;
  isHost: boolean;
}

export function LiveAudioPill({ hostName, onExpand, onEnd, isHost }: LiveAudioPillProps) {
  const [participantCount, setParticipantCount] = useState(0);
  const [isMuted, setIsMuted] = useState(liveAudio.getMuted());
  const pulse = useRef(new Animated.Value(1)).current;

  // Pulsing red dot animation
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  // Subscribe to liveAudio singleton for live participant count + mute state
  useEffect(() => {
    const unsub = liveAudio.addStateListener((state: LiveAudioState) => {
      setParticipantCount(state.participants.length);
      setIsMuted(state.muted);
    });
    return unsub;
  }, []);

  const handleMuteToggle = async () => {
    const newMuted = await liveAudio.toggleMute();
    setIsMuted(newMuted);
  };

  return (
    <Pressable onPress={onExpand} style={styles.pill}>
      {/* Pulsing red LIVE dot */}
      <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
      <Text style={styles.liveLabel}>LIVE</Text>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Host name */}
      <Text style={styles.hostText} numberOfLines={1}>@{hostName}</Text>

      {/* Participant count */}
      <Text style={styles.countText}>
        · {participantCount} {participantCount === 1 ? "Monke" : "Monkes"}
      </Text>

      {/* Spacer */}
      <View style={{ flex: 1 }} />

      {/* Mute/Unmute button */}
      <Pressable
        onPress={handleMuteToggle}
        style={({ pressed }) => [styles.muteBtn, pressed && { opacity: 0.7 }]}
        hitSlop={8}
      >
        <Text style={styles.muteIcon}>{isMuted ? "🔇" : "🎤"}</Text>
      </Pressable>

      {/* End/Leave button (if host) or just an expand chevron (if listener) */}
      {isHost ? (
        <Pressable
          onPress={onEnd}
          style={({ pressed }) => [styles.endBtn, pressed && { opacity: 0.7 }]}
          hitSlop={8}
        >
          <Text style={styles.endBtnText}>End</Text>
        </Pressable>
      ) : (
        <Text style={styles.expandIcon}>⌃</Text>
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
    backgroundColor: "#6CB4EE",   // solid blue
    borderRadius: 99,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: "#6CB4EE",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
    gap: 6,
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
  divider: {
    width: 1,
    height: 14,
    backgroundColor: "rgba(255,255,255,0.3)",
    marginHorizontal: 2,
  },
  hostText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 13,
    color: "#fff",
    maxWidth: 100,
  },
  countText: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
  },
  muteBtn: {
    padding: 4,
  },
  muteIcon: {
    fontSize: 16,
  },
  endBtn: {
    backgroundColor: "rgba(239,68,68,0.25)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.5)",
  },
  endBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 11,
    color: "#FCA5A5",
  },
  expandIcon: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 16,
    lineHeight: 18,
  },
});
