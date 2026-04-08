/**
 * MonkeToolsModal
 *
 * Bottom-sheet-style modal opened by the 🔧 wrench button in the chat header.
 * Lists 6 Monke Tools alphabetically (each opens a browser link) plus
 * a notification settings section with ON/OFF and mentions-only toggles.
 */

import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  Switch,
  ScrollView,
  Alert,
  Platform,
  Dimensions,} from "react-native";
import * as Clipboard from "expo-clipboard";
import { toast } from "sonner-native";
import { GlassModal } from "@/components/GlassModal";
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { clearPushToken, registerForPushNotifications, scheduleTestNotification } from "@/lib/notifications";

interface MonkeToolsModalProps {
  visible: boolean;
  onClose: () => void;
}

// Alphabetical order
const TOOLS = [
  { name: "MonkeExplorer", url: "https://explorer.sagamonkes.com", icon: "🔭" },
  { name: "MonkeMerits",   url: "https://merits.sagamonkes.com",   icon: "🏆" },
  { name: "MonkeShop",     url: "https://shop.sagamonkes.com",     icon: "🛒" },
  { name: "MonkeSignal",   url: "https://signal.sagamonkes.com",   icon: "📡" },
  { name: "MonkeSnap",     url: "https://snap.sagamonkes.com",     icon: "📸" },
  { name: "MonkeSwap",     url: "https://swap.sagamonkes.com",     icon: "🔄" },
] as const;

export function MonkeToolsModal({ visible, onClose }: MonkeToolsModalProps) {
  const {
    notificationsEnabled, mentionsOnly, botNotificationsEnabled,
    setNotificationsEnabled, setMentionsOnly, setBotNotificationsEnabled,
    expoPushToken, setExpoPushToken,
  } = useAppStore();

  async function handleTestNotification() {
    // Schedule via Android AlarmManager — fires even if app is killed after swiping home
    await scheduleTestNotification();
    onClose();
  }

  async function handleRefreshToken() {
    await clearPushToken();
    const token = await registerForPushNotifications();
    if (token) {
      setExpoPushToken(token);
      Alert.alert("Token refreshed", token);
    } else {
      Alert.alert("Failed", "Could not get push token. Check notification permissions.");
    }
  }

  return (
    <GlassModal visible={visible} onClose={onClose} position="bottom" animationType="slide" cardStyle={{ height: Dimensions.get("window").height * 0.7 }}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🔧  Monke Tools</Text>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={10}>
            <Text style={styles.closeIcon}>✕</Text>
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Tools list */}
          <Text style={styles.sectionLabel}>Ecosystem</Text>

          {TOOLS.map((tool, idx) => (
            <Pressable
              key={tool.name}
              style={({ pressed }) => [
                styles.toolRow,
                pressed && styles.toolRowPressed,
                idx === TOOLS.length - 1 && styles.toolRowLast,
              ]}
              onPress={() => Linking.openURL(tool.url)}
            >
              <View style={styles.toolIconBox}>
                <Text style={styles.toolIcon}>{tool.icon}</Text>
              </View>
              <View style={styles.toolInfo}>
                <Text style={styles.toolName}>{tool.name}</Text>
                <Text style={styles.toolUrl}>
                  {tool.url.replace("https://", "")}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}

          {/* Notifications settings */}
          <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>
            Notifications
          </Text>

          {/* Android: direct link to fix popup/heads-up importance */}
          {Platform.OS === "android" && (
            <Pressable
              style={styles.fixBanner}
              onPress={() => Linking.openSettings()}
            >
              <Text style={styles.fixBannerIcon}>🔔</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.fixBannerTitle}>Not seeing popup alerts?</Text>
                <Text style={styles.fixBannerDesc}>
                  Tap to open Notification Settings → set importance to{" "}
                  <Text style={{ color: THEME.accent }}>Urgent</Text> for heads-up banners.
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}

          <View style={styles.settingsCard}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>Enable notifications</Text>
                <Text style={styles.settingDesc}>
                  Get notified for new messages in all chats
                </Text>
              </View>
              <Switch
                value={notificationsEnabled}
                onValueChange={setNotificationsEnabled}
                trackColor={{ false: THEME.border, true: THEME.accent + "88" }}
                thumbColor={notificationsEnabled ? THEME.accent : THEME.textFaint}
              />
            </View>

            <View style={styles.settingDivider} />

            <View style={[styles.settingRow, !notificationsEnabled && styles.settingRowDisabled]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>@Mentions only</Text>
                <Text style={styles.settingDesc}>
                  Only notify when someone @mentions your username
                </Text>
              </View>
              <Switch
                value={mentionsOnly}
                onValueChange={setMentionsOnly}
                disabled={!notificationsEnabled}
                trackColor={{ false: THEME.border, true: THEME.accent + "88" }}
                thumbColor={mentionsOnly ? THEME.accent : THEME.textFaint}
              />
            </View>

            <View style={styles.settingDivider} />

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>Bot notifications</Text>
                <Text style={styles.settingDesc}>
                  Alerts from AI Agent (trade signals, announcements)
                </Text>
              </View>
              <Switch
                value={botNotificationsEnabled}
                onValueChange={setBotNotificationsEnabled}
                trackColor={{ false: THEME.border, true: THEME.accent + "88" }}
                thumbColor={botNotificationsEnabled ? THEME.accent : THEME.textFaint}
              />
            </View>
          </View>

          {/* Push Token */}
          <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>
            Push Token
          </Text>
          <View style={styles.tokenCard}>
            <Text style={styles.tokenText} numberOfLines={2} selectable>
              {expoPushToken ?? "Not registered yet"}
            </Text>
            <View style={styles.tokenButtons}>
              {expoPushToken && (
                <Pressable
                  style={styles.tokenBtn}
                  onPress={async () => {
                    await Clipboard.setStringAsync(expoPushToken);
                    toast.success("Copied to clipboard");
                  }}
                >
                  <Text style={styles.tokenBtnText}>Copy</Text>
                </Pressable>
              )}
              <Pressable style={styles.tokenBtn} onPress={handleRefreshToken}>
                <Text style={styles.tokenBtnText}>Refresh</Text>
              </Pressable>
              <Pressable style={[styles.tokenBtn, { borderColor: THEME.accent }]} onPress={handleTestNotification}>
                <Text style={styles.tokenBtnText}>Test (press Home!)</Text>
              </Pressable>
            </View>
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    marginBottom: 4,
  },
  headerTitle: {
    fontFamily: FONTS.display,
    fontSize: 18,
    color: THEME.text,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: THEME.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: {
    fontSize: 13,
    color: THEME.textMuted,
  },

  sectionLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  sectionLabelSpaced: {
    marginTop: 24,
  },

  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    borderBottomWidth: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  toolRowLast: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  toolRowPressed: {
    backgroundColor: THEME.surfaceHigh,
  },
  toolIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: THEME.surfaceHigh,
    borderWidth: 1,
    borderColor: THEME.border,
    alignItems: "center",
    justifyContent: "center",
  },
  toolIcon: { fontSize: 20 },
  toolInfo: { flex: 1, gap: 2 },
  toolName: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: THEME.text,
  },
  toolUrl: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
  },
  chevron: {
    fontSize: 20,
    color: THEME.textFaint,
  },

  settingsCard: {
    backgroundColor: THEME.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  settingRowDisabled: { opacity: 0.4 },
  settingInfo: { flex: 1, gap: 3 },
  settingTitle: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.text,
  },
  settingDesc: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
    lineHeight: 16,
  },
  settingDivider: {
    height: 1,
    backgroundColor: THEME.border,
    marginHorizontal: 16,
  },

  fixBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: THEME.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.accent + "44",
    padding: 14,
    marginBottom: 10,
  },
  fixBannerIcon: { fontSize: 22 },
  fixBannerTitle: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: THEME.text,
    marginBottom: 2,
  },
  fixBannerDesc: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textMuted,
    lineHeight: 15,
  },

  tokenCard: {
    backgroundColor: THEME.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 14,
    gap: 10,
  },
  tokenText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textMuted,
    lineHeight: 16,
  },
  tokenButtons: {
    flexDirection: "row",
    gap: 8,
  },
  tokenBtn: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  tokenBtnText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 12,
    color: THEME.accent,
  },
});
