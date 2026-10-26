/**
 * AvatarRoomScreen — Full-screen animated avatar live room.
 *
 * 3D (default): every member's monke in one shared scene (MonkeRoomStage);
 * only talking members move. 2D: grid of AnimatedAvatar tiles (NFT PFPs with
 * mouth overlays driven by audio). No camera feeds — everyone is their Monke.
 *
 * Grid layout:
 *   1 = fullscreen    2 = 1×2 vertical
 *   3-4 = 2×2 grid   5-6 = 2×3 grid
 *   7-9 = 3×3 grid   10-15 = 3×5 scroll
 *
 * Controls: 🎤 Mute  🐵 Reactions  📞 Leave/End
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { showGlassAlert } from "@/lib/glassAlert";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { router } from 'expo-router';
import { ConnectionState } from 'livekit-client';
import { toast } from 'sonner-native';
import { BOT_INBOX_IDS, THEME, FONTS } from '@/lib/constants';
import { getXmtpClient } from '@/hooks/useXmtp';
import { callMonkeIntoRoom } from '@/lib/xmtp';
import { IS_IMMERSIVE_SHELL } from '@/lib/immersiveStatusBar';
import { LK_URL } from '@/lib/livekit';
import { getCachedProfile } from '@/lib/userProfile';
import { useAppStore } from '@/store/appStore';
import { AnimatedAvatar } from '@/components/AnimatedAvatar';
import { MonkeRoomStage, type MonkeRoomStageHandle } from '@/components/MonkeRoomStage';
import { PhoneLinkModal } from '@/components/PhoneLinkModal';
import { startPhoneLink, type PhoneLink } from '@/lib/phoneCompanion';
import { stageMembers } from '@/lib/roomStage';
import { captureError } from '@/lib/sentry';
import { monkeNumberFromImage, parseMonkeNumber } from '@/lib/monkeMeme/monkeNumbers';
import { DEFAULT_MOUTH_TRAIT, type MouthTrait, parseMouthTrait } from '@/lib/mouthOverlays';
import {
  connectToAvatarRoom,
  disconnectFromAvatarRoom,
  addAvatarStateListener,
  toggleMute,
  getMicProblem,
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

// The bot is AI Agent #9385, so on the 3D stage it's MONKE #9385.
const MONKE_BOT_NUMBER = 9385;

/** A blocked / missing mic joins muted; say why and how to fix it. */
function showMicProblem(onJoin: boolean): void {
  const p = getMicProblem();
  if (!p) return;
  const key = p === 'blocked' ? (Platform.OS === 'web' ? 'micBlockedWeb' : 'micBlockedPhone') : p === 'none' ? 'micNone' : p === 'busy' ? 'micBusy' : 'micError';
  showGlassAlert(i18n.t(onJoin ? 'avatarRoom.micJoinedMuted' : 'avatarRoom.micOffTitle'), i18n.t(`avatarRoom.${key}`));
}

function showRaidToast(raid: RaidResult | null): void {
  if (!raid?.granted) return;
  toast.success(
    raid.reason === 'host'
      ? i18n.t('avatarRoom.raidHost', { amount: raid.amount })
      : i18n.t('avatarRoom.raidShowedUp', { amount: raid.amount }),
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
  localPfp,
}: {
  participant: AvatarParticipant;
  width: number;
  height: number;
  localPfp: string | null;
}) {
  const profile = getCachedProfile(participant.identity);
  // Your own profile often isn't in the profile cache: use your verified monke.
  const pfpUri = (participant.isLocal ? localPfp : null) ?? profile?.nftImage ?? null;
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
  const { t } = useTranslation();
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
  const [show3d, setShow3d] = useState(true);
  const stageRef = useRef<MonkeRoomStageHandle>(null);
  // Web: a phone as this computer's mic + camera (src/lib/phoneCompanion.web.ts).
  const phoneLink = useRef<PhoneLink | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneUrl, setPhoneUrl] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneConnected, setPhoneConnected] = useState(false);

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
      .then(() => {
        setConnecting(false);
        showMicProblem(true);
      })
      .catch((err) => {
        setConnecting(false);
        // The real reason (LiveKit / browser error) — "could not join" alone can't be diagnosed.
        const detail = [err?.name, err?.message].filter(Boolean).join(': ').slice(0, 200);
        console.warn('[AvatarRoom] join failed:', err);
        showGlassAlert(t('avatarRoom.connectionFailed'), detail ? `${t('avatarRoom.couldNotJoinRoom')}\n\n${detail}` : t('avatarRoom.couldNotJoinRoom'));
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
    const muted = await toggleMute();
    if (muted) showMicProblem(false);
  }, []);

  const handleSendReaction = useCallback((stickerUrl: string) => {
    sendReaction(stickerUrl, username ?? 'Monke', myInboxId ?? '');
  }, [username, myInboxId]);

  const handleFaceParams = useCallback((params: FaceParams) => {
    sendFaceTrackingData(params);
  }, []);

  const localIdentity = state.participants.find(p => p.isLocal)?.identity;
  const handleBlendshapes = useCallback((params: BlendshapeParams) => {
    sendBlendshapes(params);
    if (localIdentity) stageRef.current?.sendFace(localIdentity, params);
  }, [localIdentity]);
  const blendshapesRef = useRef(handleBlendshapes);
  blendshapesRef.current = handleBlendshapes;

  const handleUsePhone = useCallback(async () => {
    setPhoneOpen(true);
    if (phoneLink.current) return;
    const room = getAvatarRoom();
    if (!room) return;
    setPhoneError(null);
    try {
      phoneLink.current = await startPhoneLink({
        roomName: room.name,
        identity: room.localParticipant.identity,
        name: username ?? 'Monke',
        onFace: (params) => blendshapesRef.current(params),
        onPhone: setPhoneConnected,
      });
      setPhoneUrl(phoneLink.current.url);
    } catch (e) {
      setPhoneError((e as Error)?.message ?? t('avatarRoom.phoneFailed'));
    }
  }, [username, t]);

  // The 3D page didn't start: fall back to 2D and report why (it's otherwise just a dark screen).
  const handleStageFail = useCallback((reason: string) => {
    setShow3d(false);
    toast(t('avatarRoom.stage3dFailed'));
    captureError(new Error(`Avatar Room 3D stage failed: ${reason}`), { area: 'avatarRoom3d', reason });
  }, [t]);

  // Monke (the bot) joins by voice: Monke_Eliza agents/monke-voice. Anyone in the room can call him.
  const [callingMonke, setCallingMonke] = useState(false);
  const monkeHere = state.participants.some(p => BOT_INBOX_IDS.includes(p.identity));
  const handleCallMonke = useCallback(async () => {
    const roomName = activeRoom?.id;
    const client = getXmtpClient();
    if (!roomName || !client || callingMonke) return;
    setCallingMonke(true);
    try {
      await callMonkeIntoRoom(client, roomName);
      toast(t('avatarRoom.monkeCalling'));
    } catch {
      toast(t('avatarRoom.monkeCallFailed'));
    } finally {
      setTimeout(() => setCallingMonke(false), 20_000);
    }
  }, [activeRoom?.id, callingMonke, t]);

  const handleStopPhone = useCallback(() => {
    phoneLink.current?.stop();
    phoneLink.current = null;
    setPhoneUrl(null);
    setPhoneConnected(false);
    setPhoneOpen(false);
  }, []);
  useEffect(() => () => phoneLink.current?.stop(), []);

  // ── Layout ─────────────────────────────────────────────────────────────────

  const participants = state.participants;
  const allNfts = useAppStore(s => s.allNfts);
  // Your own monke: the verified NFT, else any Saga Monke you hold, else your cached profile.
  const ownNfts = verifiedNft ? [verifiedNft, ...allNfts] : allNfts;
  const myMonke = ownNfts.map(n => parseMonkeNumber(n.name) ?? monkeNumberFromImage(n.image)).find(n => n != null)
    ?? monkeNumberFromImage(myInboxId ? getCachedProfile(myInboxId)?.nftImage : null);
  const localPfp = ownNfts.find(n => n.image)?.image ?? (myInboxId ? getCachedProfile(myInboxId)?.nftImage ?? null : null);
  const members = useMemo(
    () => stageMembers(participants, (id, isLocal) => (isLocal ? myMonke : BOT_INBOX_IDS.includes(id) ? MONKE_BOT_NUMBER : monkeNumberFromImage(getCachedProfile(id)?.nftImage))),
    [participants, myMonke],
  );
  const gridH = SCREEN_H - insets.top - insets.bottom - 60 - 56; // header + controls
  const { cols, tileW, tileH } = calcGrid(participants.length, SCREEN_W, gridH);
  const needsScroll = participants.length > 9;

  // ── Loading state ──────────────────────────────────────────────────────────

  if (connecting) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" hidden={IS_IMMERSIVE_SHELL} />
        <ActivityIndicator size="large" color={THEME.accent} />
        <Text style={styles.loadingText}>{t('avatarRoom.joiningRoom')}</Text>
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

      {/* 3D stage or 2D grid */}
      {show3d ? (
        <MonkeRoomStage ref={stageRef} members={members} onFail={handleStageFail} />
      ) : (
      <GridWrapper style={styles.grid}>
        <View style={styles.gridInner}>
          {participants.map(p => (
            <AvatarTile
              key={p.identity}
              participant={p}
              width={tileW}
              height={tileH}
              localPfp={localPfp}
            />
          ))}
        </View>
      </GridWrapper>
      )}

      <PhoneLinkModal
        visible={phoneOpen}
        url={phoneUrl}
        error={phoneError}
        connected={phoneConnected}
        onClose={() => setPhoneOpen(false)}
        onStop={handleStopPhone}
      />

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

        {/* Web: phone as mic + camera */}
        {Platform.OS === 'web' && (
          <Pressable
            onPress={handleUsePhone}
            style={[styles.controlBtn, phoneConnected && styles.controlBtnActive]}
            accessibilityRole="button"
            accessibilityLabel={t('avatarRoom.phoneTitle')}
          >
            <Text style={styles.controlIcon}>📱</Text>
          </Pressable>
        )}
        {/* 3D stage / 2D tiles */}
        <Pressable
          onPress={() => setShow3d(v => !v)}
          style={[styles.controlBtn, show3d && styles.controlBtnActive]}
          accessibilityRole="button"
          accessibilityLabel={show3d ? 'Show 2D avatars' : 'Show 3D monkes'}
        >
          <Text style={styles.controlLabel}>{show3d ? '3D' : '2D'}</Text>
        </Pressable>
        {/* Call Monke (the bot) in by voice */}
        {!monkeHere && (
          <Pressable
            onPress={handleCallMonke}
            disabled={callingMonke}
            style={[styles.controlBtn, callingMonke && styles.controlBtnActive]}
            accessibilityRole="button"
            accessibilityLabel={t('avatarRoom.monkeCall')}
          >
            <Text style={styles.controlIcon}>🤖</Text>
          </Pressable>
        )}
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
  controlLabel: {
    fontFamily: FONTS.display,
    fontSize: 15,
    color: THEME.text,
  },
});
