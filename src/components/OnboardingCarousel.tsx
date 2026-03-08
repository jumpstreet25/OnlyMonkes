/**
 * OnboardingCarousel
 *
 * Full-screen 3-slide explainer shown once on first launch.
 * AsyncStorage key "onboarding_v1" persists the seen state.
 *
 * Slides:
 *   1. Why only Saga Monkes?
 *   2. Privacy via XMTP
 *   3. Live rooms & tipping
 */

import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  useWindowDimensions,
  Animated,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { THEME, FONTS } from "@/lib/constants";

export const ONBOARDING_KEY = "onboarding_v1";

const SLIDES = [
  {
    emoji:    "🐒",
    emojiBg:  "#FFD70022",
    accentClr:"#FFD700",
    title:    "Only Saga Monkes",
    body:     "The rarest club on Solana. Holder-only access — no bots, no tourists, just verified Monkes.",
    gradient: ["#1a1200", "#0a0a14"] as const,
  },
  {
    emoji:    "🔐",
    emojiBg:  "#7c5cfc22",
    accentClr:"#9c7cff",
    title:    "Private by Design",
    body:     "Messages encrypted end-to-end by XMTP. No phone number. No server. Your wallet is your identity.",
    gradient: ["#100a1e", "#0a0a14"] as const,
  },
  {
    emoji:    "🎙",
    emojiBg:  "#44ff8822",
    accentClr:"#44ff88",
    title:    "Live & Growing",
    body:     "Voice rooms, Monke-to-Monke SOL tips, AI trading signals. The alpha chat for Saga holders.",
    gradient: ["#001410", "#0a0a14"] as const,
  },
];

interface Props {
  onDone: () => void;
}

export function OnboardingCarousel({ onDone }: Props) {
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  // Floating animation for the emoji on each slide
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: -10, duration: 1200, useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0,   duration: 1200, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const handleNext = () => {
    if (index < SLIDES.length - 1) {
      const next = index + 1;
      scrollRef.current?.scrollTo({ x: next * width, animated: true });
      setIndex(next);
    } else {
      handleDone();
    }
  };

  const handleDone = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "1").catch(() => {});
    onDone();
  };

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  return (
    <View style={styles.container}>
      {/* Background gradient (updates per slide) */}
      <LinearGradient
        colors={[...slide.gradient]}
        style={StyleSheet.absoluteFill}
      />

      {/* Slides */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}   // manual only — prevents accidental swipe past "Get Started"
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {SLIDES.map((s, i) => (
          <View key={i} style={[styles.slide, { width }]}>
            {/* Emoji orb */}
            <Animated.View
              style={[
                styles.emojiOrb,
                { backgroundColor: s.emojiBg, transform: [{ translateY: i === index ? floatAnim : 0 }] },
              ]}
            >
              <Text style={styles.emoji}>{s.emoji}</Text>
            </Animated.View>

            {/* Accent line */}
            <View style={[styles.accentLine, { backgroundColor: s.accentClr }]} />

            <Text style={[styles.title, { color: s.accentClr }]}>{s.title}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Bottom controls */}
      <View style={styles.footer}>
        {/* Dot indicators */}
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === index
                  ? { backgroundColor: slide.accentClr, width: 20 }
                  : { backgroundColor: THEME.border },
              ]}
            />
          ))}
        </View>

        {/* Next / Get Started */}
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]}
          onPress={handleNext}
        >
          <LinearGradient
            colors={["#9c7cff", "#7c5cfc", "#5c3cec"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.btnGradient}
          >
            <Text style={styles.btnText}>
              {isLast ? "Let's Go 🐒" : "Next →"}
            </Text>
          </LinearGradient>
        </Pressable>

        {/* Skip */}
        {!isLast && (
          <Pressable onPress={handleDone} hitSlop={12}>
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    backgroundColor: THEME.bg,
  },

  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
    gap: 20,
  },

  emojiOrb: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emoji: { fontSize: 72 },

  accentLine: {
    width: 48,
    height: 3,
    borderRadius: 2,
  },

  title: {
    fontFamily: FONTS.display,
    fontSize: 26,
    textAlign: "center",
    letterSpacing: 0.3,
  },
  body: {
    fontFamily: FONTS.body,
    fontSize: 16,
    color: THEME.textMuted,
    textAlign: "center",
    lineHeight: 24,
  },

  footer: {
    paddingHorizontal: 32,
    paddingBottom: 56,
    gap: 16,
    alignItems: "center",
  },

  dots: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  dot: {
    height: 6,
    borderRadius: 3,
    width: 6,
  },

  btn: {
    alignSelf: "stretch",
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: THEME.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  btnGradient: {
    paddingVertical: 17,
    alignItems: "center",
  },
  btnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 17,
    color: "#fff",
    letterSpacing: 0.3,
  },

  skip: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textFaint,
  },
});
