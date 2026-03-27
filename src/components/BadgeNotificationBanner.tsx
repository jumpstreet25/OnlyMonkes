/**
 * BadgeNotificationBanner — Slides down from top when a badge is earned.
 *
 * Auto-dismisses after 4 seconds. Tappable to open badge details.
 * Animated entrance/exit with Reanimated-style spring.
 */

import React, { useEffect, useRef, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, Animated } from "react-native";
import * as Haptics from "expo-haptics";
import { THEME, FONTS } from "@/lib/constants";
import { shareBadgeEarned } from "@/lib/shareToX";
import type { Badge } from "@/lib/activityBadges";

interface BadgeNotificationBannerProps {
  badge: Badge | null;
  onDismiss: () => void;
}

export function BadgeNotificationBanner({ badge, onDismiss }: BadgeNotificationBannerProps) {
  const slideAnim = useRef(new Animated.Value(-120)).current;

  useEffect(() => {
    if (badge) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Slide in
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 80,
        friction: 10,
        useNativeDriver: true,
      }).start();

      // Auto-dismiss after 4 seconds
      const timer = setTimeout(() => {
        Animated.timing(slideAnim, {
          toValue: -120,
          duration: 300,
          useNativeDriver: true,
        }).start(() => onDismiss());
      }, 4000);

      return () => clearTimeout(timer);
    } else {
      slideAnim.setValue(-120);
    }
  }, [badge]);

  const handleTap = useCallback(() => {
    if (!badge) return;
    Animated.timing(slideAnim, {
      toValue: -120,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      shareBadgeEarned(badge.name, badge.emoji);
      onDismiss();
    });
  }, [badge, onDismiss]);

  if (!badge) return null;

  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}>
      <Pressable style={styles.content} onPress={handleTap}>
        <Text style={styles.emoji}>{badge.emoji}</Text>
        <View style={styles.textCol}>
          <Text style={styles.title}>Badge Earned!</Text>
          <Text style={styles.name}>{badge.name}</Text>
          <Text style={styles.hint}>Tap to share on X</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    paddingTop: 48,
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: "rgba(18, 18, 26, 0.95)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 213, 79, 0.2)",
    shadowColor: "#FFD54F",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 20,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  emoji: { fontSize: 36 },
  textCol: { flex: 1, gap: 2 },
  title: {
    fontFamily: FONTS.display,
    fontSize: 16,
    color: "#FFD54F",
  },
  name: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: THEME.text,
  },
  hint: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
  },
});
