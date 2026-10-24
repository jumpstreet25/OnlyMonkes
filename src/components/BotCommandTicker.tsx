/**
 * BotCommandTicker
 *
 * Continuously scrolling horizontal ticker displaying bot commands from the
 * shared catalog (src/lib/botCommands.ts → config/bot-commands.json).
 * Two variants:
 *   - "chat" (default): main chat commands shown below the header
 *   - "dm": DM-only commands shown below the DM header
 *
 * In chat mode the ticker is inset to align with the header logo area
 * (left edge = past the PFP, right edge = before the menu buttons).
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Dimensions, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { FONTS, THEME } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { useBotCommands, commandsFor, commandDesc } from "@/lib/botCommands";

const SCREEN_W = Dimensions.get("window").width;
const SCROLL_SPEED = 40; // pixels per second
// Web: a CSS animation. The JS-driven Animated loop stalled there while the
// main thread was busy (XMTP sync) and restarted on every re-layout, so the
// ticker looked frozen. The browser runs this one on its own.
const IS_WEB = Platform.OS === "web";

interface Command {
  cmd: string;
  desc: string;
}

function buildTickerNodes(commands: Command[], keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  commands.forEach((c, i) => {
    if (i > 0) {
      nodes.push(
        <Text key={`${keyPrefix}-dot-${i}`} style={styles.dot}>{" ● "}</Text>
      );
    }
    nodes.push(
      <Text key={`${keyPrefix}-cmd-${i}`} style={styles.cmdText}>
        {c.cmd}
        <Text style={styles.descText}>{" " + c.desc}</Text>
      </Text>
    );
  });
  return nodes;
}

interface BotCommandTickerProps {
  variant?: "chat" | "dm";
}

export function BotCommandTicker({ variant = "chat" }: BotCommandTickerProps) {
  // Same catalog as the "/" suggestions and the bot's /help
  // (config/bot-commands.json). Subcommands stay out of the ticker
  // ("ticker": false); admin-only commands show for admins only.
  const { i18n } = useTranslation();
  const all = useBotCommands();
  const isGroupAdmin = useAppStore((s) => s.isGroupAdmin);
  const commands: Command[] = useMemo(
    () => commandsFor(all, variant, isGroupAdmin)
      .filter((c) => c.ticker !== false)
      .map((c) => ({ cmd: c.args ? `${c.cmd} ${c.args}` : c.cmd, desc: commandDesc(c, i18n.language) })),
    [all, variant, isGroupAdmin, i18n.language],
  );
  const scrollX = useRef(new Animated.Value(0)).current;
  const contentWidth = useRef(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const [webWidth, setWebWidth] = useState(0);

  const startScroll = (width: number) => {
    if (IS_WEB) return;
    if (animRef.current) animRef.current.stop();
    scrollX.setValue(0);

    const duration = (width / SCROLL_SPEED) * 1000;
    const anim = Animated.loop(
      Animated.timing(scrollX, {
        toValue: -width,
        duration,
        useNativeDriver: true,
        isInteraction: false,
      })
    );
    animRef.current = anim;
    anim.start();
  };

  useEffect(() => {
    // Kick off with estimated width; will recalibrate on layout
    startScroll(SCREEN_W * 3);
    return () => { if (animRef.current) animRef.current.stop(); };
  }, []);

  const handleLayout = (e: any) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - contentWidth.current) > 10) {
      contentWidth.current = w;
      startScroll(w);
    }
  };

  if (IS_WEB) {
    // Two identical copies (each ends with its separator), so moving the row
    // by -50% lands exactly where it started.
    const copy = (key: string) => (
      <View style={styles.textRow} onLayout={key === "a" ? (e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - webWidth) > 10) setWebWidth(w);
      } : undefined}>
        {buildTickerNodes(commands, key)}
        <Text style={styles.dot}>{" ● "}</Text>
      </View>
    );
    return (
      <View style={styles.container}>
        <View style={[styles.scrollRow, webWidth > 0 && [styles.webScroll, { animationDuration: `${webWidth / SCROLL_SPEED}s` } as any]]}>
          {copy("a")}
          {copy("b")}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.scrollRow,
          { transform: [{ translateX: scrollX }] },
        ]}
      >
        {/* First copy — measure its width */}
        <View style={styles.textRow} onLayout={handleLayout}>
          {buildTickerNodes(commands, "a")}
        </View>
        {/* Separator + second copy for seamless loop */}
        <Text style={styles.dot}>{" ● "}</Text>
        <View style={styles.textRow}>
          {buildTickerNodes(commands, "b")}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // react-native-web builds CSS keyframes only from StyleSheet.create.
  webScroll: {
    animationKeyframes: [{ "0%": { transform: "translateX(0%)" }, "100%": { transform: "translateX(-50%)" } }],
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  } as any,
  container: {
    overflow: "hidden",
    height: 18,
    justifyContent: "center",
  },
  scrollRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 18,
  },
  textRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cmdText: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: "#FFFFFF",
  },
  descText: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
  },
  dot: {
    fontSize: 5,
    color: "#6CB4EE",
  },
});
