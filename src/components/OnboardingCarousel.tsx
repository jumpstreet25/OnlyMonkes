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

import React, { useRef, useState, useEffect, useCallback } from "react";
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
import { THEME, FONTS } from "@/lib/constants";

export const ONBOARDING_KEY = "onboarding_carousel_seen_v1";

interface Slide {
  emoji: string;
  emojiBg: string;
  accentClr: string;
  title: string;
  subtitle: string;
  features: string;
  gradient: readonly [string, string];
}

const SLIDES: Slide[] = [
  {
    emoji: "\uD83D\uDC12",
    emojiBg: "#FFD70022",
    accentClr: "#FFD700",
    title: "Welcome to OnlyMonkes",
    subtitle: "The exclusive social hub for Saga Monkes NFT holders",
    features: "Swipe to learn what you can do",
    gradient: ["#1a1200", "#0a0a14"],
  },
  {
    emoji: "\uD83D\uDCAC",
    emojiBg: "#6CB4EE22",
    accentClr: "#6CB4EE",
    title: "Community Chat",
    subtitle: "E2E encrypted group chat with your fellow Monkes",
    features:
      "Send messages, GIFs, reactions, replies. @mention users. $TOKEN tickers are tappable.",
    gradient: ["#0a1420", "#0a0a14"],
  },
  {
    emoji: "\uD83E\uDD16",
    emojiBg: "#9c7cff22",
    accentClr: "#9c7cff",
    title: "AI Agent #9385",
    subtitle: "Your personal trading intelligence",
    features:
      "Real-time TA alerts in MonkeTrades. DM the bot for /limit orders, /dca, /hermes stats, /chart, and more.",
    gradient: ["#100a1e", "#0a0a14"],
  },
  {
    emoji: "\uD83D\uDCC8",
    emojiBg: "#44ff8822",
    accentClr: "#44ff88",
    title: "Top Traders",
    subtitle: "See who's actually winning",
    features:
      "A live leaderboard of Saga Monkes holders with the best trading track record \u2014 win rate and this week's gain %. Find it under the menu \u2192 Leaderboard.",
    gradient: ["#001410", "#0a0a14"],
  },
  {
    emoji: "\uD83C\uDFAD",
    emojiBg: "#FF6B6B22",
    accentClr: "#FF6B6B",
    title: "Avatar Rooms & Video Calls",
    subtitle: "Go live with animated NFT avatars or video",
    features:
      "Start an Avatar Room from the chat input. Your Saga Monke PFP comes alive with face tracking.",
    gradient: ["#1a0a0a", "#0a0a14"],
  },
  {
    emoji: "\uD83C\uDF0D",
    emojiBg: "#44ff8822",
    accentClr: "#44ff88",
    title: "Global Community",
    subtitle: "See where Monkes are worldwide",
    features:
      "3D globe shows member locations. Tap events to RSVP. Solana ecosystem events pulled from Lu.ma.",
    gradient: ["#001410", "#0a0a14"],
  },
  {
    emoji: "\uD83C\uDF4C",
    emojiBg: "#FFD54F22",
    accentClr: "#FFD54F",
    title: "Trade & Customize",
    subtitle: "P2P NFT marketplace + cosmetic shop",
    features:
      "List your Saga Monkes for sale. Earn bananas from daily rewards. Buy glow effects, themes, and PFP styles.",
    gradient: ["#1a1400", "#0a0a14"],
  },
];

interface Props {
  onDone: () => void;
}

export function OnboardingCarousel({ onDone }: Props) {
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
    if (index < SLIDES.length - 1) {
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

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

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
          <Text style={styles.skipTopText}>Skip</Text>
        </Pressable>
      )}

      {/* Slides */}
      <FlatList
        ref={flatListRef}
        data={SLIDES}
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
              {isLast ? "Let's Go!" : "Next"}
            </Text>
          </LinearGradient>
        </Pressable>
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
});
