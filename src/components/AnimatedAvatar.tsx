/**
 * AnimatedAvatar — Face-tracking + audio-reactive NFT avatar with mouth overlays.
 *
 * Renders the user's NFT PFP with a transparent mouth sprite overlay on top.
 * When faceParams are available (camera-driven), head rotation + continuous mouth
 * openness drive the animation. Falls back to audio energy when face tracking
 * is unavailable.
 *
 * Idle:     Subtle breathing animation (scale 1.0 → 1.02, 3s loop)
 * Speaking: Scale pulse + green glow ring + mouth sprite cycles
 * Face:     Head tilt/nod/turn transforms + continuous mouth openness + eye squint
 */

import React, { useEffect, useMemo } from 'react';
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
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { THEME, FONTS } from '@/lib/constants';
import {
  type MouthTrait,
  getMouthSprite,
  MOUTH_OVERLAY_RECT,
} from '@/lib/mouthOverlays';
import { type FaceParams, type BlendshapeParams } from '@/lib/faceTracking';
import { SkiaAvatarOverlay } from './SkiaAvatarOverlay';

const AnimatedImage = Animated.createAnimatedComponent(Image);

function clamp(v: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, v));
}

interface AnimatedAvatarProps {
  pfpUri: string | null;
  mouthTrait: MouthTrait;
  audioEnergy: number;    // 0-1, drives mouth sprite selection (fallback)
  isSpeaking: boolean;    // drives glow/pulse animations
  size: number;
  fallbackName?: string;
  faceParams?: FaceParams | null; // camera-driven face tracking (overrides audioEnergy)
  blendshapes?: BlendshapeParams | null; // MediaPipe 22-blendshape data (overrides sprite overlay)
}

const GLOW_COLOR = '#22c55e';

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
  const hasBlendshapes = blendshapes != null;

  // Mouth overlay positioning (relative to container)
  const mouthStyle = useMemo(() => ({
    position: 'absolute' as const,
    top: size * MOUTH_OVERLAY_RECT.topPct,
    left: size * MOUTH_OVERLAY_RECT.leftPct,
    width: size * MOUTH_OVERLAY_RECT.widthPct,
    height: size * MOUTH_OVERLAY_RECT.heightPct,
  }), [size]);

  // Mouth sprite: use face openness when available, otherwise audio energy
  const effectiveEnergy = hasFace ? faceParams.mouthOpenness : audioEnergy;
  const mouthSpriteSource = getMouthSprite(mouthTrait, effectiveEnergy);

  // ── Shared values ──────────────────────────────────────────────────────────

  const breathScale = useSharedValue(1);
  const speakScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0);
  const glowScale = useSharedValue(1);

  // Face tracking values
  const headRotZ = useSharedValue(0);  // tilt
  const headRotY = useSharedValue(0);  // turn
  const headNodY = useSharedValue(0);  // nod (translateY)
  const eyeScale = useSharedValue(1);  // eye squint

  // ── Idle breathing ─────────────────────────────────────────────────────────

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

  // ── Speaking transitions ───────────────────────────────────────────────────

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

  // ── Face tracking transitions ──────────────────────────────────────────────

  useEffect(() => {
    if (hasFace) {
      headRotZ.value = withSpring(clamp(faceParams.headRotation.z, -15, 15), { damping: 14, stiffness: 120 });
      headRotY.value = withSpring(clamp(faceParams.headRotation.y, -20, 20), { damping: 14, stiffness: 120 });
      headNodY.value = withSpring(clamp(faceParams.headRotation.x * 0.3, -4, 4), { damping: 14, stiffness: 120 });
      // Eye squint: scale down slightly when eyes are closing
      const targetEyeScale = interpolate(faceParams.eyeOpenness, [0, 0.3, 1], [0.95, 1, 1]);
      eyeScale.value = withSpring(targetEyeScale, { damping: 15, stiffness: 150 });
    } else {
      // Reset to neutral when face tracking unavailable
      headRotZ.value = withSpring(0, { damping: 14, stiffness: 120 });
      headRotY.value = withSpring(0, { damping: 14, stiffness: 120 });
      headNodY.value = withSpring(0, { damping: 14, stiffness: 120 });
      eyeScale.value = withSpring(1, { damping: 15, stiffness: 150 });
    }
  }, [faceParams]);

  // ── Animated styles ────────────────────────────────────────────────────────

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

  // ── Fallback (no PFP) ─────────────────────────────────────────────────────

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

  // ── Main render (PFP + mouth overlay) ──────────────────────────────────────

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

        {/* Expression overlay: Skia canvas when blendshapes available, sprite fallback */}
        {hasBlendshapes ? (
          <SkiaAvatarOverlay blendshapes={blendshapes} size={size} />
        ) : (
          <Image
            source={mouthSpriteSource}
            style={mouthStyle}
            contentFit="contain"
          />
        )}
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
});
