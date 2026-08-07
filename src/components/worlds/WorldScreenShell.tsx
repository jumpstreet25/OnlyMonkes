/**
 * WorldScreenShell — shared full-screen route chrome for secondary screens
 * (Settings, Portfolio, Watchlist, etc.).
 *
 * 2026-08-06: extracted from the DM/Chat WorldLayer + MonkeGlass header
 * pattern so every non-chat surface can show the equipped world instead of
 * a flat THEME.bg slab. Header gets BlurView + world tint when equipped;
 * cards underneath should use GLASS_BG (not opaque rgba(18,18,30,0.8)) so
 * the world shows through.
 */

import React from "react";
import { View, Text, StyleSheet, Pressable, StatusBar, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { THEME, FONTS, getWorldBarTint, getWorldAccent } from "@/lib/constants";
import { BUBBLE_GLASS_FILL, GLASS_BORDER } from "@/lib/glassTheme";
import { IS_IMMERSIVE_SHELL } from "@/lib/immersiveStatusBar";
import { useAppStore } from "@/store/appStore";
import { WorldLayer } from "@/components/worlds/WorldLayer";
import { WorldGlassFill } from "@/components/WorldGlassFill";

interface WorldScreenShellProps {
  title: string;
  onBack: () => void;
  /** Optional right-side header content (counts, actions). */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  style?: ViewStyle;
}

export function WorldScreenShell({ title, onBack, headerRight, children, style }: WorldScreenShellProps) {
  const insets = useSafeAreaInsets();
  const worldId = useAppStore((s) => s.shopStyles?.worldId) as string | undefined;

  return (
    <View style={[styles.root, worldId ? null : { backgroundColor: THEME.bg }, style]}>
      <StatusBar barStyle="light-content" hidden={IS_IMMERSIVE_SHELL} />
      {worldId ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <WorldLayer active={true} />
        </View>
      ) : null}

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        {worldId ? (
          <>
            <WorldGlassFill worldId={worldId} />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: getWorldBarTint(worldId) }]} pointerEvents="none" />
          </>
        ) : (
          <View
            style={[StyleSheet.absoluteFill, { borderBottomWidth: 0.75, borderBottomColor: "rgba(255,255,255,0.06)" }]}
            pointerEvents="none"
          />
        )}
        <Pressable onPress={onBack} hitSlop={8} style={styles.backHit}>
          <Text style={[styles.backText, worldId ? { color: getWorldAccent(worldId) } : null]}>← Back</Text>
        </Pressable>
        <Text style={[styles.headerTitle, worldId ? { color: getWorldAccent(worldId) } : null]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerRight}>{headerRight ?? <View style={{ width: 60 }} />}</View>
      </View>

      {children}
    </View>
  );
}

/**
 * Glass card fill for rows/tiles on world-aware screens.
 * Matches MainChat bubble fill (BUBBLE_GLASS_FILL) — pair with
 * <WorldGlassFill /> for real blur, or use alone as a transparent tint.
 */
export function useWorldGlassCardStyle(): ViewStyle {
  const worldId = useAppStore((s) => s.shopStyles?.worldId) as string | undefined;
  if (!worldId) {
    return {
      backgroundColor: "rgba(18,18,30,0.8)",
      borderColor: "rgba(255,255,255,0.06)",
    };
  }
  return {
    backgroundColor: "transparent",
    borderColor: GLASS_BORDER,
    overflow: "hidden" as const,
  };
}

export { BUBBLE_GLASS_FILL };

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    overflow: "hidden",
  },
  backHit: { minWidth: 60 },
  backText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: "#6CB4EE" },
  headerTitle: { fontFamily: FONTS.display, fontSize: 20, color: THEME.text, flex: 1, textAlign: "center" },
  headerRight: { minWidth: 60, alignItems: "flex-end" },
});
