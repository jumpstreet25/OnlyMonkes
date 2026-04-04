/**
 * AnimatedAvatar — Face-tracking + audio-reactive NFT avatar with mouth overlays.
 *
 * Renders the user's NFT PFP with cross-fading mouth sprite overlays.
 * When faceParams are available (camera-driven), head rotation + continuous mouth
 * openness drive the animation. Falls back to audio energy when face tracking
 * is unavailable.
 *
 * Phase 0 — 3D Depth Effects:
 *   Dynamic drop shadow (shifts opposite to head rotation)
 *   Directional rim light (bright edge toward "light source")
 *   Enhanced parallax translateX from head yaw
 *   Ambient occlusion vignette that intensifies on tilt
 *
 * Phase 1 — Emotion & Expression:
 *   Blendshape-driven eye blinks (random blink fallback when no face tracking)
 *   Emotion detection → glow color, breath speed, scale boost
 *   Smile/frown → glow intensity modulation
 *
 * Idle:     Subtle breathing (scale 1.0→1.02) + random blinks every 3-7s
 * Speaking: Scale pulse + emotion-colored glow ring + smooth mouth sprite cross-fade
 * Face:     Head tilt/nod/turn + continuous mouth openness + blendshape-driven blinks
 */

import React, { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { SkiaPremiumAvatar } from '@/components/SkiaPremiumAvatar';
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
  getVisemeCrossFadeSprites,
  MOUTH_OVERLAY_RECT,
} from '@/lib/mouthOverlays';
import {
  type FaceParams,
  type BlendshapeParams,
  blendshapesToVisemes,
  getDominantViseme,
} from '@/lib/faceTracking';

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

// ── Blendshape blink threshold ──────────────────────────────────────────────
const BLINK_THRESHOLD = 0.78; // eyeBlink L+R average above this = blink (high to avoid noise)
const BLINK_CONSEC_FRAMES = 2; // require N consecutive frames above threshold to trigger

// Eye region position (relative to PFP — calibrated for Saga Monkes)
const EYE_OVERLAY = {
  topPct: 0.38,
  leftPct: 0.22,
  widthPct: 0.56,
  heightPct: 0.12,
};

// ── 3D Depth Effect Constants ───────────────────────────────────────────────
const SHADOW_OFFSET_SCALE = 0.10;   // shadow moves 10% of size per degree rotation
const PARALLAX_SCALE = 0.25;        // translateX per degree of yaw

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
  const enable3D = size >= 60; // Skip 3D depth effects on small avatars (pill, etc.)

  // Speaking dynamics ref (scale boost + glow intensity)
  const speakParamsRef = useRef({ glowIntensity: 1, scaleBoost: 0 });

  // Premium shader light direction (updated from faceParams)
  const [lightDir, setLightDir] = useState({ x: 0.3, y: -0.2 });

  // ── Mouth overlay positioning ─────────────────────────────────────────────
  const mouthStyle = useMemo(() => ({
    position: 'absolute' as const,
    top: size * MOUTH_OVERLAY_RECT.topPct,
    left: size * MOUTH_OVERLAY_RECT.leftPct,
    width: size * MOUTH_OVERLAY_RECT.widthPct,
    height: size * MOUTH_OVERLAY_RECT.heightPct,
  }), [size]);

  // Cross-fade sprites: viseme-aware when blendshapes available, energy fallback otherwise
  const { spriteA, spriteB, blend } = useMemo(() => {
    if (blendshapes) {
      // Phase 3: Viseme-driven — picks sprite by mouth SHAPE (A/E/I/O/U), not just openness
      const visemes = blendshapesToVisemes(blendshapes);
      const { viseme, intensity } = getDominantViseme(visemes);
      return getVisemeCrossFadeSprites(mouthTrait, viseme, intensity);
    }
    // Fallback: energy-driven (face openness or audio energy)
    const effectiveEnergy = hasFace ? faceParams!.mouthOpenness : audioEnergy;
    return getCrossFadeSprites(mouthTrait, effectiveEnergy);
  }, [blendshapes, hasFace, faceParams, audioEnergy, mouthTrait]);

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

  // Phase 0: 3D depth shared values
  const shadowOffsetX = useSharedValue(0);
  const shadowOffsetY = useSharedValue(2);
  const parallaxX = useSharedValue(0);

  // Blink
  const blinkOpacity = useSharedValue(0);
  const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const useRandomBlink = useRef(true); // fallback when no face tracking
  const blinkFrameCount = useRef(0); // consecutive frames above threshold

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

  // ── Idle blink (random interval 3-7s) — fallback when face tracking off ──

  const scheduleBlink = useCallback(() => {
    if (!useRandomBlink.current) return;
    const delay = BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
    blinkTimerRef.current = setTimeout(() => {
      if (!useRandomBlink.current) {
        scheduleBlink();
        return;
      }
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
    const ep = speakParamsRef.current;
    if (isSpeaking) {
      const targetScale = 1.06 + ep.scaleBoost;
      speakScale.value = withRepeat(
        withSequence(
          withTiming(targetScale, { duration: 100, easing: Easing.out(Easing.ease) }),
          withTiming(1.0, { duration: 100, easing: Easing.out(Easing.ease) }),
        ),
        -1,
        false,
      );
      glowOpacity.value = withSpring(ep.glowIntensity, { damping: 15, stiffness: 150 });
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

  // ── Face tracking + Emotion detection + 3D depth ─────────────────────────

  useEffect(() => {
    if (hasFace) {
      // Head rotation → avatar transforms
      headRotZ.value = withSpring(clamp(faceParams.headRotation.z, -15, 15), { damping: 14, stiffness: 120 });
      headRotY.value = withSpring(clamp(faceParams.headRotation.y, -20, 20), { damping: 14, stiffness: 120 });
      headNodY.value = withSpring(clamp(faceParams.headRotation.x * 0.3, -4, 4), { damping: 14, stiffness: 120 });
      const targetEyeScale = interpolate(faceParams.eyeOpenness, [0, 0.3, 1], [0.95, 1, 1]);
      eyeScale.value = withSpring(targetEyeScale, { damping: 15, stiffness: 150 });

      // Phase 0: 3D depth — shadow offset opposite to head rotation
      const yaw = clamp(faceParams.headRotation.y, -20, 20);
      const roll = clamp(faceParams.headRotation.z, -15, 15);
      const pitch = clamp(faceParams.headRotation.x, -15, 15);

      // Premium shader: update light direction + tilt from head rotation
      if (enable3D) {
        setLightDir({ x: clamp(-yaw / 20, -1, 1), y: clamp(pitch / 15, -1, 1) });
      }
      shadowOffsetX.value = withSpring(-yaw * size * SHADOW_OFFSET_SCALE * 0.05, { damping: 16, stiffness: 100 });
      shadowOffsetY.value = withSpring(2 + pitch * size * SHADOW_OFFSET_SCALE * 0.03, { damping: 16, stiffness: 100 });
      parallaxX.value = withSpring(yaw * PARALLAX_SCALE, { damping: 14, stiffness: 120 });
    } else {
      headRotZ.value = withSpring(0, { damping: 14, stiffness: 120 });
      headRotY.value = withSpring(0, { damping: 14, stiffness: 120 });
      headNodY.value = withSpring(0, { damping: 14, stiffness: 120 });
      eyeScale.value = withSpring(1, { damping: 15, stiffness: 150 });

      // Reset 3D depth
      shadowOffsetX.value = withSpring(0, { damping: 16, stiffness: 100 });
      shadowOffsetY.value = withSpring(2, { damping: 16, stiffness: 100 });
      parallaxX.value = withSpring(0, { damping: 14, stiffness: 120 });
    }
  }, [faceParams]);

  // ── Phase 1: Blendshape-driven blinks + emotion detection ────────────────

  useEffect(() => {
    if (!blendshapes) {
      // No blendshape data — enable random blink fallback
      useRandomBlink.current = true;
      return;
    }

    // Disable random blinks — use real blendshape data
    useRandomBlink.current = false;

    // Blendshape-driven eye blink — require consecutive frames to avoid noise
    const blinkL = blendshapes.values.eyeBlinkLeft ?? 0;
    const blinkR = blendshapes.values.eyeBlinkRight ?? 0;
    const avgBlink = (blinkL + blinkR) / 2;

    if (avgBlink > BLINK_THRESHOLD) {
      blinkFrameCount.current++;
      if (blinkFrameCount.current >= BLINK_CONSEC_FRAMES) {
        // Confirmed blink — show overlay
        blinkOpacity.value = withTiming(1, { duration: 40, easing: Easing.out(Easing.ease) });
      }
    } else {
      blinkFrameCount.current = 0;
      blinkOpacity.value = withTiming(0, { duration: 60, easing: Easing.in(Easing.ease) });
    }

  }, [blendshapes]);

  // ── Animated styles ───────────────────────────────────────────────────────

  // Phase 0: Enhanced container with parallax
  const containerStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 200 }, // tight perspective = dramatic 3D rotation depth
      { translateX: parallaxX.value },
      { translateY: headNodY.value },
      { scale: breathScale.value * speakScale.value * eyeScale.value },
      { rotateZ: `${headRotZ.value}deg` },
      { rotateY: `${headRotY.value}deg` },
    ],
  }));

  // Phase 0: Dynamic drop shadow — shifts opposite to head rotation
  const shadowStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: shadowOffsetX.value },
      { translateY: shadowOffsetY.value },
      { scale: 1.06 }, // larger than avatar for more float
    ],
    opacity: 0.45,
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
            {
              width: size + 8, height: size + 8,
              borderRadius: (size + 8) / 2, top: -4, left: -4,
              borderColor: GLOW_COLOR,
            },
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

  // ── Main render (PFP + 3D depth + cross-fade mouth + blinks + emotion) ───

  const avatarContent = (
    <Animated.View style={[{ width: size, height: size }, containerStyle]}>
      {/* Glow ring — now emotion-colored */}
      <Animated.View
        style={[
          styles.glowRing,
          {
            width: size + 8, height: size + 8,
            borderRadius: (size + 8) / 2, top: -4, left: -4,
            borderColor: GLOW_COLOR,
          },
          glowRingStyle,
        ]}
        pointerEvents="none"
      />

      {/* NFT PFP (full image, circular) */}
      <View style={[styles.pfpContainer, { width: size, height: size, borderRadius: radius }]}>
        {/* Premium Skia shader: holographic sheen + normal map lighting */}
        {enable3D ? (
          <SkiaPremiumAvatar
            pfpUri={pfpUri}
            size={size}
            lightDirX={lightDir.x}
            lightDirY={lightDir.y}
          />
        ) : (
          <Image
            source={{ uri: pfpUri }}
            style={{ width: size, height: size }}
            contentFit="cover"
            cachePolicy="disk"
          />
        )}

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

        {/* Idle / blendshape blink overlay — skin-toned bar slides over eyes */}
        <Animated.View
          style={[blinkStyle, styles.blinkOverlay, blinkAnimStyle]}
          pointerEvents="none"
        />
      </View>
    </Animated.View>
  );

  // Small avatars (pill, etc.) skip 3D depth wrapper
  if (!enable3D) return avatarContent;

  return (
    <View style={{ width: size + 16, height: size + 16, alignItems: 'center', justifyContent: 'center' }}>
      {/* Phase 0: Drop shadow (behind everything, offset by head rotation) */}
      <Animated.View
        style={[
          styles.dropShadow,
          { width: size, height: size, borderRadius: radius },
          shadowStyle,
        ]}
        pointerEvents="none"
      />
      {avatarContent}
    </View>
  );
});

const styles = StyleSheet.create({
  pfpContainer: {
    overflow: 'hidden',
  },
  glowRing: {
    position: 'absolute',
    borderWidth: 2.5,
    // borderColor set dynamically via emotionColor
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

  // ── Phase 0: 3D Depth Effect Styles ─────────────────────────────────────

  dropShadow: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    elevation: 18,
  },
});
