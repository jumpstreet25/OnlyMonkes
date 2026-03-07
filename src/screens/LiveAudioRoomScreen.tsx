/**
 * LiveAudioRoomScreen
 *
 * Twitter Spaces-style live audio room powered by LiveKit.
 *
 * Layout:
 *   - Host row (top, prominent card with crown)
 *   - Listeners grid (PFP + name + speaking indicator)
 *   - Bottom bar: Mute toggle + Leave button
 *
 * Speaking participants get an animated pulsing purple border.
 * The XMTP participant identity is the user's XMTP inboxId,
 * so we can look up NFT avatars via getCachedProfile().
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
import { router } from "expo-router";
import {
  Room,
  RoomEvent,
  ConnectionState,
  type Participant,
  type LocalParticipant,
} from "livekit-client";
import { AudioSession } from "@livekit/react-native";
import * as Haptics from "expo-haptics";
import { THEME, FONTS } from "@/lib/constants";
import { getCachedProfile } from "@/lib/userProfile";
import { useAppStore, type LiveRoomState } from "@/store/appStore";
import { LK_URL } from "@/lib/livekit";

interface LiveAudioRoomScreenProps {
  room: LiveRoomState;
  token: string;
  isHost: boolean;
  onLeave: () => void;
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
}: LiveAudioRoomScreenProps) {
  const insets = useSafeAreaInsets();
  const [lkRoom] = useState(() => new Room());
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected
  );
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const [isMuted, setIsMuted] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const { updateLiveRoomCount } = useAppStore();

  const refreshParticipants = useCallback(() => {
    const remote = [...lkRoom.remoteParticipants.values()];
    const all: Participant[] = lkRoom.localParticipant
      ? [lkRoom.localParticipant as unknown as Participant, ...remote]
      : remote;
    setParticipants(all);
    updateLiveRoomCount(all.length);
  }, [lkRoom, updateLiveRoomCount]);

  // ── Connect on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      try {
        await AudioSession.startAudioSession();

        lkRoom.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          if (!cancelled) setConnectionState(state);
        });

        lkRoom.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
          if (!cancelled) setActiveSpeakers(new Set(speakers.map((s) => s.identity)));
        });

        lkRoom.on(RoomEvent.ParticipantConnected,    refreshParticipants);
        lkRoom.on(RoomEvent.ParticipantDisconnected, refreshParticipants);
        lkRoom.on(RoomEvent.TrackPublished,          refreshParticipants);
        lkRoom.on(RoomEvent.TrackUnpublished,        refreshParticipants);
        lkRoom.on(RoomEvent.TrackSubscribed,         refreshParticipants);
        lkRoom.on(RoomEvent.TrackUnsubscribed,       refreshParticipants);

        lkRoom.on(RoomEvent.Disconnected, () => {
          if (!cancelled) handleLeave();
        });

        await lkRoom.connect(LK_URL, token);
        await lkRoom.localParticipant.setMicrophoneEnabled(true);
        if (!cancelled) refreshParticipants();
      } catch (err: any) {
        if (!cancelled) {
          Alert.alert("Connection failed", err?.message ?? "Could not join the live room.");
          onLeave();
        }
      }
    };

    connect();

    return () => {
      cancelled = true;
      lkRoom.disconnect();
      AudioSession.stopAudioSession();
    };
  }, []);

  const handleLeave = useCallback(async () => {
    if (isLeaving) return;
    setIsLeaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await lkRoom.disconnect();
      await AudioSession.stopAudioSession();
    } catch { /* ignore */ }
    onLeave();
  }, [lkRoom, isLeaving, onLeave]);

  const handleToggleMute = useCallback(async () => {
    Haptics.selectionAsync();
    try {
      const newMuted = !isMuted;
      await lkRoom.localParticipant.setMicrophoneEnabled(!newMuted);
      setIsMuted(newMuted);
    } catch { /* ignore */ }
  }, [lkRoom, isMuted]);

  const isConnecting = connectionState !== ConnectionState.Connected;

  // Separate host from listeners
  const hostParticipant = participants.find((p) => p.identity === roomData.hostId);
  const listeners       = participants.filter((p) => p.identity !== roomData.hostId);
  const localIdentity   = lkRoom.localParticipant?.identity ?? "";

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={handleLeave} style={styles.backBtn} hitSlop={12}>
          <Text style={styles.backText}>✕</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={styles.liveChip}>
            <View style={styles.liveChipDot} />
            <Text style={styles.liveChipText}>LIVE</Text>
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>{roomData.host}'s Space</Text>
        </View>
        <View style={{ width: 36 }} />
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
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: THEME.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: { color: THEME.textMuted, fontSize: 16 },
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
    borderColor: "transparent",
  },
  cardAvatarFallback: {
    backgroundColor: THEME.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
    borderColor: THEME.border,
    borderWidth: 2,
  },
  cardInitial: {
    fontFamily: FONTS.display,
    fontSize: 18,
    color: THEME.text,
  },
  cardName: {
    fontFamily: FONTS.bodyMed,
    fontSize: 11,
    color: THEME.text,
    textAlign: "center",
    maxWidth: 70,
  },
  cardNameLarge: {
    fontSize: 13,
    maxWidth: 100,
  },
  crownBadge: {
    fontSize: 14,
    marginTop: -8,
  },
  muteIcon: {
    fontSize: 13,
  },
  speakingRing: {
    borderRadius: 999,
    borderWidth: 2.5,
    borderColor: THEME.accent,
  },
  speakingDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
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
    justifyContent: "center",
    gap: 16,
    paddingTop: 16,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: "#1E0A3C",
    backgroundColor: "#0D0518",
  },
  muteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 12,
    flex: 1,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: THEME.border,
  },
  muteBtnActive: {
    backgroundColor: "#2D0A0A",
    borderColor: "#EF4444",
  },
  muteBtnIcon: { fontSize: 18 },
  muteBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 14,
    color: THEME.text,
  },
  muteBtnTextActive: { color: "#EF4444" },
  leaveBtn: {
    backgroundColor: "#EF4444",
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  leaveBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 14,
    color: "#fff",
  },
});
