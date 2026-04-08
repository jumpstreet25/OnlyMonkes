/**
 * ReactionPicker — Animated floating emoji pill
 *
 * 8 emojis with staggered spring entrance (Reanimated).
 * Selected emoji scales up before calling onPick.
 * Dark semi-transparent pill matching THEME.
 */

import React, { useCallback } from "react";
import { StyleSheet, Pressable } from "react-native";
import Animated, {
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import type { ReactionEmoji } from "@/types";

const EMOJIS: ReactionEmoji[] = [
  "👍", "❤️", "😂", "🔥", "🍌", "🐒", "💎", "🚀",
];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  onPick: (emoji: ReactionEmoji) => void;
  activeEmojis?: Set<string>;
}

function EmojiButton({
  emoji,
  index,
  isActive,
  onPick,
}: {
  emoji: ReactionEmoji;
  index: number;
  isActive: boolean;
  onPick: (emoji: ReactionEmoji) => void;
}) {
  const scale = useSharedValue(0);

  // Staggered spring entrance
  React.useEffect(() => {
    scale.value = withDelay(
      index * 35,
      withSpring(1, { damping: 12, stiffness: 180, mass: 0.8 })
    );
  }, []);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Pop up then call onPick
    scale.value = withSequence(
      withSpring(1.35, { damping: 8, stiffness: 300 }),
      withTiming(1, { duration: 150 }),
    );
    // Small delay so the user sees the pop animation
    setTimeout(() => onPick(emoji), 120);
  }, [emoji, onPick]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPress={handlePress}
      style={[
        styles.emojiBtn,
        isActive && styles.emojiBtnActive,
        animStyle,
      ]}
    >
      <Animated.Text style={styles.emojiText}>{emoji}</Animated.Text>
    </AnimatedPressable>
  );
}

export function ReactionPicker({ onPick, activeEmojis }: Props) {
  return (
    <Animated.View
      entering={SlideInDown.duration(200).springify().damping(16)}
      style={styles.pill}
    >
      {EMOJIS.map((emoji, i) => (
        <EmojiButton
          key={emoji}
          emoji={emoji}
          index={i}
          isActive={activeEmojis?.has(emoji) ?? false}
          onPick={onPick}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    backgroundColor: "rgba(18, 18, 32, 0.92)",
    borderRadius: 28,
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(248, 248, 255, 0.10)",
    shadowColor: "#6CB4EE",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  emojiBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  emojiBtnActive: {
    backgroundColor: "rgba(255,213,79,0.18)",
  },
  emojiText: {
    fontSize: 24,
  },
});
