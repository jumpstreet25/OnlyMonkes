/**
 * VideoCallPip — iOS-style floating picture-in-picture bubble for active video calls.
 *
 * Shown over the ChatScreen header when the user is in a video call but navigated
 * back to chat. Shows the active speaker's avatar/video indicator, participant count,
 * pulsing LIVE badge. Tap to expand back to full-screen VideoRoomScreen.
 *
 * Positioned absolutely over the header logo area, like a FaceTime PiP.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { Image } from 'expo-image';
import { FONTS } from '@/lib/constants';
import { getCachedProfile } from '@/lib/userProfile';
import {
  addVideoStateListener,
  getActiveSpeaker,
  type VideoRoomState,
  type VideoParticipant,
} from '@/lib/liveVideo';

interface VideoCallPipProps {
  onExpand: () => void;
}

export function VideoCallPip({ onExpand }: VideoCallPipProps) {
  const [participantCount, setParticipantCount] = useState(0);
  const [speaker, setSpeaker] = useState<VideoParticipant | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const speakerRing = useRef(new Animated.Value(0)).current;

  // Pulsing LIVE dot
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);

  // Subscribe to video room state
  useEffect(() => {
    const unsub = addVideoStateListener((state: VideoRoomState) => {
      setParticipantCount(state.participants.length);
      const active = getActiveSpeaker();
      setSpeaker(active);
    });
    return unsub;
  }, []);

  // Speaking ring animation
  useEffect(() => {
    if (speaker?.isSpeaking) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(speakerRing, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(speakerRing, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      speakerRing.setValue(0);
    }
  }, [speaker?.isSpeaking]);

  const profile = speaker ? getCachedProfile(speaker.identity) : null;
  const pfpUri = profile?.nftImage ?? null;
  const displayName = speaker?.name ?? '…';

  const ringScale = speakerRing.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.15],
  });

  return (
    <Pressable onPress={onExpand} style={styles.bubble}>
      {/* Speaker avatar with speaking ring */}
      <Animated.View style={[styles.avatarRing, { transform: [{ scale: ringScale }] }]}>
        {pfpUri ? (
          <Image source={{ uri: pfpUri }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarGlyph}>🐒</Text>
          </View>
        )}
      </Animated.View>

      {/* Info column */}
      <View style={styles.info}>
        <View style={styles.topRow}>
          <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
          <Text style={styles.liveLabel}>VIDEO</Text>
        </View>
        <Text style={styles.speakerName} numberOfLines={1}>{displayName}</Text>
        <Text style={styles.countText}>
          {participantCount} {participantCount === 1 ? 'Monke' : 'Monkes'}
        </Text>
      </View>

      {/* Expand chevron */}
      <Text style={styles.expandIcon}>⤢</Text>
    </Pressable>
  );
}

const BUBBLE_SIZE = 110;

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    top: 6,
    right: 12,
    zIndex: 60,
    width: BUBBLE_SIZE,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 10,
    borderWidth: 1.5,
    borderColor: '#0096C7',
  },
  avatarRing: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarGlyph: {
    fontSize: 22,
  },
  info: {
    marginTop: 4,
    alignItems: 'center',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#EF4444',
  },
  liveLabel: {
    fontFamily: FONTS.mono,
    fontSize: 7,
    fontWeight: '800',
    color: '#0096C7',
    letterSpacing: 1,
  },
  speakerName: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    fontWeight: '600',
    color: '#fff',
    marginTop: 1,
    maxWidth: 90,
    textAlign: 'center',
  },
  countText: {
    fontFamily: FONTS.mono,
    fontSize: 8,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 1,
  },
  expandIcon: {
    position: 'absolute',
    top: 4,
    right: 6,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
  },
});
