/**
 * AnimatedNftAvatar — Audio-reactive NFT avatar for live rooms
 *
 * Idle:     Subtle breathing animation (scale 1.0 → 1.02, 3s loop)
 * Speaking: Scale pulse + "jaw drop" split-image effect + green glow ring
 *
 * The jaw-drop trick renders the NFT image twice in an overflow:hidden container:
 *   - Top copy: upper 65%, static
 *   - Bottom copy: lower 35%, translates down 3-4px when speaking
 * This creates a convincing mouth-open effect on any monkey face — zero cost.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  withSequence,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { THEME, FONTS } from '@/lib/constants';

const AnimatedImage = Animated.createAnimatedComponent(Image);

interface AnimatedNftAvatarProps {
  uri: string | null;
  size: number;
  isSpeaking: boolean;
  fallbackName?: string;
  /** Override the speaking ring color. Default: green (#22c55e). */
  ringColor?: string;
}

const SPLIT_RATIO = 0.65; // top 65%, bottom 35%
const JAW_DROP_PX = 3.5;  // how far the "jaw" drops
const DEFAULT_GLOW_COLOR = '#22c55e';

export function AnimatedNftAvatar({
  uri,
  size,
  isSpeaking,
  fallbackName,
  ringColor = DEFAULT_GLOW_COLOR,
}: AnimatedNftAvatarProps) {
  const radius = size / 2;
  const topH = size * SPLIT_RATIO;
  const bottomH = size * (1 - SPLIT_RATIO);

  // ── Shared values ──────────────────────────────────────────────────────────

  const breathScale = useSharedValue(1);
  const speakScale = useSharedValue(1);
  const jawDrop = useSharedValue(0);
  const glowOpacity = useSharedValue(0);
  const glowScale = useSharedValue(1);

  // ── Idle breathing ─────────────────────────────────────────────────────────

  useEffect(() => {
    breathScale.value = withRepeat(
      withSequence(
        withTiming(1.02, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(1.0, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1, // infinite
      false,
    );
  }, []);

  // ── Speaking transitions ───────────────────────────────────────────────────

  useEffect(() => {
    if (isSpeaking) {
      // Scale pulse loop
      speakScale.value = withRepeat(
        withSequence(
          withTiming(1.06, { duration: 100, easing: Easing.out(Easing.ease) }),
          withTiming(1.0, { duration: 100, easing: Easing.out(Easing.ease) }),
        ),
        -1,
        false,
      );

      // Jaw drop
      jawDrop.value = withSpring(JAW_DROP_PX, { damping: 12, stiffness: 200 });

      // Glow ring
      glowOpacity.value = withSpring(1, { damping: 15, stiffness: 150 });
      glowScale.value = withRepeat(
        withSequence(
          withTiming(1.12, { duration: 600, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.04, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      );
    } else {
      // Return to idle
      cancelAnimation(speakScale);
      speakScale.value = withSpring(1, { damping: 15, stiffness: 200 });
      jawDrop.value = withSpring(0, { damping: 12, stiffness: 200 });
      glowOpacity.value = withTiming(0, { duration: 300 });
      cancelAnimation(glowScale);
      glowScale.value = withSpring(1, { damping: 15, stiffness: 200 });
    }
  }, [isSpeaking]);

  // ── Animated styles ────────────────────────────────────────────────────────

  const containerStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: breathScale.value * speakScale.value },
    ],
  }));

  const jawStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: jawDrop.value }],
  }));

  const glowRingStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }));

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!uri) {
    // Fallback: letter initial
    return (
      <Animated.View style={[{ width: size, height: size }, containerStyle]}>
        {/* Glow ring */}
        <Animated.View
          style={[
            styles.glowRing,
            {
              width: size + 8,
              height: size + 8,
              borderRadius: (size + 8) / 2,
              top: -4,
              left: -4,
              borderColor: ringColor,
            },
            glowRingStyle,
          ]}
          pointerEvents="none"
        />
        <View
          style={[
            styles.fallback,
            { width: size, height: size, borderRadius: radius },
          ]}
        >
          <Animated.Text style={[styles.fallbackText, { fontSize: size * 0.4 }]}>
            {fallbackName?.[0]?.toUpperCase() ?? '?'}
          </Animated.Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[{ width: size, height: size }, containerStyle]}>
      {/* Glow ring behind avatar */}
      <Animated.View
        style={[
          styles.glowRing,
          {
            width: size + 8,
            height: size + 8,
            borderRadius: (size + 8) / 2,
            top: -4,
            left: -4,
            borderColor: ringColor,
          },
          glowRingStyle,
        ]}
        pointerEvents="none"
      />

      {/* Top portion — static */}
      <View
        style={[
          styles.splitClip,
          {
            width: size,
            height: topH,
            borderTopLeftRadius: radius,
            borderTopRightRadius: radius,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
          },
        ]}
      >
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          contentFit="cover"
        />
      </View>

      {/* Bottom portion — jaw drops when speaking */}
      <Animated.View
        style={[
          styles.splitClip,
          {
            width: size,
            height: bottomH,
            borderTopLeftRadius: 0,
            borderTopRightRadius: 0,
            borderBottomLeftRadius: radius,
            borderBottomRightRadius: radius,
          },
          jawStyle,
        ]}
      >
        <Image
          source={{ uri }}
          style={{ width: size, height: size, marginTop: -topH }}
          contentFit="cover"
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  splitClip: {
    overflow: 'hidden',
  },
  glowRing: {
    position: 'absolute',
    borderWidth: 2.5,
  },
  fallback: {
    backgroundColor: THEME.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: THEME.border,
  },
  fallbackText: {
    fontFamily: FONTS.display,
    color: THEME.text,
  },
});
