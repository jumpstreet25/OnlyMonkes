/**
 * ImageLightbox — fullscreen pinch-to-zoom image viewer with persistent watermark.
 *
 * Features:
 *   - Pinch-to-zoom (1x–5x) via Reanimated + GestureHandler
 *   - Double-tap to zoom in/out
 *   - Pan while zoomed
 *   - Swipe down to dismiss (when not zoomed)
 *   - Watermark overlay (bottom-right, stays proportional)
 *   - Save captures watermark via react-native-view-shot
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  Image,
  Alert,
  Dimensions,
  StyleSheet,
} from "react-native";
import { toast } from "sonner-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from "react-native-gesture-handler";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const MAX_SCALE = 5;
const MIN_SCALE = 1;

const getMediaLibrary = () => import("expo-media-library");
const getViewShot = () => import("react-native-view-shot");

interface Props {
  url: string | null;
  onClose: () => void;
}

export default function ImageLightbox({ url, onClose }: Props) {
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const captureRef = useRef<any>(null);

  // Reset dimensions when URL changes
  useEffect(() => {
    if (!url) {
      setImgSize(null);
      return;
    }
    Image.getSize(
      url,
      (w, h) => setImgSize({ w, h }),
      () => setImgSize(null),
    );
  }, [url]);

  // ── Gesture state ──────────────────────────────────────────────────────────
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Reset transforms when URL changes
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [url]);

  // Compute fitted image dimensions
  const maxW = SCREEN_W;
  const maxH = SCREEN_H * 0.85;
  let fitW = maxW;
  let fitH = maxH;
  if (imgSize) {
    const imgRatio = imgSize.w / imgSize.h;
    const containerRatio = maxW / maxH;
    fitW = imgRatio > containerRatio ? maxW : maxH * imgRatio;
    fitH = imgRatio > containerRatio ? maxW / imgRatio : maxH;
  }

  const dismissLightbox = useCallback(() => {
    onClose();
  }, [onClose]);

  // ── Pinch gesture ──────────────────────────────────────────────────────────
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        savedScale.value = scale.value;
      }
    });

  // ── Pan gesture ────────────────────────────────────────────────────────────
  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(2)
    .onUpdate((e) => {
      if (savedScale.value > 1.05) {
        // Zoomed: pan the image
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      } else {
        // Not zoomed: vertical swipe = dismiss
        translateY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      if (savedScale.value > 1.05) {
        // Clamp pan to keep image on screen
        const maxPanX = (fitW * savedScale.value - SCREEN_W) / 2;
        const maxPanY = (fitH * savedScale.value - SCREEN_H) / 2;
        translateX.value = withTiming(
          Math.max(-Math.max(0, maxPanX), Math.min(Math.max(0, maxPanX), translateX.value)),
        );
        translateY.value = withTiming(
          Math.max(-Math.max(0, maxPanY), Math.min(Math.max(0, maxPanY), translateY.value)),
        );
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      } else {
        // Swipe down to dismiss (threshold: 120px or high velocity)
        if (e.translationY > 120 || e.velocityY > 800) {
          translateY.value = withTiming(SCREEN_H, { duration: 200 });
          runOnJS(dismissLightbox)();
        } else {
          translateY.value = withSpring(0);
        }
      }
    });

  // ── Double-tap gesture ─────────────────────────────────────────────────────
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1.05) {
        // Zoom out
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        // Zoom in to 2.5x
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
      }
    });

  // ── Single tap to close (when not zoomed) ──────────────────────────────────
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      if (savedScale.value <= 1.05) {
        runOnJS(dismissLightbox)();
      }
    });

  const composed = Gesture.Simultaneous(
    pinch,
    pan,
  );
  const allGestures = Gesture.Exclusive(doubleTap, singleTap, composed);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // ── Save handler ───────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const ML = await getMediaLibrary();
    const { status } = await ML.requestPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow gallery access to save images.");
      return;
    }
    try {
      const { captureRef: capture } = await getViewShot();
      const uri = await capture(captureRef, { format: "jpg", quality: 0.95 });
      await ML.saveToLibraryAsync(uri);
      // 2026-07-29: was Alert.alert — a native OS dialog that can't be
      // themed at all (shows as a plain grey box against the app's glass
      // UI). Matches the same save-to-gallery toast pattern already used
      // in PnLCardModal.tsx. "Permission needed" stays a native Alert —
      // same established precedent, rare one-time prompt.
      toast.success("Saved to gallery");
    } catch {
      toast.error("Could not save image.");
    }
  }, []);

  if (!url) return null;

  return (
    <Modal
      visible={!!url}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={s.root}>
        <GestureDetector gesture={allGestures}>
          <Animated.View style={[s.gestureContainer, animatedStyle]}>
            {/* Capturable view — watermark baked into screenshot */}
            <View
              ref={captureRef}
              collapsable={false}
              style={{ width: fitW, height: fitH }}
            >
              <Image
                source={{ uri: url }}
                style={s.image}
                resizeMode="contain"
              />
              {/* Watermark — persistent across all media */}
              <View style={s.watermarkWrap} pointerEvents="none">
                <Image
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  source={require("../../assets/watermark.png")}
                  style={s.watermarkImg}
                  resizeMode="contain"
                />
              </View>
            </View>
          </Animated.View>
        </GestureDetector>

        {/* Close button */}
        <Pressable onPress={onClose} style={s.closeBtn} hitSlop={10}>
          <Text style={s.closeTxt}>✕</Text>
        </Pressable>
        {/* Save button */}
        <Pressable onPress={handleSave} style={s.saveBtn} hitSlop={10}>
          <Text style={s.saveTxt}>⬇</Text>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  gestureContainer: {
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  watermarkWrap: {
    position: "absolute",
    bottom: 4,
    right: 0,
    opacity: 0.9,
  },
  watermarkImg: {
    width: 192,
    height: 96,
  },
  closeBtn: {
    position: "absolute",
    top: 52,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeTxt: { color: "#FFF", fontSize: 18, fontWeight: "bold" },
  saveBtn: {
    position: "absolute",
    top: 52,
    right: 62,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  saveTxt: { color: "#FFF", fontSize: 16 },
});
