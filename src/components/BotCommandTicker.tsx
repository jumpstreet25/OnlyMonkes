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

// Main chat commands — what the bot accepts in the OnlyMonkes group. DM-only
// commands (portfolio, hermes, automonke, etc.) live in DM_COMMANDS below.
const CHAT_COMMANDS: Command[] = [
  // Market intel
  { cmd: "/price $TOKEN", desc: "Live price" },
  { cmd: "/ta $TOKEN", desc: "Technical analysis" },
  { cmd: "/hottest", desc: "Top 10 by score" },
  { cmd: "/coldest", desc: "Contrarian watch" },
  { cmd: "/alerts", desc: "Recent TA signals" },
  // Watchlist
  { cmd: "/watchlist", desc: "Group watchlist" },
  { cmd: "/watch $TOKEN", desc: "Add to your watchlist" },
  { cmd: "/unwatch $TOKEN", desc: "Remove from watchlist" },
  { cmd: "/mywatchlist", desc: "Your watchlist" },
  // Trading (group emits Jupiter URL)
  { cmd: "/buy $TOKEN", desc: "Buy via Jupiter" },
  { cmd: "/sell $TOKEN", desc: "Sell via Jupiter" },
  { cmd: "/swap $A for $B", desc: "Swap tokens" },
  { cmd: "/tip @User", desc: "Tip $SKR" },
  // Meta
  { cmd: "/identity", desc: "Bot reputation" },
  { cmd: "/globe", desc: "Open the Monke Globe" },
  { cmd: "/help", desc: "All commands" },
  // Conversational
  { cmd: "@AI Agent #9385", desc: "Ask the bot anything" },
  { cmd: "APPROVE", desc: "Confirm pending trade" },
  { cmd: "REJECT", desc: "Cancel pending trade" },
];

// DM-only commands — bot DM thread. Includes trading-engine controls,
// per-user risk settings, Hermes memory queries, and reports. /buy /sell
// /swap execute via the user's hot wallet in DM (vs. emitting a URL in
// the group).
const DM_COMMANDS: Command[] = [
  // Quick intel
  { cmd: "/hottest", desc: "Top 10 by score" },
  { cmd: "/coldest", desc: "Contrarian watch" },
  { cmd: "/price $TOKEN", desc: "Live price" },
  { cmd: "/ta $TOKEN", desc: "Full TA analysis" },
  { cmd: "/whale $TOKEN", desc: "Whale activity" },
  { cmd: "/chart $TOKEN", desc: "TA chart image" },
  { cmd: "/compare $A $B", desc: "Side-by-side TA" },
  { cmd: "/backtest $TOKEN", desc: "Historical signals" },
  // Trading (DM executes via hot wallet, 3% on gains)
  { cmd: "/buy $TOKEN", desc: "Buy (bot executes)" },
  { cmd: "/sell $TOKEN", desc: "Sell (bot executes)" },
  { cmd: "/swap $A for $B", desc: "Swap (bot executes)" },
  { cmd: "/limit", desc: "Place a limit order" },
  { cmd: "/dca", desc: "Jupiter DCA setup" },
  // Portfolio & positions
  { cmd: "/portfolio", desc: "PNL + Hermes analysis" },
  { cmd: "/positions", desc: "Open trades" },
  // Reports (new 2026-05-20)
  { cmd: "/ratchet-report", desc: "Closed-trade outcomes since ratchet" },
  { cmd: "/smart-wallet-report", desc: "Per-wallet smart-money PnL" },
  // AutonoMonke (2026-09-03: was the misspelled "/automonke" — bot still
  // accepts that as a legacy alias, but this UI should surface the correct
  // canonical spelling)
  { cmd: "/autonomonke", desc: "Auto-trading status" },
  { cmd: "/autonomonke start", desc: "Enable auto-trading" },
  { cmd: "/autonomonke stop", desc: "Pause auto-trading" },
  { cmd: "/autonomonke positions", desc: "Auto positions" },
  { cmd: "/autonomonke fund", desc: "Deposit address" },
  { cmd: "/autonomonke withdraw", desc: "Close all & withdraw" },
  { cmd: "/autonomonke limits", desc: "Toggle Limit Orders" },
  // Risk management
  { cmd: "/risk", desc: "View risk settings" },
  { cmd: "/risk size 5", desc: "Position size %" },
  { cmd: "/risk stop 8", desc: "Stop-loss %" },
  { cmd: "/risk conviction 60", desc: "Min score to alert" },
  { cmd: "/risk blacklist $TOKEN", desc: "Block token" },
  // Hermes memory
  { cmd: "/hermes stats", desc: "Your trading stats" },
  { cmd: "/hermes best", desc: "Your best tokens" },
  { cmd: "/hermes worst", desc: "Your worst tokens" },
  { cmd: "/hermes achievements", desc: "Badges & streaks" },
  // Recovery & meta
  { cmd: "/reclaim", desc: "Restore profile on a new device" },
  { cmd: "/myid", desc: "Your XMTP inbox ID" },
  { cmd: "/help", desc: "All commands" },
  // Conversational
  { cmd: "Ask anything", desc: "Chat with Monke" },
  { cmd: "APPROVE", desc: "Confirm pending trade" },
  { cmd: "REJECT", desc: "Cancel pending trade" },
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
