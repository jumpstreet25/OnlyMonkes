/**
 * LiveAudioRoomScreen
 *
 * Twitter Spaces-style live audio room powered by LiveKit.
 * Uses the liveAudio singleton so the Room survives navigation (minimize → chat → expand).
 *
 * Props:
 *   onMinimize — go back to chat without disconnecting audio
 *   onLeave    — disconnect audio and go back
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Animated,
  Alert,
  ActivityIndicator,
  StatusBar,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConnectionState, type Participant } from "livekit-client";
import * as Haptics from "expo-haptics";
import { THEME, FONTS } from "@/lib/constants";
import { getCachedProfile } from "@/lib/userProfile";
import { useAppStore, type LiveRoomState } from "@/store/appStore";
import { LK_URL } from "@/lib/livekit";
import * as liveAudio from "@/lib/liveAudio";
import type { LiveAudioState } from "@/lib/liveAudio";

interface LiveAudioRoomScreenProps {
  room: LiveRoomState;
  token: string;
  isHost: boolean;
  onLeave: () => void;
  onMinimize: () => void;
}

// ─── Speaking pulse animation ─────────────────────────────────────────────────

function SpeakingRing({ speaking }: { speaking: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (speaking) {
      Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(scale,   { toValue: 1.18, duration: 600, useNativeDriver: true }),
            Animated.timing(scale,   { toValue: 1,    duration: 600, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0.9,  duration: 300, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0.3,  duration: 600, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0,    duration: 300, useNativeDriver: true }),
          ]),
        ])
      ).start();
    } else {
      scale.setValue(1);
      opacity.setValue(0);
    }
  }, [speaking]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        styles.speakingRing,
        { transform: [{ scale }], opacity },
      ]}
    />
  );
}

// ─── Participant card ─────────────────────────────────────────────────────────

function ParticipantCard({
  participant,
  isHost,
  isSpeaking,
  isMuted,
  large,
}: {
  participant: Participant;
  isHost: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  large?: boolean;
}) {
  const identity    = participant.identity;
  const displayName = participant.name || identity.slice(0, 8);
  const profile     = getCachedProfile(identity);
  const avatarUri   = profile?.nftImage ?? null;

  const size = large ? 72 : 52;

  return (
    <View style={[styles.card, large && styles.cardLarge]}>
      <View style={{ position: "relative", width: size, height: size }}>
        {avatarUri ? (
          <Image
            source={{ uri: avatarUri }}
            style={[styles.cardAvatar, { width: size, height: size, borderRadius: size / 2 }]}
            contentFit="cover"
          />
        ) : (
          <View
            style={[
              styles.cardAvatar,
              styles.cardAvatarFallback,
              { width: size, height: size, borderRadius: size / 2 },
            ]}
          >
            <Text style={[styles.cardInitial, large && { fontSize: 26 }]}>
              {displayName[0]?.toUpperCase() ?? "?"}
            </Text>
          </View>
        )}
        <SpeakingRing speaking={isSpeaking} />
        {isSpeaking && (
          <View style={styles.speakingDot} />
        )}
      </View>

      {isHost && <Text style={styles.crownBadge}>👑</Text>}

      <Text style={[styles.cardName, large && styles.cardNameLarge]} numberOfLines={1}>
        {displayName}
      </Text>

      {isMuted ? (
        <Text style={styles.muteIcon}>🔇</Text>
      ) : (
        <Text style={[styles.muteIcon, { opacity: 0.3 }]}>🎤</Text>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function LiveAudioRoomScreen({
  room: roomData,
  token,
  isHost,
  onLeave,
  onMinimize,
}: LiveAudioRoomScreenProps) {
  const insets = useSafeAreaInsets();
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    liveAudio.getRoomConnectionState()
  );
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const [isMuted, setIsMuted] = useState(liveAudio.getMuted());
  const [isLeaving, setIsLeaving] = useState(false);
  const { updateLiveRoomCount, setIsInLiveRoom, setLiveRoomToken } = useAppStore();
  const connectedRef = useRef(false);

  // Subscribe to liveAudio singleton state
  useEffect(() => {
    const unsub = liveAudio.addStateListener((state: LiveAudioState) => {
      setParticipants(state.participants);
      setActiveSpeakers(state.speakers);
      setIsMuted(state.muted);
      updateLiveRoomCount(state.participants.length);
    });
    return unsub;
  }, []);

  // Connect on mount only if not already connected
  useEffect(() => {
    const alreadyConnected =
      liveAudio.getRoomConnectionState() === ConnectionState.Connected;

    if (alreadyConnected) {
      setConnectionState(ConnectionState.Connected);
      return;
    }

    let cancelled = false;

    const connect = async () => {
      try {
        setConnectionState(ConnectionState.Connecting);
        await liveAudio.connectToRoom(LK_URL, token, () => {
          if (!cancelled) {
            setIsInLiveRoom(false);
            setLiveRoomToken(null);
            onLeave();
          }
        });
        if (!cancelled) {
          connectedRef.current = true;
          setConnectionState(ConnectionState.Connected);
          setIsInLiveRoom(true);
          setLiveRoomToken(token);
        }
      } catch (err: any) {
        if (!cancelled) {
          Alert.alert("Connection failed", err?.message ?? "Could not join the live room.");
          onLeave();
        }
      }
    };

    connect();

    return () => { cancelled = true; };
  }, []);

  const handleLeave = useCallback(async () => {
    if (isLeaving) return;
    setIsLeaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsInLiveRoom(false);
    setLiveRoomToken(null);
    await liveAudio.disconnectFromRoom();
    onLeave();
  }, [isLeaving, onLeave]);

  const handleMinimize = useCallback(() => {
    Haptics.selectionAsync();
    onMinimize();
  }, [onMinimize]);

  const handleToggleMute = useCallback(async () => {
    Haptics.selectionAsync();
    const newMuted = await liveAudio.toggleMute();
    setIsMuted(newMuted);
  }, []);

  const isConnecting = connectionState !== ConnectionState.Connected;

  // Separate host from listeners
  const hostParticipant = participants.find((p) => p.identity === roomData.hostId);
  const listeners       = participants.filter((p) => p.identity !== roomData.hostId);
  const room            = liveAudio.getRoom();
  const localIdentity   = room?.localParticipant?.identity ?? "";

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        {/* Minimize button — stays connected */}
        <Pressable onPress={handleMinimize} style={styles.headerBtn} hitSlop={12}>
          <Text style={styles.headerBtnText}>⌄</Text>
        </Pressable>

        <View style={styles.headerCenter}>
          <View style={styles.liveChip}>
            <View style={styles.liveChipDot} />
            <Text style={styles.liveChipText}>LIVE</Text>
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>{roomData.host}'s Space</Text>
        </View>

        {/* Leave button */}
        <Pressable
          onPress={handleLeave}
          style={[styles.headerBtn, styles.headerLeaveBtn]}
          hitSlop={12}
          disabled={isLeaving}
        >
          <Text style={styles.headerLeaveBtnText}>✕</Text>
        </Pressable>
      </View>

      {/* Connecting state */}
      {isConnecting && (
        <View style={styles.connecting}>
          <ActivityIndicator color={THEME.accent} size="large" />
          <Text style={styles.connectingText}>Joining…</Text>
        </View>
      )}

      {/* Room content */}
      {!isConnecting && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Host section */}
          <Text style={styles.sectionLabel}>Host</Text>
          <View style={styles.hostSection}>
            {hostParticipant ? (
              <ParticipantCard
                participant={hostParticipant}
                isHost
                isSpeaking={activeSpeakers.has(hostParticipant.identity)}
                isMuted={
                  hostParticipant.identity === localIdentity
                    ? isMuted
                    : !hostParticipant.isMicrophoneEnabled
                }
                large
              />
            ) : (
              <View style={styles.hostPlaceholder}>
                <Text style={styles.hostPlaceholderText}>{roomData.host} (connecting…)</Text>
              </View>
            )}
          </View>

          {/* Listeners section */}
          {listeners.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
                Listeners · {listeners.length}
              </Text>
              <View style={styles.listenersGrid}>
                {listeners.map((p) => (
                  <ParticipantCard
                    key={p.identity}
                    participant={p}
                    isHost={false}
                    isSpeaking={activeSpeakers.has(p.identity)}
                    isMuted={
                      p.identity === localIdentity ? isMuted : !p.isMicrophoneEnabled
                    }
                  />
                ))}
              </View>
            </>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {/* Bottom bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        {/* Mute toggle */}
        <Pressable
          style={({ pressed }) => [
            styles.muteBtn,
            isMuted && styles.muteBtnActive,
            pressed && { opacity: 0.75 },
          ]}
          onPress={handleToggleMute}
        >
          <Text style={styles.muteBtnIcon}>{isMuted ? "🔇" : "🎤"}</Text>
          <Text style={[styles.muteBtnText, isMuted && styles.muteBtnTextActive]}>
            {isMuted ? "Unmute" : "Mute"}
          </Text>
        </Pressable>

        {/* Minimize */}
        <Pressable
          style={({ pressed }) => [styles.minimizeBtn, pressed && { opacity: 0.75 }]}
          onPress={handleMinimize}
        >
          <Text style={styles.minimizeBtnText}>⌄  Back to Chat</Text>
        </Pressable>

        {/* Leave */}
        <Pressable
          style={({ pressed }) => [styles.leaveBtn, pressed && { opacity: 0.75 }]}
          onPress={handleLeave}
          disabled={isLeaving}
        >
          <Text style={styles.leaveBtnText}>{isLeaving ? "Leaving…" : "Leave"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0D0518",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1E0A3C",
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: THEME.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBtnText: { color: THEME.textMuted, fontSize: 20 },
  headerLeaveBtn: { backgroundColor: "#2D0A0A" },
  headerLeaveBtnText: { color: "#EF4444", fontSize: 16 },
  headerCenter: { alignItems: "center", gap: 4, flex: 1 },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#2D0A0A",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  liveChipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#EF4444" },
  liveChipText: { fontFamily: FONTS.mono, fontSize: 9, color: "#EF4444", letterSpacing: 1 },
  headerTitle: {
    fontFamily: FONTS.display,
    fontSize: 16,
    color: THEME.text,
  },
  connecting: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  connectingText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: 20,
  },
  sectionLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  hostSection: {
    alignItems: "center",
  },
  hostPlaceholder: {
    paddingVertical: 20,
    alignItems: "center",
  },
  hostPlaceholderText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
  },
  listenersGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  // Participant card
  card: {
    alignItems: "center",
    gap: 6,
    width: 70,
  },
  cardLarge: {
    width: 100,
  },
  cardAvatar: {
    borderWidth: 2,
    borderColor: THEME.border,
  },
  cardAvatarFallback: {
    backgroundColor: THEME.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  cardInitial: {
    fontFamily: FONTS.display,
    fontSize: 18,
    color: THEME.text,
  },
  cardName: {
    fontFamily: FONTS.bodyMed,
    fontSize: 11,
    color: THEME.textMuted,
    maxWidth: 70,
    textAlign: "center",
  },
  cardNameLarge: {
    fontSize: 13,
    color: THEME.text,
    maxWidth: 100,
  },
  crownBadge: {
    fontSize: 16,
    marginTop: -4,
  },
  muteIcon: { fontSize: 12 },
  speakingRing: {
    borderRadius: 999,
    borderWidth: 2.5,
    borderColor: THEME.accent,
  },
  speakingDot: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: THEME.accent,
    borderWidth: 1.5,
    borderColor: "#0D0518",
  },
  // Bottom bar
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#1E0A3C",
    gap: 10,
  },
  muteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  muteBtnActive: {
    borderColor: "#EF444466",
    backgroundColor: "#2D0A0A",
  },
  muteBtnIcon: { fontSize: 16 },
  muteBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 13,
    color: THEME.text,
  },
  muteBtnTextActive: { color: "#EF4444" },
  minimizeBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: THEME.surfaceHigh,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  minimizeBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 13,
    color: THEME.textMuted,
  },
  leaveBtn: {
    backgroundColor: "#2D0A0A",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#EF444433",
  },
  leaveBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 13,
    color: "#EF4444",
  },
});
