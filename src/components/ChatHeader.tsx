import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ImageBackground,
} from "react-native";
import { router } from "expo-router";
import { THEME, FONTS } from "@/lib/constants";
import { getLocatedUserCount } from "@/lib/userProfile";
import { markOnboardingStep } from "@/components/OnboardingChecklist";
import { BotCommandTicker } from "@/components/BotCommandTicker";

const HEADER_BG = "rgba(10, 10, 15, 0.85)";

export interface ChatHeaderProps {
  themeSurface: string;
  themeBorder: string;
  bananaBalance: number;
  totalDmUnread: number;
  communityBadges: { events: number; links: number };
  isGroupMember: boolean;
  onOpenDrawer: () => void;
  onDmNavigation: () => void;
}

export function ChatHeader({
  themeSurface,
  themeBorder,
  bananaBalance,
  totalDmUnread,
  communityBadges,
  isGroupMember,
  onOpenDrawer,
  onDmNavigation,
}: ChatHeaderProps) {
  return (
    <View style={[styles.header, { backgroundColor: themeSurface, borderBottomColor: themeBorder }]}>
      {/* Left: Globe with monke count */}
      <View style={styles.headerLeft}>
        <Pressable
          onPress={() => { markOnboardingStep("openedGlobe"); router.push("/globe" as any); }}
          style={styles.globeHeaderPill}
          hitSlop={8}
          accessibilityLabel="Open globe"
          accessibilityRole="button"
        >
          <Text style={styles.globeHeaderText}>🌍 {getLocatedUserCount()}</Text>
        </Pressable>
      </View>

      {/* Center: decorative banner image */}
      <ImageBackground
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require("../../assets/header.png")}
        style={styles.headerCenter}
        resizeMode="contain"
      />

      {/* Right: banana pill — opens DMs if unread, otherwise opens drawer */}
      <View style={styles.headerRight}>
        <Pressable
          style={styles.bananaHeaderPill}
          onPress={() => {
            if (totalDmUnread > 0) {
              onDmNavigation();
            } else {
              onOpenDrawer();
            }
          }}
          hitSlop={6}
          accessibilityLabel={totalDmUnread > 0 ? `${totalDmUnread} unread messages` : `${bananaBalance} bananas, open menu`}
          accessibilityRole="button"
        >
          <Text style={styles.bananaHeaderText}>{bananaBalance} 🍌</Text>
          {/* DM unread badge — shown above pill like bot channel alerts */}
          {totalDmUnread > 0 && (
            <View style={styles.communityBadge}>
              <Text style={styles.communityBadgeText}>
                {totalDmUnread > 99 ? "99+" : totalDmUnread}
              </Text>
            </View>
          )}
          {/* Other community badges (events, links) — shown when no DM unreads */}
          {totalDmUnread === 0 && (communityBadges.events + communityBadges.links) > 0 && (
            <View style={styles.communityBadge}>
              <Text style={styles.communityBadgeText}>
                {communityBadges.events + communityBadges.links}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Bot command ticker — overlaid at bottom of header, under the logo */}
      {isGroupMember && (
        <View style={styles.tickerWrap} pointerEvents="none">
          <BotCommandTicker />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    height: 100,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    backgroundColor: HEADER_BG,
  },
  tickerWrap: {
    position: "absolute",
    bottom: 2,
    left: 12,
    right: 12,
    height: 18,
    overflow: "hidden",
  },
  headerCenter: {
    flex: 1,
    height: 96,
    alignSelf: "center",
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: -8,
    transform: [{ scale: 1.35 }],
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    zIndex: 10,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    zIndex: 10,
  },
  globeHeaderPill: {
    backgroundColor: "rgba(108,180,238,0.1)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(108,180,238,0.15)",
  },
  globeHeaderText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: "#6CB4EE",
    fontWeight: "600",
  },
  bananaHeaderPill: {
    backgroundColor: "rgba(255,213,79,0.1)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(255,213,79,0.15)",
  },
  bananaHeaderText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: "#FFD54F",
    fontWeight: "600",
  },
  communityBadge: {
    position: "absolute" as const,
    top: -4,
    right: -6,
    backgroundColor: "#fff",
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: 4,
  },
  communityBadgeText: {
    color: "#0096C7",
    fontSize: 10,
    fontWeight: "700" as const,
  },
});
