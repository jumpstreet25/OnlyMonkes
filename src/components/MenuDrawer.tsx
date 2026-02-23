/**
 * MenuDrawer
 *
 * Slide-in drawer from the right side of the screen.
 * Lists available dApp side chats. Tapping a dApp:
 *   - If the dApp is installed → navigate to its chat
 *   - If not installed → open the dApp store to install it
 */

import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  Animated,
  Dimensions,
  Linking,
} from "react-native";
import { router } from "expo-router";
import { THEME, FONTS, DAPPS } from "@/lib/constants";

const SCREEN_WIDTH = Dimensions.get("window").width;
const DRAWER_WIDTH = SCREEN_WIDTH * 0.78;

interface MenuDrawerProps {
  visible: boolean;
  onClose: () => void;
}

async function isDAppInstalled(deepLink: string): Promise<boolean> {
  try {
    return await Linking.canOpenURL(deepLink);
  } catch {
    return false;
  }
}

export function MenuDrawer({ visible, onClose }: MenuDrawerProps) {
  const slideAnim = useRef(new Animated.Value(DRAWER_WIDTH)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 0 : DRAWER_WIDTH,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  const handleDAppPress = async (dapp: typeof DAPPS[number]) => {
    const installed = await isDAppInstalled(dapp.deepLink);

    if (!installed) {
      // Open dApp store / Play Store to install
      Linking.openURL(dapp.storeUrl);
      return;
    }

    onClose();
    // Navigate to the dApp's dedicated chat screen
    router.push({
      pathname: "/dapp-chat",
      params: { dappId: dapp.id },
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Dim overlay */}
      <Pressable style={styles.overlay} onPress={onClose} />

      {/* Drawer panel */}
      <Animated.View
        style={[styles.drawer, { transform: [{ translateX: slideAnim }] }]}
      >
        {/* Header */}
        <View style={styles.drawerHeader}>
          <Text style={styles.drawerTitle}>Community Chats</Text>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={10}>
            <Text style={styles.closeIcon}>✕</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>dApp Channels</Text>

        {DAPPS.map((dapp) => (
          <Pressable
            key={dapp.id}
            style={({ pressed }) => [
              styles.dappRow,
              pressed && styles.dappRowPressed,
            ]}
            onPress={() => handleDAppPress(dapp)}
          >
            <View style={styles.dappIcon}>
              <Text style={styles.dappIconText}>{dapp.icon}</Text>
            </View>
            <View style={styles.dappInfo}>
              <Text style={styles.dappName}>{dapp.name}</Text>
              <Text style={styles.dappDesc}>{dapp.description}</Text>
            </View>
            <Text style={styles.dappChevron}>›</Text>
          </Pressable>
        ))}

        <View style={styles.divider} />

        <Text style={styles.footerHint}>
          More dApp chats coming soon 🐒
        </Text>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  drawer: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: THEME.surfaceHigh,
    paddingTop: 56,
    paddingHorizontal: 20,
    borderLeftWidth: 1,
    borderLeftColor: THEME.border,
    shadowColor: "#000",
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 20,
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  drawerTitle: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: THEME.text,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: THEME.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: {
    fontSize: 14,
    color: THEME.textMuted,
  },

  sectionLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 12,
  },

  dappRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
    marginBottom: 10,
  },
  dappRowPressed: {
    backgroundColor: THEME.surfaceHigh,
    borderColor: THEME.accent + "44",
  },
  dappIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: THEME.surfaceHigh,
    borderWidth: 1,
    borderColor: THEME.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dappIconText: { fontSize: 22 },
  dappInfo: { flex: 1, gap: 3 },
  dappName: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: THEME.text,
  },
  dappDesc: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textMuted,
  },
  dappChevron: {
    fontSize: 20,
    color: THEME.textFaint,
  },

  divider: {
    height: 1,
    backgroundColor: THEME.border,
    marginVertical: 20,
  },

  footerHint: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textFaint,
    textAlign: "center",
  },
});
