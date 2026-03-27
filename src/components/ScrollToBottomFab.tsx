/**
 * ScrollToBottomFab — Floating action button that appears when user scrolls up.
 *
 * Shows unread count badge. Taps scroll to bottom of chat.
 * Animated fade in/out.
 */

import React, { useRef, useEffect } from "react";
import { Pressable, Text, StyleSheet, Animated, View } from "react-native";
import * as Haptics from "expo-haptics";
import { THEME, FONTS } from "@/lib/constants";

interface ScrollToBottomFabProps {
  visible: boolean;
  unreadCount: number;
  onPress: () => void;
}

export function ScrollToBottomFab({ visible, unreadCount, onPress }: ScrollToBottomFabProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim, transform: [{ scale: fadeAnim }] }]} pointerEvents={visible ? "auto" : "none"}>
      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={handlePress}
      >
        <Text style={styles.arrow}>↓</Text>
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 80,
    right: 16,
    zIndex: 50,
  },
  fab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(108, 180, 238, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(108, 180, 238, 0.25)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#6CB4EE",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fabPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.9 }],
  },
  arrow: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: "#6CB4EE",
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "#EF4444",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "#fff",
    fontWeight: "700",
  },
});
