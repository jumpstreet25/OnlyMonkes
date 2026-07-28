/**
 * OnboardingOverlay — 3-screen tutorial shown once after first login.
 *
 * Shows banana system, globe, and community features.
 * Awards 25 🍌 welcome bonus on completion.
 */

import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Dimensions,
} from "react-native";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { THEME, FONTS } from "@/lib/constants";
import { ONBOARDING_SCREENS } from "@/lib/monkeCopy";
import { MonkeGlass } from "@/components/MonkeGlass";

const AK_ONBOARDED = "onboarding_complete_v1";
const { width: SCREEN_W } = Dimensions.get("window");

interface OnboardingOverlayProps {
  visible: boolean;
  onComplete: (bananaBonus: number) => void;
}

export function OnboardingOverlay({ visible, onComplete }: OnboardingOverlayProps) {
  const [page, setPage] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const goNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (page < ONBOARDING_SCREENS.length - 1) {
      // Fade out → switch → fade in
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
        setPage(p => p + 1);
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      });
    } else {
      // Complete — award bonus
      AsyncStorage.setItem(AK_ONBOARDED, "true").catch(() => {});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onComplete(25); // 25 🍌 welcome bonus
    }
  };

  if (!visible) return null;
  const screen = ONBOARDING_SCREENS[page];

  return (
    <MonkeGlass visible onClose={() => {}} persistent cardStyle={styles.card}>
      <Animated.View style={{ opacity: fadeAnim, alignItems: "center", gap: 16 }}>
        <Text style={styles.emoji}>{screen.emoji}</Text>
        <Text style={styles.title}>{screen.title}</Text>
        <Text style={styles.body}>{screen.body}</Text>

        {/* Page dots */}
        <View style={styles.dots}>
          {ONBOARDING_SCREENS.map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>

        <Pressable
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          onPress={goNext}
        >
          <Text style={styles.btnText}>
            {page === ONBOARDING_SCREENS.length - 1 ? "Let's Go! 🍌" : "Next"}
          </Text>
        </Pressable>

        {page === ONBOARDING_SCREENS.length - 1 && (
          <Text style={styles.bonusHint}>+25 🍌 welcome bonus</Text>
        )}
      </Animated.View>
    </MonkeGlass>
  );
}

/** Check if onboarding has been completed. */
export async function hasCompletedOnboarding(): Promise<boolean> {
  const val = await AsyncStorage.getItem(AK_ONBOARDED).catch(() => null);
  return val === "true";
}

const styles = StyleSheet.create({
  card: {
    padding: 32,
    borderColor: "rgba(108, 180, 238, 0.25)",
    shadowColor: "#6CB4EE",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
    maxWidth: 340,
  },
  emoji: { fontSize: 56 },
  title: {
    fontFamily: FONTS.display,
    fontSize: 24,
    color: THEME.text,
    textAlign: "center",
  },
  body: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
    textAlign: "center",
    lineHeight: 22,
  },
  dots: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  dotActive: {
    backgroundColor: "#6CB4EE",
    width: 24,
  },
  btn: {
    backgroundColor: "#6CB4EE",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginTop: 8,
    shadowColor: "#6CB4EE",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  btnText: {
    fontFamily: FONTS.display,
    fontSize: 16,
    color: "#fff",
    letterSpacing: 0.3,
  },
  bonusHint: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: "#FFD54F",
  },
});
