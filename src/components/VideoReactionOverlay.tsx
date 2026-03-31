/**
 * VideoReactionOverlay — Floating sticker reactions that animate upward.
 *
 * When a participant sends a sticker reaction in the video call,
 * it floats up from the bottom-right with a fade-out + scale animation,
 * visible to all participants in real time via LiveKit data channel.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { addReactionListener as addVideoReactionListener, type VideoReaction } from '@/lib/liveVideo';

const { height: SCREEN_H } = Dimensions.get('window');
const MAX_VISIBLE = 8;
const REACTION_DURATION = 2500;

interface FloatingReaction extends VideoReaction {
  key: string;
  animY: Animated.Value;
  animOpacity: Animated.Value;
  animScale: Animated.Value;
  xOffset: number;
}

interface VideoReactionOverlayProps {
  /** Optional custom listener source (e.g., avatarRoom.addReactionListener). Defaults to liveVideo. */
  reactionSource?: (fn: (r: VideoReaction) => void) => () => void;
}

export function VideoReactionOverlay({ reactionSource }: VideoReactionOverlayProps = {}) {
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const keyRef = useRef(0);

  const spawnReaction = useCallback((reaction: VideoReaction) => {
    const key = `vr-${keyRef.current++}`;
    const animY = new Animated.Value(0);
    const animOpacity = new Animated.Value(1);
    const animScale = new Animated.Value(0.5);
    // Slight random horizontal offset so they don't stack
    const xOffset = Math.random() * 60 - 30;

    const floating: FloatingReaction = {
      ...reaction,
      key,
      animY,
      animOpacity,
      animScale,
      xOffset,
    };

    setReactions(prev => {
      const next = [...prev, floating];
      return next.length > MAX_VISIBLE ? next.slice(-MAX_VISIBLE) : next;
    });

    // Animate: scale up, float up, fade out
    Animated.parallel([
      Animated.timing(animScale, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(animY, {
        toValue: -(SCREEN_H * 0.35),
        duration: REACTION_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(animOpacity, {
        toValue: 0,
        duration: REACTION_DURATION,
        delay: 500,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setReactions(prev => prev.filter(r => r.key !== key));
    });
  }, []);

  useEffect(() => {
    const listenFn = reactionSource ?? addVideoReactionListener;
    const unsub = listenFn(spawnReaction);
    return unsub;
  }, [spawnReaction, reactionSource]);

  return (
    <View style={styles.container} pointerEvents="none">
      {reactions.map(r => (
        <Animated.View
          key={r.key}
          style={[
            styles.reaction,
            {
              transform: [
                { translateY: r.animY },
                { translateX: r.xOffset },
                { scale: r.animScale },
              ],
              opacity: r.animOpacity,
            },
          ]}
        >
          <Image source={{ uri: r.stickerUrl }} style={styles.sticker} />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  reaction: {
    position: 'absolute',
    bottom: 100,
    right: 30,
  },
  sticker: {
    width: 72,
    height: 72,
  },
});
