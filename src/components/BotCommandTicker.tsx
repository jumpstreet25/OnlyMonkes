/**
 * BotCommandTicker
 *
 * Continuously scrolling horizontal ticker displaying bot commands.
 * Two variants:
 *   - "chat" (default): main chat commands shown below the header
 *   - "dm": DM-only commands shown below the DM header
 *
 * In chat mode the ticker is inset to align with the header logo area
 * (left edge = past the PFP, right edge = before the menu buttons).
 */

import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Dimensions } from "react-native";
import { FONTS, THEME } from "@/lib/constants";

const SCREEN_W = Dimensions.get("window").width;
const SCROLL_SPEED = 40; // pixels per second

interface Command {
  cmd: string;
  desc: string;
}

const CHAT_COMMANDS: Command[] = [
  { cmd: "/price $TOKEN", desc: "Live price" },
  { cmd: "/ta $TOKEN", desc: "Technical analysis" },
  { cmd: "/watchlist", desc: "Tracked tokens" },
  { cmd: "/alerts", desc: "Recent signals" },
  { cmd: "/sports", desc: "Betting edges" },
  { cmd: "/tip @User", desc: "Tip $SKR" },
  { cmd: "/buy $TOKEN", desc: "Buy via Jupiter" },
  { cmd: "/sell $TOKEN", desc: "Sell via Jupiter" },
  { cmd: "/swap $A for $B", desc: "Swap tokens" },
  { cmd: "@AI Agent #9385", desc: "Ask the bot anything" },
  { cmd: "APPROVE", desc: "Confirm trade" },
  { cmd: "REJECT", desc: "Cancel trade" },
  { cmd: "CONFIRM $TOKEN", desc: "Track position" },
  { cmd: "/help", desc: "All commands" },
];

const DM_COMMANDS: Command[] = [
  // AutonoMonke
  { cmd: "/automonke", desc: "Trading status" },
  { cmd: "/automonke start", desc: "Enable trading" },
  { cmd: "/automonke stop", desc: "Pause trading" },
  { cmd: "/automonke positions", desc: "Open trades" },
  { cmd: "/automonke history", desc: "Trade history" },
  { cmd: "/automonke size", desc: "Position size %" },
  { cmd: "/automonke confidence", desc: "Min AI confidence" },
  { cmd: "/automonke fund", desc: "Deposit address" },
  { cmd: "/automonke withdraw", desc: "Close all & withdraw" },
  { cmd: "/automonke max", desc: "Max wallet balance" },
  // Risk management
  { cmd: "/risk", desc: "View risk settings" },
  { cmd: "/risk size 5", desc: "Position size %" },
  { cmd: "/risk stop 8", desc: "Stop-loss %" },
  { cmd: "/risk max 40", desc: "Max exposure %" },
  { cmd: "/risk auto on", desc: "Auto partial sells" },
  { cmd: "/risk conviction 60", desc: "Min score to alert" },
  { cmd: "/risk blacklist $TOKEN", desc: "Block token" },
  // Trading
  { cmd: "/price $TOKEN", desc: "Live price" },
  { cmd: "/ta $TOKEN", desc: "Full TA analysis" },
  { cmd: "/buy $TOKEN", desc: "Buy via Jupiter" },
  { cmd: "/sell $TOKEN", desc: "Sell via Jupiter" },
  { cmd: "/portfolio", desc: "PNL & holdings" },
  // Hermes / AI
  { cmd: "/hermes", desc: "Hermes memory status" },
  { cmd: "/backtest $TOKEN", desc: "Historical signals" },
  // Predictions & Bets
  { cmd: "/predictions", desc: "Drift predictions" },
  { cmd: "/bets", desc: "Sports betting status" },
  // General
  { cmd: "Ask anything", desc: "Chat freely with the bot" },
  { cmd: "APPROVE", desc: "Confirm pending trade" },
  { cmd: "REJECT", desc: "Cancel pending trade" },
  { cmd: "/help", desc: "All commands" },
];

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
  const commands = variant === "dm" ? DM_COMMANDS : CHAT_COMMANDS;
  const scrollX = useRef(new Animated.Value(0)).current;
  const contentWidth = useRef(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const startScroll = (width: number) => {
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
