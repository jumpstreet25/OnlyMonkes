/**
 * VideoRoomBanner — pinned banner in ChatScreen when a video call is active.
 * Shows host PFP, participant count, Join/Leave buttons.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { THEME, FONTS } from '@/lib/constants';
import { getCachedProfile } from '@/lib/userProfile';
import type { VideoRoomData } from '@/lib/liveVideo';

interface VideoRoomBannerProps {
  room: VideoRoomData;
  isHost: boolean;
  isInCall: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onEnd: () => void;
}

export function VideoRoomBanner({
  room,
  isHost,
  isInCall,
  onJoin,
  onLeave,
  onEnd,
}: VideoRoomBannerProps) {
  const hostProfile = getCachedProfile(room.hostId);
  const hostPfp = hostProfile?.nftImage ?? null;

  return (
    <View style={styles.banner}>
      {/* Host PFP */}
      {hostPfp ? (
        <Image source={{ uri: hostPfp }} style={styles.pfp} />
      ) : (
        <View style={styles.pfpFallback}>
          <Text style={{ fontSize: 16 }}>🐒</Text>
        </View>
      )}

      {/* Info */}
      <View style={styles.info}>
        <View style={styles.liveRow}>
          <View style={styles.videoBadge}>
            <Text style={styles.videoText}>VIDEO</Text>
          </View>
          <Text style={styles.hostName}>{room.host}</Text>
        </View>
        <Text style={styles.subtitle}>
          Video call · max {room.maxParticipants}
        </Text>
      </View>

      {/* Actions */}
      {isInCall ? (
        <Pressable style={styles.leaveBtn} onPress={onLeave}>
          <Text style={styles.leaveBtnText}>Leave</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.joinBtn} onPress={onJoin}>
          <Text style={styles.joinBtnText}>Join</Text>
        </Pressable>
      )}

      {isHost && (
        <Pressable style={styles.endBtn} onPress={onEnd}>
          <Text style={styles.endBtnText}>End</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: THEME.surfaceHigh,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  pfp: {
    width: 36,
    height: 36,
    borderRadius: 10,
  },
  pfpFallback: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: THEME.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    marginLeft: 10,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  videoBadge: {
    backgroundColor: '#0096C7',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginRight: 6,
  },
  videoText: {
    fontFamily: FONTS.mono,
    fontSize: 8,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.8,
  },
  hostName: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    fontWeight: '700',
    color: THEME.text,
  },
  subtitle: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textMuted,
    marginTop: 1,
  },
  joinBtn: {
    backgroundColor: '#0096C7',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginLeft: 6,
  },
  joinBtnText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  leaveBtn: {
    backgroundColor: THEME.surfaceHigh,
    borderWidth: 1,
    borderColor: '#ff4444',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginLeft: 6,
  },
  leaveBtnText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    fontWeight: '700',
    color: '#ff4444',
  },
  endBtn: {
    backgroundColor: '#ff4444',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 6,
  },
  endBtnText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
});
