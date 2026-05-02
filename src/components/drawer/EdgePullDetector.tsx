/**
 * EdgePullDetector — invisible right-edge strip that opens the drawer on left-swipe.
 *
 * Fires onTrigger when the user swipes leftward from the right edge with clear
 * horizontal intent (|dx| > 60, |vx| > 100, |vx| > |vy|). Disabled when the
 * drawer is already open to avoid conflicting gestures.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";

const EDGE_WIDTH = 24;
const TRIGGER_DX = 60;
const MIN_VELOCITY = 100;

interface EdgePullDetectorProps {
  onTrigger: () => void;
  disabled?: boolean;
}

export function EdgePullDetector({ onTrigger, disabled }: EdgePullDetectorProps) {
  const pan = Gesture.Pan()
    .activeOffsetX(-10)
    .failOffsetY([-12, 12])
    .runOnJS(true)
    .onEnd((e) => {
      const dx = e.translationX;
      const vx = e.velocityX;
      const vy = e.velocityY;
      const horizontalIntent = Math.abs(vx) > Math.abs(vy) * 0.6;
      if (dx < -TRIGGER_DX && Math.abs(vx) > MIN_VELOCITY && horizontalIntent) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onTrigger();
      }
    })
    .enabled(!disabled);

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.strip} pointerEvents={disabled ? "none" : "auto"} />
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: EDGE_WIDTH,
    zIndex: 50,
  },
});
