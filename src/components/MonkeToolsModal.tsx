/**
 * MonkeToolsModal
 *
 * Bottom-sheet-style modal opened by the 🔧 wrench button in the chat header.
 * Lists 6 Monke Tools alphabetically (each opens a browser link) plus
 * a notification settings section with ON/OFF and mentions-only toggles.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  Linking,
  Switch,
  ScrollView,
  TextInput,
  Alert,
} from "react-native";
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { useXmtp } from "@/hooks/useXmtp";
import { CHAT_THEMES, saveThemeId, saveCustomColor } from "@/lib/theme";

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
    notificationsEnabled, mentionsOnly, setNotificationsEnabled, setMentionsOnly,
    isGroupMember, themeId, setThemeId, setCustomBubbleColor,
  } = useAppStore();
  const { addMember } = useXmtp();
  const [newMemberInboxId, setNewMemberInboxId] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [customHex, setCustomHex] = useState("");

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Dim overlay */}
      <Pressable style={styles.overlay} onPress={onClose} />

      {/* Sheet */}
      <View style={styles.sheet}>
        {/* Handle */}
        <View style={styles.handle} />

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
          </View>

          {/* Add Member — visible to existing group members */}
          {isGroupMember && (
            <>
              <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>
                Add Member
              </Text>
              <View style={styles.settingsCard}>
                <View style={styles.settingRow}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Member Inbox ID</Text>
                    <Text style={styles.settingDesc}>
                      Paste a tester's XMTP inbox ID to add them to the global chat
                    </Text>
                  </View>
                </View>
                <View style={styles.addMemberInputRow}>
                  <TextInput
                    style={styles.addMemberInput}
                    value={newMemberInboxId}
                    onChangeText={setNewMemberInboxId}
                    placeholder="Paste inbox ID here…"
                    placeholderTextColor={THEME.textFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <View style={styles.settingDivider} />
                <Pressable
                  style={({ pressed }) => [
                    styles.addMemberBtn,
                    pressed && { opacity: 0.75 },
                    (!newMemberInboxId.trim() || isAdding) && styles.addMemberBtnDisabled,
                  ]}
                  disabled={!newMemberInboxId.trim() || isAdding}
                  onPress={async () => {
                    setIsAdding(true);
                    try {
                      await addMember(newMemberInboxId);
                      setNewMemberInboxId("");
                      Alert.alert("✅ Added", "Member has been added to the chat.");
                    } catch (e: any) {
                      Alert.alert("Error", e?.message ?? "Failed to add member.");
                    } finally {
                      setIsAdding(false);
                    }
                  }}
                >
                  <Text style={styles.addMemberBtnText}>
                    {isAdding ? "Adding…" : "Add to Chat"}
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          {/* Chat Theme */}
          <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>
            Chat Bubble Theme
          </Text>
          <View style={styles.themeGrid}>
            {CHAT_THEMES.map((t) => (
              <Pressable
                key={t.id}
                style={[styles.themeSwatch, themeId === t.id && styles.themeSwatchSelected]}
                onPress={async () => {
                  setThemeId(t.id);
                  setCustomBubbleColor(null);
                  await saveThemeId(t.id);
                  await saveCustomColor("");
                }}
              >
                <View style={[styles.swatchDot, { backgroundColor: t.ownBubble }]} />
                <Text style={styles.swatchEmoji}>{t.emoji}</Text>
                <Text style={styles.swatchName} numberOfLines={1}>{t.name}</Text>
              </Pressable>
            ))}
          </View>

          {/* Custom hex color */}
          <View style={styles.settingsCard}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>Custom Bubble Color</Text>
                <Text style={styles.settingDesc}>Enter a hex color to match your NFT PFP</Text>
              </View>
            </View>
            <View style={styles.addMemberInputRow}>
              <TextInput
                style={styles.addMemberInput}
                value={customHex}
                onChangeText={setCustomHex}
                placeholder="#1D8CF5"
                placeholderTextColor={THEME.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={7}
              />
            </View>
            <View style={styles.settingDivider} />
            <Pressable
              style={({ pressed }) => [
                styles.addMemberBtn,
                pressed && { opacity: 0.75 },
                !customHex.trim() && styles.addMemberBtnDisabled,
              ]}
              disabled={!customHex.trim()}
              onPress={async () => {
                const hex = customHex.trim().startsWith("#")
                  ? customHex.trim()
                  : `#${customHex.trim()}`;
                setCustomBubbleColor(hex);
                await saveCustomColor(hex);
                setCustomHex("");
              }}
            >
              <Text style={styles.addMemberBtnText}>Apply Custom Color</Text>
            </Pressable>
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: THEME.surfaceHigh,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: THEME.border,
    paddingHorizontal: 20,
    paddingBottom: 0,
    maxHeight: "85%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: THEME.border,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 8,
  },
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
  addMemberInputRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  addMemberInput: {
    backgroundColor: THEME.surfaceHigh,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.text,
  },
  addMemberBtn: {
    margin: 16,
    marginTop: 0,
    backgroundColor: THEME.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  addMemberBtnDisabled: {
    opacity: 0.4,
  },
  addMemberBtnText: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: "#fff",
  },

  themeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  themeSwatch: {
    width: "22%",
    alignItems: "center",
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
  },
  themeSwatchSelected: {
    borderColor: THEME.accent,
    backgroundColor: THEME.accentSoft,
  },
  swatchDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  swatchEmoji: { fontSize: 14 },
  swatchName: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.textFaint,
    textAlign: "center",
  },
});
