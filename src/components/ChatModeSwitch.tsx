/**
 * ChatModeSwitch
 *
 * Shared "Main Chat ↔ Genesis Chat" switcher for wallets that hold BOTH a
 * Saga Monke AND a Saga/Seeker Genesis Token. Two pieces, used together:
 *
 *  - ChatModeTabs: a small pill tab bar ("Main" / "Genesis") — tap to switch.
 *  - SwipeToSwitchChat: a gesture wrapper — horizontal swipe past a threshold
 *    also switches. Uses react-native-gesture-handler (already the app's
 *    gesture library — GestureHandlerRootView wraps the whole app in
 *    _layout.tsx) rather than adding a pager dependency; each screen is its
 *    own route (`/chat`, `/genesis-chat`), so "switching" is a router.replace,
 *    not a real paged view.
 *
 * Only rendered when the wallet is a dual holder (verified && isGenesisHolder) —
 * a Genesis-only holder never sees this (no Main Chat access at all), and a
 * Monke-only holder has nothing to switch to.
 */

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { router } from "expo-router";
import { THEME, FONTS } from "@/lib/constants";

export type ChatMode = "main" | "genesis";

const SWIPE_DISTANCE_THRESHOLD = 60;
const SWIPE_VELOCITY_THRESHOLD = 400;

export function switchChatMode(mode: ChatMode) {
  router.replace(mode === "main" ? "/chat" : "/genesis-chat");
}

interface TabsProps {
  active: ChatMode;
}

export function ChatModeTabs({ active }: TabsProps) {
  return (
    <View style={styles.tabRow}>
      <Pressable
        onPress={() => active !== "main" && switchChatMode("main")}
        style={[styles.tab, active === "main" && styles.tabActive]}
        hitSlop={6}
      >
        <Text style={[styles.tabText, active === "main" && styles.tabTextActive]}>Main</Text>
      </Pressable>
      <Pressable
        onPress={() => active !== "genesis" && switchChatMode("genesis")}
        style={[styles.tab, active === "genesis" && styles.tabActive]}
        hitSlop={6}
      >
        <Text style={[styles.tabText, active === "genesis" && styles.tabTextActive]}>Genesis</Text>
      </Pressable>
    </View>
  );
}

interface SwipeProps {
  /** The mode this screen currently is — determines which swipe direction is live. */
  from: ChatMode;
  /** Defaults true. Pass false for Monke-only/Genesis-only holders (nothing to switch to) —
   *  keeps this component mountable unconditionally rather than needing a wrapper ternary. */
  enabled?: boolean;
  children: React.ReactNode;
}

/** Swipe left on Main → Genesis. Swipe right on Genesis → Main. */
export function SwipeToSwitchChat({ from, enabled = true, children }: SwipeProps) {
  const target: ChatMode = from === "main" ? "genesis" : "main";

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX(from === "main" ? [-20, 1000] : [-1000, 20])
    .onEnd((e) => {
      const distanceOk = from === "main" ? e.translationX < -SWIPE_DISTANCE_THRESHOLD : e.translationX > SWIPE_DISTANCE_THRESHOLD;
      const velocityOk = from === "main" ? e.velocityX < -SWIPE_VELOCITY_THRESHOLD : e.velocityX > SWIPE_VELOCITY_THRESHOLD;
      if (distanceOk && velocityOk) switchChatMode(target);
    })
    .runOnJS(true);

  return (
    <GestureDetector gesture={pan}>
      <View style={{ flex: 1 }}>{children}</View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  tabRow: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 20,
    padding: 3,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 17,
  },
  tabActive: {
    backgroundColor: THEME.accent,
  },
  tabText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: THEME.textMuted,
  },
  tabTextActive: {
    color: "#000",
  },
});
