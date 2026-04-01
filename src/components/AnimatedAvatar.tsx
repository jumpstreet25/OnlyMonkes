/**
 * AnimatedAvatar — Face-tracking + audio-reactive NFT avatar with mouth overlays.
 *
 * Renders the user's NFT PFP with cross-fading mouth sprite overlays.
 * When faceParams are available (camera-driven), head rotation + continuous mouth
 * openness drive the animation. Falls back to audio energy when face tracking
 * is unavailable.
 *
 * Idle:     Subtle breathing (scale 1.0→1.02) + random blinks every 3-7s
 * Speaking: Scale pulse + green glow ring + smooth mouth sprite cross-fade
 * Face:     Head tilt/nod/turn + continuous mouth openness + eye squint
 */

import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  cancelAnimation,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { THEME, FONTS } from '@/lib/constants';
import {
  type MouthTrait,
  getCrossFadeSprites,
  MOUTH_OVERLAY_RECT,
} from '@/lib/mouthOverlays';
import { type FaceParams, type BlendshapeParams } from '@/lib/faceTracking';

function clamp(v: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, v));
}

interface AnimatedAvatarProps {
  pfpUri: string | null;
  mouthTrait: MouthTrait;
  audioEnergy: number;
  isSpeaking: boolean;
  size: number;
  fallbackName?: string;
  faceParams?: FaceParams | null;
  blendshapes?: BlendshapeParams | null;
}

const GLOW_COLOR = '#22c55e';

// ── Idle Blink Constants ────────────────────────────────────────────────────
const BLINK_MIN_MS = 3000;
const BLINK_MAX_MS = 7000;
const BLINK_DURATION_MS = 150;

// Eye region position (relative to PFP — calibrated for Saga Monkes)
const EYE_OVERLAY = {
  topPct: 0.38,
  leftPct: 0.22,
  widthPct: 0.56,
  heightPct: 0.12,
};

export const AnimatedAvatar = React.memo(function AnimatedAvatar({
  pfpUri,
  mouthTrait,
  audioEnergy,
  isSpeaking,
  size,
  fallbackName,
  faceParams,
  blendshapes,
}: AnimatedAvatarProps) {
  const radius = size / 2;
  const hasFace = faceParams != null;

  // ── Mouth overlay positioning ─────────────────────────────────────────────
  const mouthStyle = useMemo(() => ({
    position: 'absolute' as const,
    top: size * MOUTH_OVERLAY_RECT.topPct,
    left: size * MOUTH_OVERLAY_RECT.leftPct,
    width: size * MOUTH_OVERLAY_RECT.widthPct,
    height: size * MOUTH_OVERLAY_RECT.heightPct,
  }), [size]);

  // Cross-fade sprites: use face openness when available, otherwise audio energy
  const effectiveEnergy = hasFace ? faceParams.mouthOpenness : audioEnergy;
  const { spriteA, spriteB, blend } = getCrossFadeSprites(mouthTrait, effectiveEnergy);

  // ── Blink overlay positioning ─────────────────────────────────────────────
  const blinkStyle = useMemo(() => ({
    position: 'absolute' as const,
    top: size * EYE_OVERLAY.topPct,
    left: size * EYE_OVERLAY.leftPct,
    width: size * EYE_OVERLAY.widthPct,
    height: size * EYE_OVERLAY.heightPct,
    borderRadius: size * 0.02,
  }), [size]);

  // ── Shared values ─────────────────────────────────────────────────────────

  const breathScale = useSharedValue(1);
  const speakScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0);
  const glowScale = useSharedValue(1);

  // Face tracking values
  const headRotZ = useSharedValue(0);
  const headRotY = useSharedValue(0);
  const headNodY = useSharedValue(0);
  const eyeScale = useSharedValue(1);

  // Blink
  const blinkOpacity = useSharedValue(0);
  const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Idle breathing ────────────────────────────────────────────────────────

  useEffect(() => {
    breathScale.value = withRepeat(
      withSequence(
        withTiming(1.02, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(1.0, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);

  // ── Idle blink (random interval 3-7s) ─────────────────────────────────────

  const scheduleBlink = useCallback(() => {
    const delay = BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
    blinkTimerRef.current = setTimeout(() => {
      // Quick blink: fade in → hold → fade out
      blinkOpacity.value = withSequence(
        withTiming(1, { duration: BLINK_DURATION_MS / 2, easing: Easing.out(Easing.ease) }),
        withDelay(30, withTiming(0, { duration: BLINK_DURATION_MS / 2, easing: Easing.in(Easing.ease) })),
      );
      scheduleBlink();
    }, delay);
  }, []);

  useEffect(() => {
    scheduleBlink();
    return () => {
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
    };
  }, []);

  // ── Speaking transitions ──────────────────────────────────────────────────

  useEffect(() => {
    if (isSpeaking) {
      speakScale.value = withRepeat(
        withSequence(
          withTiming(1.06, { duration: 100, easing: Easing.out(Easing.ease) }),
          withTiming(1.0, { duration: 100, easing: Easing.out(Easing.ease) }),
        ),
        -1,
        false,
      );
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
      cancelAnimation(speakScale);
      speakScale.value = withSpring(1, { damping: 15, stiffness: 200 });
      glowOpacity.value = withTiming(0, { duration: 300 });
      cancelAnimation(glowScale);
      glowScale.value = withSpring(1, { damping: 15, stiffness: 200 });
    }
  }, [isSpeaking]);

  // ── Face tracking transitions ─────────────────────────────────────────────

  useEffect(() => {
    if (hasFace) {
      headRotZ.value = withSpring(clamp(faceParams.headRotation.z, -15, 15), { damping: 14, stiffness: 120 });
      headRotY.value = withSpring(clamp(faceParams.headRotation.y, -20, 20), { damping: 14, stiffness: 120 });
      headNodY.value = withSpring(clamp(faceParams.headRotation.x * 0.3, -4, 4), { damping: 14, stiffness: 120 });
      const targetEyeScale = interpolate(faceParams.eyeOpenness, [0, 0.3, 1], [0.95, 1, 1]);
      eyeScale.value = withSpring(targetEyeScale, { damping: 15, stiffness: 150 });
    } else {
      headRotZ.value = withSpring(0, { damping: 14, stiffness: 120 });
      headRotY.value = withSpring(0, { damping: 14, stiffness: 120 });
      headNodY.value = withSpring(0, { damping: 14, stiffness: 120 });
      eyeScale.value = withSpring(1, { damping: 15, stiffness: 150 });
    }
  }, [faceParams]);

  // ── Animated styles ───────────────────────────────────────────────────────

  const containerStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 300 },
      { translateY: headNodY.value },
      { scale: breathScale.value * speakScale.value * eyeScale.value },
      { rotateZ: `${headRotZ.value}deg` },
      { rotateY: `${headRotY.value}deg` },
    ],
  }));

  const glowRingStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }));

  const blinkAnimStyle = useAnimatedStyle(() => ({
    opacity: blinkOpacity.value,
  }));

  // ── Fallback (no PFP) ────────────────────────────────────────────────────

  if (!pfpUri) {
    return (
      <Animated.View style={[{ width: size, height: size }, containerStyle]}>
        <Animated.View
          style={[
            styles.glowRing,
            { width: size + 8, height: size + 8, borderRadius: (size + 8) / 2, top: -4, left: -4 },
            glowRingStyle,
          ]}
          pointerEvents="none"
        />
        <View style={[styles.fallback, { width: size, height: size, borderRadius: radius }]}>
          <Animated.Text style={[styles.fallbackText, { fontSize: size * 0.4 }]}>
            {fallbackName?.[0]?.toUpperCase() ?? '?'}
          </Animated.Text>
        </View>
      </Animated.View>
    );
  }

  // ── Main render (PFP + cross-fade mouth + idle blink) ─────────────────────

  return (
    <Animated.View style={[{ width: size, height: size }, containerStyle]}>
      {/* Glow ring behind avatar */}
      <Animated.View
        style={[
          styles.glowRing,
          { width: size + 8, height: size + 8, borderRadius: (size + 8) / 2, top: -4, left: -4 },
          glowRingStyle,
        ]}
        pointerEvents="none"
      />

      {/* NFT PFP (full image, circular) */}
      <View style={[styles.pfpContainer, { width: size, height: size, borderRadius: radius }]}>
        <Image
          source={{ uri: pfpUri }}
          style={{ width: size, height: size }}
          contentFit="cover"
          cachePolicy="disk"
        />

        {/* Cross-fading mouth sprites */}
        <Image
          source={spriteA}
          style={[mouthStyle, { opacity: 1 - blend }]}
          contentFit="contain"
        />
        {blend > 0.01 && (
          <Image
            source={spriteB}
            style={[mouthStyle, { opacity: blend }]}
            contentFit="contain"
          />
        )}

        {/* Idle blink overlay — skin-toned bar slides over eyes */}
        <Animated.View
          style={[blinkStyle, styles.blinkOverlay, blinkAnimStyle]}
          pointerEvents="none"
        />
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  pfpContainer: {
    overflow: 'hidden',
  },
  glowRing: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: GLOW_COLOR,
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
  blinkOverlay: {
    backgroundColor: 'rgba(90, 65, 45, 0.92)', // Saga Monke fur tone
  },
});
