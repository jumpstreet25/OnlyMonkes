/**
 * AvatarRoomScreen — Full-screen animated avatar live room.
 *
 * Grid of AnimatedAvatar tiles (NFT PFPs with mouth overlays driven by audio).
 * No camera feeds — everyone is their animated Monke.
 *
 * Grid layout:
 *   1 = fullscreen    2 = 1×2 vertical
 *   3-4 = 2×2 grid   5-6 = 2×3 grid
 *   7-9 = 3×3 grid   10-15 = 3×5 scroll
 *
 * Controls: 🎤 Mute  🐵 Reactions  📞 Leave/End
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { router } from 'expo-router';
import { ConnectionState } from 'livekit-client';
import { toast } from 'sonner-native';
import { THEME, FONTS } from '@/lib/constants';
import { IS_IMMERSIVE_SHELL } from '@/lib/immersiveStatusBar';
import { LK_URL } from '@/lib/livekit';
import { getCachedProfile } from '@/lib/userProfile';
import { useAppStore } from '@/store/appStore';
import { AnimatedAvatar } from '@/components/AnimatedAvatar';
import { DEFAULT_MOUTH_TRAIT, type MouthTrait, parseMouthTrait } from '@/lib/mouthOverlays';
import {
  connectToAvatarRoom,
  disconnectFromAvatarRoom,
  addAvatarStateListener,
  toggleMute,
  getAvatarRoom,
  getLastAvatarSessionStats,
  sendReaction,
  sendFaceTrackingData,
  sendBlendshapes,
  addReactionListener,
  type AvatarRoomState,
  type AvatarParticipant,
} from '@/lib/avatarRoom';
import { settleAvatarRoomSession, type RaidResult } from '@/lib/bananaRaids';
import { FaceTracker } from '@/components/FaceTracker';
import { type FaceParams, type BlendshapeParams } from '@/lib/faceTracking';

import { VideoStickerTray } from '@/components/VideoStickerTray';
import { VideoReactionOverlay } from '@/components/VideoReactionOverlay';

function showRaidToast(raid: RaidResult | null): void {
  if (!raid?.granted) return;
  toast.success(
    raid.reason === 'host'
      ? `🐒 Banana Raid! +${raid.amount} 🍌 for hosting a packed room`
      : `🐒 Banana Raid! +${raid.amount} 🍌 for showing up`,
  );
}

// ── Grid layout ──────────────────────────────────────────────────────────────

function calcGrid(count: number, screenW: number, screenH: number) {
  if (count <= 1) return { cols: 1, tileW: screenW, tileH: screenH };
  if (count === 2) return { cols: 1, tileW: screenW, tileH: screenH / 2 };
  if (count <= 4) return { cols: 2, tileW: screenW / 2, tileH: screenH / 2 };
  if (count <= 6) return { cols: 2, tileW: screenW / 2, tileH: screenH / 3 };
  if (count <= 9) return { cols: 3, tileW: screenW / 3, tileH: screenH / 3 };
  return { cols: 3, tileW: screenW / 3, tileH: (screenW / 3) * 1.33 };
}

// ── Avatar Tile ──────────────────────────────────────────────────────────────

const AvatarTile = React.memo(function AvatarTile({
  participant,
  width,
  height,
}: {
  participant: AvatarParticipant;
  width: number;
  height: number;
}) {
  const profile = getCachedProfile(participant.identity);
  const pfpUri = profile?.nftImage ?? null;
  const avatarSize = Math.min(width, height) * 0.65;

  return (
    <View style={[styles.tile, { width, height }]}>
      <AnimatedAvatar
        pfpUri={pfpUri}
        mouthTrait={participant.mouthTrait}
        audioEnergy={participant.audioEnergy}
        isSpeaking={participant.isSpeaking}
        size={avatarSize}
        fallbackName={participant.name}
        faceParams={participant.faceParams}
        blendshapes={participant.blendshapes}
      />
      {/* Name + status */}
      <View style={styles.tileInfo}>
        <Text style={styles.tileName} numberOfLines={1}>
          {participant.isLocal ? 'You' : participant.name}
        </Text>
        {participant.isMuted && <Text style={styles.tileIcon}>🔇</Text>}
      </View>
    </View>
  );
});

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function AvatarRoomScreen() {
  const insets = useSafeAreaInsets();
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const params = useLocalSearchParams<{ token: string; isHost: string }>();

  const myInboxId = useAppStore(s => s.myInboxId);
  const username = useAppStore(s => s.username);
  const verifiedNft = useAppStore(s => s.verifiedNft);
  const activeRoom = useAppStore(s => s.activeAvatarRoom);

  const [state, setState] = useState<AvatarRoomState>({
    participants: [],
    connectionState: ConnectionState.Disconnected,
    localMuted: false,
  });
  const [connecting, setConnecting] = useState(true);
  const [stickerTrayOpen, setStickerTrayOpen] = useState(false);
  const [faceTrackingEnabled, setFaceTrackingEnabled] = useState(true);

  const isHost = params.isHost === 'true';

  // Get local user's mouth trait from NFT
  const localMouthTrait: MouthTrait = parseMouthTrait(
    verifiedNft?.traits?.find(t => t.trait_type === 'Mouth')?.value,
  );

  // ── Connect on mount ───────────────────────────────────────────────────────

  useEffect(() => {
    const token = params.token;
    if (!token) {
      setConnecting(false);
      return;
    }

    const unsub = addAvatarStateListener(setState);

    // If already connected (re-expanding from pill), just subscribe
    if (getAvatarRoom()) {
      setConnecting(false);
      return;
    }

    connectToAvatarRoom(LK_URL, token, localMouthTrait, isHost, () => {
      // Involuntary disconnect (network drop) — connectToAvatarRoom() never
      // got an explicit disconnectFromAvatarRoom() call, so settle from the
      // RoomEvent.Disconnected listener's snapshot instead.
      const stats = getLastAvatarSessionStats();
      if (stats) settleAvatarRoomSession(stats).then(showRaidToast).catch(() => {});
      useAppStore.getState().setIsInAvatarRoom(false);
      router.back();
    })
      .then(() => setConnecting(false))
      .catch(() => {
        setConnecting(false);
        Alert.alert('Connection Failed', 'Could not join the room.');
        router.back();
      });

    return unsub;
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleMinimize = useCallback(() => {
    router.back();
  }, []);

  const handleLeave = useCallback(async () => {
    const stats = await disconnectFromAvatarRoom();
    if (stats) settleAvatarRoomSession(stats).then(showRaidToast).catch(() => {});
    useAppStore.getState().setIsInAvatarRoom(false);
    useAppStore.getState().setAvatarRoomToken(null);
    router.back();
  }, []);

  const handleEnd = useCallback(async () => {
    // Host ends room — broadcast end via XMTP (handled by ChatScreen)
    const stats = await disconnectFromAvatarRoom();
    if (stats) settleAvatarRoomSession(stats).then(showRaidToast).catch(() => {});
    useAppStore.getState().setIsInAvatarRoom(false);
    useAppStore.getState().setActiveAvatarRoom(null);
    useAppStore.getState().setAvatarRoomToken(null);
    router.back();
  }, []);

  const handleToggleMute = useCallback(async () => {
    await toggleMute();
  }, []);

  const handleSendReaction = useCallback((stickerUrl: string) => {
    sendReaction(stickerUrl, username ?? 'Monke', myInboxId ?? '');
  }, [username, myInboxId]);

  const handleFaceParams = useCallback((params: FaceParams) => {
    sendFaceTrackingData(params);
  }, []);

  const handleBlendshapes = useCallback((params: BlendshapeParams) => {
    sendBlendshapes(params);
  }, []);

  // ── Layout ─────────────────────────────────────────────────────────────────

  const participants = state.participants;
  const gridH = SCREEN_H - insets.top - insets.bottom - 60 - 56; // header + controls
  const { cols, tileW, tileH } = calcGrid(participants.length, SCREEN_W, gridH);
  const needsScroll = participants.length > 9;

  // ── Loading state ──────────────────────────────────────────────────────────

  if (connecting) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" hidden={IS_IMMERSIVE_SHELL} />
        <ActivityIndicator size="large" color={THEME.accent} />
        <Text style={styles.loadingText}>Joining room...</Text>
      </View>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  const GridWrapper = needsScroll ? ScrollView : View;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" hidden={IS_IMMERSIVE_SHELL} />

      {/* Hidden face tracker (camera input for local user) */}
      <FaceTracker
        enabled={faceTrackingEnabled && !state.localMuted}
        onBlendshapes={handleBlendshapes}
      />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={handleMinimize} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>⤡</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={styles.liveDot} />
          <Text style={styles.headerTitle}>
            {activeRoom?.host ?? 'Live Room'} · {participants.length} Monkes
          </Text>
        </View>
        <Pressable onPress={isHost ? handleEnd : handleLeave} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>✕</Text>
        </Pressable>
      </View>

      {/* Grid */}
      <GridWrapper style={styles.grid}>
        <View style={styles.gridInner}>
          {participants.map(p => (
            <AvatarTile
              key={p.identity}
              participant={p}
              width={tileW}
              height={tileH}
            />
          ))}
        </View>
      </GridWrapper>

      {/* Reaction overlay */}
      <VideoReactionOverlay reactionSource={addReactionListener} />

      {/* Sticker tray */}
      {stickerTrayOpen && (
        <VideoStickerTray
          senderName={username ?? 'Monke'}
          senderId={myInboxId ?? ''}
          onSend={handleSendReaction}
        />
      )}

      {/* Controls bar */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 8 }]}>
        {/* Mute */}
        <Pressable
          onPress={handleToggleMute}
          style={[styles.controlBtn, state.localMuted && styles.controlBtnMuted]}
        >
          <Text style={styles.controlIcon}>{state.localMuted ? '🔇' : '🎤'}</Text>
        </Pressable>

        {/* Face tracking toggle */}
        <Pressable
          onPress={() => setFaceTrackingEnabled(e => !e)}
          style={[styles.controlBtn, faceTrackingEnabled && styles.controlBtnActive]}
        >
          <Text style={styles.controlIcon}>👤</Text>
        </Pressable>

        {/* Reactions */}
        <Pressable
          onPress={() => setStickerTrayOpen(o => !o)}
          style={[styles.controlBtn, stickerTrayOpen && styles.controlBtnActive]}
        >
          <Text style={styles.controlIcon}>🐵</Text>
        </Pressable>

        {/* Leave / End */}
        <Pressable
          onPress={isHost ? handleEnd : handleLeave}
          style={[styles.controlBtn, styles.controlBtnLeave]}
        >
          <Text style={styles.controlIcon}>📞</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  loadingText: {
    color: THEME.textDim,
    fontFamily: FONTS.body,
    marginTop: 16,
    textAlign: 'center',
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: THEME.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnText: {
    fontSize: 18,
    color: THEME.text,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ff3b30',
  },
  headerTitle: {
    fontFamily: FONTS.display,
    fontSize: 14,
    color: THEME.text,
  },
  grid: {
    flex: 1,
  },
  gridInner: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  tileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  tileName: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.text,
    maxWidth: 100,
  },
  tileIcon: {
    fontSize: 12,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
  },
  controlBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: THEME.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBtnMuted: {
    backgroundColor: 'rgba(255,68,68,0.3)',
  },
  controlBtnActive: {
    backgroundColor: 'rgba(68,130,255,0.3)',
  },
  controlBtnLeave: {
    backgroundColor: '#ff3b30',
  },
  controlIcon: {
    fontSize: 22,
  },
});
