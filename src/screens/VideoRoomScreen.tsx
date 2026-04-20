/**
 * VideoRoomScreen — Multi-person video calls (3–15 participants)
 *
 * Architecture:
 *   XMTP group msg (VIDEO_ROOM:) → signaling/coordination
 *   LiveKit SFU (self-hosted) → WebRTC media routing
 *   DTLS/SRTP → media encryption
 *   Simulcast → 720p adaptive bitrate
 *
 * Grid layout adapts:
 *   1 = full screen    2 = 1x2 vertical split
 *   3-4 = 2x2 grid    5-6 = 2x3 grid
 *   7-9 = 3x3 grid    10-15 = 3x5 scroll grid
 *
 * Controls:
 *   🎤 Mic toggle   📷 Camera toggle   🔄 Flip camera
 *   📺 Screen share   📞 Leave
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { THEME, FONTS } from '@/lib/constants';
import { useAppStore } from '@/store/appStore';
import { getCachedProfile } from '@/lib/userProfile';
import { LK_URL } from '@/lib/livekit';
import {
  connectToVideoRoom,
  disconnectFromVideoRoom,
  getVideoRoom,
  addVideoStateListener,
  toggleAudioMute,
  toggleVideoMute,
  toggleCamera,
  toggleScreenShare,
  type VideoRoomState,
  type VideoParticipant,
} from '@/lib/liveVideo';
import { VideoReactionOverlay } from '@/components/VideoReactionOverlay';
import { VideoStickerTray } from '@/components/VideoStickerTray';
import { AnimatedNftAvatar } from '@/components/AnimatedNftAvatar';

// ─── Video tile ──────────────────────────────────────────────────────────────

function VideoTile({
  participant,
  width,
  height,
}: {
  participant: VideoParticipant;
  width: number;
  height: number;
}) {
  const profile = getCachedProfile(participant.identity);
  const pfpUri = profile?.nftImage ?? null;
  const displayName = participant.name ?? profile?.username ?? 'Monke';

  return (
    <View style={[styles.tile, { width, height }]}>
      {/* Animated NFT avatar — always shown, jaw-drop + pulse when speaking */}
      <View style={styles.tileAvatarWrap}>
        <AnimatedNftAvatar
          uri={pfpUri}
          size={72}
          isSpeaking={participant.isSpeaking}
          fallbackName={displayName}
        />
      </View>

      {/* Bottom info bar */}
      <View style={styles.tileInfo}>
        <Text style={styles.tileName} numberOfLines={1}>
          {participant.isLocal ? `${displayName} (You)` : displayName}
        </Text>
        <View style={styles.tileIcons}>
          {participant.isMuted && <Text style={styles.tileIcon}>🔇</Text>}
          {participant.isCameraOff && <Text style={styles.tileIcon}>📷</Text>}
          {participant.isScreenSharing && <Text style={styles.tileIcon}>📺</Text>}
        </View>
      </View>
    </View>
  );
}

// ─── Grid layout calculator ──────────────────────────────────────────────────

function calcGrid(count: number, screenW: number, screenH: number): { cols: number; tileW: number; tileH: number } {
  if (count <= 1) return { cols: 1, tileW: screenW, tileH: screenH };
  if (count === 2) return { cols: 1, tileW: screenW, tileH: screenH / 2 };
  if (count <= 4) return { cols: 2, tileW: screenW / 2, tileH: screenH / 2 };
  if (count <= 6) return { cols: 2, tileW: screenW / 2, tileH: screenH / 3 };
  if (count <= 9) return { cols: 3, tileW: screenW / 3, tileH: screenH / 3 };
  // 10-15: scrollable 3-column grid
  return { cols: 3, tileW: screenW / 3, tileH: (screenW / 3) * 1.33 };
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function VideoRoomScreen() {
  const insets = useSafeAreaInsets();
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const params = useLocalSearchParams<{ token: string; isHost: string }>();

  const myInboxId = useAppStore(s => s.myInboxId);
  const username = useAppStore(s => s.username);

  const [state, setState] = useState<VideoRoomState>({
    participants: [],
    connectionState: 'disconnected' as any,
    localAudioMuted: false,
    localVideoMuted: false,
    isScreenSharing: false,
  });
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stickerTrayOpen, setStickerTrayOpen] = useState(false);

  // ── Connect on mount ────────────────────────────────────────────────────

  useEffect(() => {
    const token = params.token;
    if (!token) {
      setError('No token provided');
      setConnecting(false);
      return;
    }

    const unsub = addVideoStateListener(setState);

    // If already connected (user tapped PiP to re-expand), just re-subscribe
    if (getVideoRoom()) {
      setConnecting(false);
      return () => { unsub(); };
    }

    connectToVideoRoom(LK_URL, token, () => {
      // Disconnected callback (e.g. server kicked, network loss)
      useAppStore.getState().setIsInVideoCall(false);
      router.back();
    })
      .then(() => {
        setConnecting(false);
        useAppStore.getState().setIsInVideoCall(true);
      })
      .catch((err) => {
        if (__DEV__) console.error('[VideoRoom] Connect failed:', err);
        setError('Failed to connect to video room');
        setConnecting(false);
      });

    return () => {
      unsub();
    };
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleLeave = useCallback(async () => {
    await disconnectFromVideoRoom();
    useAppStore.getState().setIsInVideoCall(false);
    router.back();
  }, []);

  const handleToggleMic = useCallback(async () => {
    await toggleAudioMute();
  }, []);

  const handleToggleCamera = useCallback(async () => {
    await toggleVideoMute();
  }, []);

  const handleFlipCamera = useCallback(async () => {
    await toggleCamera();
  }, []);

  const handleScreenShare = useCallback(async () => {
    await toggleScreenShare();
  }, []);

  // ── Layout ──────────────────────────────────────────────────────────────

  const gridH = SCREEN_H - insets.top - insets.bottom - 80; // 80 = controls bar
  const { cols, tileW, tileH } = calcGrid(state.participants.length, SCREEN_W, gridH);
  const needsScroll = state.participants.length > 9;

  if (connecting) {
    return (
      <View style={[styles.container, styles.center]}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color="#0096C7" />
        <Text style={styles.connectingText}>Connecting to video room…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.center]}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.errorBtn} onPress={() => router.back()}>
          <Text style={styles.errorBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const gridContent = (
    <View style={styles.grid}>
      {state.participants.map((p) => (
        <VideoTile
          key={p.identity}
          participant={p}
          width={tileW}
          height={tileH}
        />
      ))}
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <View style={styles.headerInfo}>
          <View style={styles.liveBadge}>
            <Text style={styles.liveText}>LIVE</Text>
          </View>
          <Text style={styles.headerCount}>
            {state.participants.length} participant{state.participants.length !== 1 ? 's' : ''}
          </Text>
        </View>
        {/* Minimize — go back to chat, keep call running */}
        <Pressable
          style={({ pressed }) => [styles.minimizeBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.back()}
        >
          <Text style={styles.minimizeIcon}>⤡</Text>
        </Pressable>
      </View>

      {/* Video grid */}
      {needsScroll ? (
        <ScrollView style={styles.gridScroll}>{gridContent}</ScrollView>
      ) : (
        <View style={styles.gridWrap}>{gridContent}</View>
      )}

      {/* Floating sticker reaction animations */}
      <VideoReactionOverlay />

      {/* Sticker reaction tray — slides in above controls */}
      {stickerTrayOpen && (
        <VideoStickerTray
          senderName={username ?? 'Monke'}
          senderId={myInboxId ?? ''}
        />
      )}

      {/* Controls bar */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable
          style={[styles.controlBtn, state.localAudioMuted && styles.controlBtnMuted]}
          onPress={handleToggleMic}
        >
          <Text style={styles.controlIcon}>
            {state.localAudioMuted ? '🔇' : '🎤'}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.controlBtn, state.localVideoMuted && styles.controlBtnMuted]}
          onPress={handleToggleCamera}
        >
          <Text style={styles.controlIcon}>
            {state.localVideoMuted ? '📷' : '📹'}
          </Text>
        </Pressable>

        <Pressable style={styles.controlBtn} onPress={handleFlipCamera}>
          <Text style={styles.controlIcon}>🔄</Text>
        </Pressable>

        {/* Sticker reaction button */}
        <Pressable
          style={[styles.controlBtn, stickerTrayOpen && styles.controlBtnActive]}
          onPress={() => setStickerTrayOpen(prev => !prev)}
        >
          <Text style={styles.controlIcon}>🐵</Text>
        </Pressable>

        <Pressable
          style={[styles.controlBtn, state.isScreenSharing && styles.controlBtnActive]}
          onPress={handleScreenShare}
        >
          <Text style={styles.controlIcon}>📺</Text>
        </Pressable>

        <Pressable
          style={[styles.controlBtn, styles.controlBtnLeave]}
          onPress={handleLeave}
        >
          <Text style={styles.controlIcon}>📞</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectingText: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    color: '#fff',
    marginTop: 16,
  },
  errorText: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    color: '#ff4444',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  errorBtn: {
    marginTop: 16,
    backgroundColor: '#0096C7',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  errorBtnText: {
    fontFamily: FONTS.mono,
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },

  // Header
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  minimizeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  minimizeIcon: {
    fontSize: 16,
    color: '#fff',
  },
  liveBadge: {
    backgroundColor: '#ff4444',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
  },
  headerCount: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginLeft: 10,
  },

  // Grid
  gridWrap: {
    flex: 1,
  },
  gridScroll: {
    flex: 1,
  },
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    justifyContent: 'center',
  },

  // Tile
  tile: {
    position: 'relative',
    backgroundColor: '#111',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  tileAvatarWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileSpeakingBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 3,
    borderColor: '#22c55e',
    borderRadius: 0,
  },
  tileInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  tileName: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: '#fff',
    fontWeight: '600',
    flex: 1,
  },
  tileIcons: {
    flexDirection: 'row',
  },
  tileIcon: {
    fontSize: 12,
    marginLeft: 4,
  },

  // Controls
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 12,
    backgroundColor: 'rgba(0,0,0,0.8)',
    gap: 14,
  },
  controlBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlBtnMuted: {
    backgroundColor: 'rgba(255,68,68,0.3)',
  },
  controlBtnActive: {
    backgroundColor: 'rgba(0,150,199,0.4)',
  },
  controlBtnLeave: {
    backgroundColor: '#ff4444',
  },
  controlIcon: {
    fontSize: 22,
  },
});
