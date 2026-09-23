/**
 * OnboardingCarousel
 *
 * Full-screen 6-slide explainer shown once on first launch.
 * AsyncStorage key "onboarding_carousel_seen_v1" persists the seen state.
 *
 * Slides:
 *   1. Welcome
 *   2. Community Chat
 *   3. AI Trading Bot
 *   4. Avatar Rooms & Video Calls
 *   5. Globe & Events
 *   6. Marketplace & Banana Shop
 */

import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  useWindowDimensions,
  Animated,
  type ViewToken,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { THEME, FONTS } from "@/lib/constants";

export const ONBOARDING_KEY = "onboarding_carousel_seen_v1";

export interface Slide {
  emoji: string;
  emojiBg: string;
  accentClr: string;
  title: string;
  subtitle: string;
  features: string;
  gradient: readonly [string, string];
}

/**
 * Visual-only (non-translatable) half of the default slide set — title/
 * subtitle/features live in locales/{en,es}.json under onboardingCarousel.
 * slides, merged in by index at render time (see useMemo below). Custom
 * `slides` passed via props (e.g. GenesisChatScreen's own FOMO slides)
 * bypass this and are not yet translated — a separate follow-up.
 */
const SLIDE_VISUALS: readonly Omit<Slide, "title" | "subtitle" | "features">[] = [
  { emoji: "🐒", emojiBg: "#FFD70022", accentClr: "#FFD700", gradient: ["#1a1200", "#0a0a14"] },
  { emoji: "💬", emojiBg: "#6CB4EE22", accentClr: "#6CB4EE", gradient: ["#0a1420", "#0a0a14"] },
  { emoji: "🤖", emojiBg: "#9c7cff22", accentClr: "#9c7cff", gradient: ["#100a1e", "#0a0a14"] },
  { emoji: "📈", emojiBg: "#44ff8822", accentClr: "#44ff88", gradient: ["#001410", "#0a0a14"] },
  { emoji: "🎭", emojiBg: "#FF6B6B22", accentClr: "#FF6B6B", gradient: ["#1a0a0a", "#0a0a14"] },
  { emoji: "🌍", emojiBg: "#44ff8822", accentClr: "#44ff88", gradient: ["#001410", "#0a0a14"] },
  { emoji: "🍌", emojiBg: "#FFD54F22", accentClr: "#FFD54F", gradient: ["#1a1400", "#0a0a14"] },
];

interface Props {
  onDone: () => void;
  onLoginNow: () => void;
  /** Defaults to the pre-login slides above — pass a different set (e.g.
   *  Genesis Chat's FOMO slides) to reuse this same carousel shell. */
  slides?: Slide[];
  /** Text for the CTA button on the final slide. Defaults to the translated "Login now" copy. */
  finalCtaLabel?: string;
}

export function OnboardingCarousel({ onDone, onLoginNow, slides: slidesProp, finalCtaLabel }: Props) {
  const { t } = useTranslation();
  const defaultSlides = useMemo<Slide[]>(() => {
    const text = t("onboardingCarousel.slides", { returnObjects: true }) as
      Pick<Slide, "title" | "subtitle" | "features">[];
    return SLIDE_VISUALS.map((visual, i) => ({ ...visual, ...text[i] }));
  }, [t]);
  const slides = slidesProp ?? defaultSlides;

  const { width } = useWindowDimensions();
  const flatListRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);

  // Floating animation for the emoji
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -10,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, []);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setIndex(viewableItems[0].index);
      }
    },
    [],
  );

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const handleNext = () => {
    if (index < slides.length - 1) {
      const next = index + 1;
      flatListRef.current?.scrollToIndex({ index: next, animated: true });
    } else {
      handleDone();
    }
  };

  const handleDone = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "1").catch(() => {});
    onDone();
  };

  const handleLoginNow = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "1").catch(() => {});
    onLoginNow();
  };

  const slide = slides[index];
  const isLast = index === slides.length - 1;

  const renderItem = ({ item, index: i }: { item: Slide; index: number }) => (
    <View style={[styles.slide, { width }]}>
      <Animated.View
        style={[
          styles.emojiOrb,
          {
            backgroundColor: item.emojiBg,
            transform: [{ translateY: i === index ? floatAnim : 0 }],
          },
        ]}
      >
        <Text style={styles.emoji}>{item.emoji}</Text>
      </Animated.View>

      <View style={[styles.accentLine, { backgroundColor: item.accentClr }]} />

      <Text style={[styles.title, { color: item.accentClr }]}>{item.title}</Text>
      <Text style={styles.subtitle}>{item.subtitle}</Text>
      <Text style={styles.features}>{item.features}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Background gradient (updates per slide) */}
      <LinearGradient
        colors={[...slide.gradient]}
        style={StyleSheet.absoluteFill}
      />

      {/* Skip button — top right */}
      {!isLast && (
        <Pressable style={styles.skipTop} onPress={handleDone} hitSlop={12}>
          <Text style={styles.skipTopText}>{t("onboardingCarousel.skip")}</Text>
        </Pressable>
      )}

      {/* Slides */}
      <FlatList
        ref={flatListRef}
        data={slides}
        renderItem={renderItem}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, i) => ({
          length: width,
          offset: width * i,
          index: i,
        })}
        style={{ flex: 1 }}
      />

      {/* Bottom controls */}
      <View style={styles.footer}>
        {/* Dot indicators */}
        <View style={styles.dots}>
          {slides.map((_, i) => (
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

        {/* Next / Let's Go! */}
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
              {isLast ? t("onboardingCarousel.letsGo") : t("onboardingCarousel.next")}
            </Text>
          </LinearGradient>
        </Pressable>

        {/* Last slide only: skip straight to wallet connect, pitching the
            welcome bonus as the hook. Delegates entirely to the callback —
            no wallet logic here, that lives in ConnectScreen. */}
        {isLast && (
          <Pressable
            style={({ pressed }) => [styles.loginNowBtn, pressed && { opacity: 0.7 }]}
            onPress={handleLoginNow}
          >
            <Text style={styles.loginNowText}>{finalCtaLabel ?? t("onboardingCarousel.loginNow")}</Text>
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

  skipTop: {
    position: "absolute",
    top: 52,
    right: 20,
    zIndex: 110,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  skipTopText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.textMuted,
  },

  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
    gap: 16,
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
  subtitle: {
    fontFamily: FONTS.bodyMed,
    fontSize: 16,
    color: THEME.textMuted,
    textAlign: "center",
    lineHeight: 24,
  },
  features: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textDim,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 8,
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

  loginNowBtn: {
    paddingVertical: 10,
    alignItems: "center",
  },
  loginNowText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.gold,
    letterSpacing: 0.2,
  },
});
