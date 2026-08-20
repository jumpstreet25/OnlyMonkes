import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ImageBackground,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "@sbaiahmed1/react-native-blur";
import { THEME, FONTS, getWorldBarTint, chromeAccentColor } from "@/lib/constants";
import { getBlurProps } from "@/lib/glassTheme";
import { getLocatedUserCount, useProfileVersion } from "@/lib/userProfile";
import { markOnboardingStep } from "@/components/OnboardingChecklist";
import { BotCommandTicker } from "@/components/BotCommandTicker";
import { useAppStore } from "@/store/appStore";

// 2026-07-24: always-on glass — was themeSurface (#12121A, fully opaque)
// when no world is equipped, which hid the BlurView below completely.
// World tints (getWorldBarTint) were already translucent (0.30-0.38) and
// didn't need this treatment.
// 2026-08-07: 0.19 → 0.12 — slightly more transparent over chat (not much).
const HEADER_BG_NO_WORLD = "rgba(18, 18, 26, 0.12)";

// Exported so ChatScreen can position the header as an absolute overlay
// and pad the message list's scroll content to clear it — must match
// styles.header.height below exactly.
export const CHAT_HEADER_HEIGHT = 100;

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
  // World-aware transparency + per-world tint (v25 2026-05-08). When a
  // Chat World is equipped, header bg becomes a low-alpha tint matching
  // that world's dominant background palette — warm brown for Banana
  // Grove, cool purple for Cyberpunk, navy for Trading Floor — so the
  // bar visually integrates with the world's mood instead of being a
  // flat dark band on top of it. Falls back to themeSurface when no
  // world is set.
  const worldId = useAppStore((s) => s.shopStyles?.worldId) as string | undefined;
  const headerBg = worldId ? getWorldBarTint(worldId) : HEADER_BG_NO_WORLD;
  // Message pill color — same World/BananaShop precedence as every other
  // piece of chrome (ChatInput toolbar icons, bot channel icons): World
  // wins when equipped, else PFP Full Theme's NFT color, else default blue.
  const shopStyles = useAppStore((s) => s.shopStyles);
  const nftDominantColor = useAppStore((s) => s.nftDominantColor);
  const messagePillColor = chromeAccentColor(
    !!shopStyles?.pfpFullTheme,
    nftDominantColor,
    worldId,
  );
  // Status-bar safe-area padding lives INSIDE the header so the bg extends
  // edge-to-edge (behind the status bar) — keeps the world layer visible up
  // top and avoids a black themeBg gap above the chrome.
  const insets = useSafeAreaInsets();
  // 2026-08-06: globe count is derived from the local PROFILE_UPDATE cache
  // (not the live group roster). Without subscribing to profile-cache
  // version, the pill stayed stuck at whatever count was true on first
  // render (often 3 on a fresh/less-synced device) while another monke who
  // had accumulated more locations showed 18 — even after backfill finished.
  const profileVersion = useProfileVersion();
  const locatedCount = getLocatedUserCount();
  // Keep profileVersion in the dependency path so React treats it as used
  // (getLocatedUserCount re-reads the cache after each notify).
  void profileVersion;
  // @sbaiahmed1/react-native-blur's native view snapshots its target
  // synchronously on the very first Fabric layout commit — on cold start
  // that fires before the view tree is stable and crashes with
  // IndexOutOfBoundsException in eightbitlab.com.blurview.PreDrawBlurController
  // (upstream-documented: Dimezis/BlurView#176, "crashes on first launch,
  // fine on restart"). Skipping the BlurView for one render defers its
  // mount past that unstable first commit.
  const [blurReady, setBlurReady] = useState(false);
  useEffect(() => { setBlurReady(true); }, []);
  return (
    <View style={[styles.header, { borderBottomColor: themeBorder, paddingTop: insets.top }]}>
      {/* 2026-07-24: always-on glass — blurs the message list scrolling
          behind the header, world-equipped or not. */}
      {blurReady && (
        <BlurView {...getBlurProps()} style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]} />
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: headerBg }]} pointerEvents="none" />
      {/* Left: Globe with monke count */}
      <View style={styles.headerLeft}>
        <Pressable
          onPress={() => { markOnboardingStep("openedGlobe"); router.push("/globe" as any); }}
          style={styles.globeHeaderPill}
          hitSlop={8}
          accessibilityLabel="Open globe"
          accessibilityRole="button"
        >
          <Text style={styles.globeHeaderText}>🌍 {locatedCount}</Text>
        </Pressable>
      </View>

      {/* Center: decorative banner image */}
      <ImageBackground
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require("../../assets/header.png")}
        style={styles.headerCenter}
        resizeMode="contain"
      />

      {/* Right: banana pill opens the menu. DMs live next to MonkeTrades
          in the composer (Messages envelope). */}
      <View style={styles.headerRight}>
        <Pressable
          style={styles.bananaHeaderPill}
          onPress={onOpenDrawer}
          hitSlop={6}
          accessibilityLabel={`${bananaBalance} bananas, open menu`}
          accessibilityRole="button"
        >
          <Text style={styles.bananaHeaderText}>{bananaBalance} 🍌</Text>
          {(communityBadges.events + communityBadges.links) > 0 && (
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
    overflow: "hidden",
    // No borderBottom — design pass 2026-05-06 removed all horizontal
    // separator lines across the chat surface.
    // 2026-07-24: no backgroundColor here — was HEADER_BG (opaque), which
    // sat behind the BlurView and blocked it. Actual visible tint is the
    // separate headerBg View rendered on top of the blur.
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
  messageHeaderPill: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  messageHeaderText: {
    fontSize: 13,
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
