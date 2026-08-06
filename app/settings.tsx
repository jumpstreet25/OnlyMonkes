import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Switch, ScrollView, StatusBar, Alert } from "react-native";
import { IS_IMMERSIVE_SHELL } from "@/lib/immersiveStatusBar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { getActiveThreats, getThreatSeverity } from "@/lib/security";

export default function SettingsScreen() {
  const {
    notificationsEnabled, setNotificationsEnabled,
    mentionsOnly, setMentionsOnly,
    botNotificationsEnabled, setBotNotificationsEnabled,
    dmNotificationsEnabled, setDmNotificationsEnabled,
    liveRoomNotificationsEnabled, setLiveRoomNotificationsEnabled,
    textScale, setTextScale,
  } = useAppStore();

  const [clearing, setClearing] = useState(false);
  const insets = useSafeAreaInsets();

  const handleClearCache = async () => {
    Alert.alert(
      "Clear Cache",
      "This will clear cached images, geocode data, and message cache. Your account, bananas, and purchases are not affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            setClearing(true);
            try {
              await AsyncStorage.multiRemove([
                "profile_cache_v2",
                "geocode_cache_v1",
              ]);
            } catch { /* ignore */ }
            setClearing(false);
            Alert.alert("Cache Cleared", "Restart the app for changes to take effect.");
          },
        },
      ]
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" hidden={IS_IMMERSIVE_SHELL} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Notifications */}
        <Text style={styles.sectionTitle}>Notifications</Text>
        <ToggleRow label="All Messages" value={notificationsEnabled} onToggle={setNotificationsEnabled} />
        <ToggleRow label="Mentions Only" value={mentionsOnly} onToggle={setMentionsOnly} />
        <ToggleRow label="Bot Alerts" value={botNotificationsEnabled} onToggle={setBotNotificationsEnabled} />
        <ToggleRow label="DM Notifications" value={dmNotificationsEnabled} onToggle={setDmNotificationsEnabled} />
        <ToggleRow label="Live Room Alerts" value={liveRoomNotificationsEnabled} onToggle={setLiveRoomNotificationsEnabled} />

        {/* Display */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Display</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Text Size</Text>
          <View style={styles.textScaleRow}>
            {[0.85, 1.0, 1.15, 1.3].map(s => (
              <Pressable
                key={s}
                style={[styles.scalePill, textScale === s && styles.scalePillActive]}
                onPress={() => setTextScale(s)}
              >
                <Text style={[styles.scaleText, textScale === s && styles.scaleTextActive]}>
                  {s === 1.0 ? "Default" : `${Math.round(s * 100)}%`}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Data */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Data</Text>
        <Pressable style={styles.actionRow} onPress={handleClearCache} disabled={clearing}>
          <Text style={styles.actionText}>{clearing ? "Clearing..." : "Clear Cache"}</Text>
          <Text style={styles.actionDesc}>Clears profile and geocode caches</Text>
        </Pressable>

        {/* Device Security */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Device Security</Text>
        <SecurityPanel />

        {/* Links */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Info</Text>
        <Pressable style={styles.actionRow} onPress={() => router.push("/about" as any)}>
          <Text style={styles.actionText}>About OnlyMonkes</Text>
          <Text style={styles.actionDesc}>Version, links, credits, legal docs</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const THREAT_LABELS: Record<string, string> = {
  privilegedAccess: "Root / jailbreak detected",
  hooks: "Code-hooking framework detected (Frida / Xposed)",
  appIntegrity: "App tampered or repackaged",
  deviceBinding: "Device fingerprint changed",
  raspNotConfigured: "Tamper detection not configured",
  simulator: "Running on emulator",
  debug: "Debugger attached",
  unofficialStore: "Sideloaded from unknown source",
  adbEnabled: "ADB debugging enabled",
  passcode: "No screen lock set",
  devMode: "Developer mode enabled",
};

function SecurityPanel() {
  const threats = getActiveThreats();
  if (threats.length === 0) {
    return (
      <View style={styles.actionRow}>
        <Text style={[styles.actionText, { color: "#22c55e" }]}>✓ Device verified</Text>
        <Text style={styles.actionDesc}>No security threats detected. Trading is enabled.</Text>
      </View>
    );
  }
  const hard = threats.filter((t) => getThreatSeverity(t) === "hard");
  const soft = threats.filter((t) => getThreatSeverity(t) === "soft");
  return (
    <View style={styles.actionRow}>
      <Text style={[styles.actionText, { color: hard.length > 0 ? "#ef4444" : "#f59e0b" }]}>
        {hard.length > 0 ? "⚠ Trading blocked" : "ℹ Security notice"}
      </Text>
      <Text style={styles.actionDesc}>
        {hard.length > 0
          ? "Hard threats detected — transactions and identity signing are disabled until resolved."
          : "Soft warnings detected — trading still allowed."}
      </Text>
      {threats.map((t) => (
        <Text
          key={t}
          style={[
            styles.actionDesc,
            {
              marginTop: 4,
              color: getThreatSeverity(t) === "hard" ? "#ef4444" : THEME.textMuted,
            },
          ]}
        >
          • {THREAT_LABELS[t] ?? t}
        </Text>
      ))}
    </View>
  );
}

function ToggleRow({ label, value, onToggle }: { label: string; value: boolean; onToggle: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: THEME.border, true: "rgba(124,58,237,0.5)" }}
        thumbColor={value ? "#7C3AED" : THEME.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 0.75, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  backText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: "#6CB4EE" },
  headerTitle: { fontFamily: FONTS.display, fontSize: 20, color: THEME.text },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontFamily: FONTS.display, fontSize: 15, color: THEME.text, marginBottom: 8, marginTop: 8 },
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: "rgba(18,18,30,0.8)", borderRadius: 14,
    borderWidth: 0.75, borderColor: "rgba(255,255,255,0.06)", marginBottom: 6,
  },
  rowLabel: { fontFamily: FONTS.bodyMed, fontSize: 14, color: THEME.text },
  textScaleRow: { flexDirection: "row", gap: 6 },
  scalePill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    backgroundColor: THEME.border,
  },
  scalePillActive: { backgroundColor: "rgba(124,58,237,0.3)", borderWidth: 1, borderColor: "#7C3AED" },
  scaleText: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted },
  scaleTextActive: { color: "#7C3AED" },
  actionRow: {
    paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: "rgba(18,18,30,0.8)", borderRadius: 14,
    borderWidth: 0.75, borderColor: "rgba(255,255,255,0.06)", marginBottom: 6,
  },
  actionText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: "#6CB4EE" },
  actionDesc: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted, marginTop: 2 },
});
