import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Switch, ScrollView } from "react-native";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { getActiveThreats, getThreatSeverity } from "@/lib/security";
import { showGlassAlert } from "@/lib/glassAlert";
import { WorldScreenShell, useWorldGlassCardStyle } from "@/components/worlds/WorldScreenShell";

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
  const cardStyle = useWorldGlassCardStyle();

  const handleClearCache = async () => {
    showGlassAlert(
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
            showGlassAlert("Cache Cleared", "Restart the app for changes to take effect.");
          },
        },
      ]
    );
  };

  return (
    <WorldScreenShell title="Settings" onBack={() => router.back()}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Notifications */}
        <Text style={styles.sectionTitle}>Notifications</Text>
        <ToggleRow label="All Messages" value={notificationsEnabled} onToggle={setNotificationsEnabled} cardStyle={cardStyle} />
        <ToggleRow label="Mentions Only" value={mentionsOnly} onToggle={setMentionsOnly} cardStyle={cardStyle} />
        <ToggleRow label="Bot Alerts" value={botNotificationsEnabled} onToggle={setBotNotificationsEnabled} cardStyle={cardStyle} />
        <ToggleRow label="DM Notifications" value={dmNotificationsEnabled} onToggle={setDmNotificationsEnabled} cardStyle={cardStyle} />
        <ToggleRow label="Live Room Alerts" value={liveRoomNotificationsEnabled} onToggle={setLiveRoomNotificationsEnabled} cardStyle={cardStyle} />

        {/* Display */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Display</Text>
        <View style={[styles.row, cardStyle]}>
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
        <Pressable style={[styles.actionRow, cardStyle]} onPress={handleClearCache} disabled={clearing}>
          <Text style={styles.actionText}>{clearing ? "Clearing..." : "Clear Cache"}</Text>
          <Text style={styles.actionDesc}>Clears profile and geocode caches</Text>
        </Pressable>

        {/* Device Security */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Device Security</Text>
        <SecurityPanel cardStyle={cardStyle} />

        {/* Links */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Info</Text>
        <Pressable style={[styles.actionRow, cardStyle]} onPress={() => router.push("/about" as any)}>
          <Text style={styles.actionText}>About OnlyMonkes</Text>
          <Text style={styles.actionDesc}>Version, links, credits, legal docs</Text>
        </Pressable>
      </ScrollView>
    </WorldScreenShell>
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

function SecurityPanel({ cardStyle }: { cardStyle: object }) {
  const threats = getActiveThreats();
  if (threats.length === 0) {
    return (
      <View style={[styles.actionRow, cardStyle]}>
        <Text style={[styles.actionText, { color: "#22c55e" }]}>✓ Device verified</Text>
        <Text style={styles.actionDesc}>No security threats detected. Trading is enabled.</Text>
      </View>
    );
  }
  const hard = threats.filter((t) => getThreatSeverity(t) === "hard");
  return (
    <View style={[styles.actionRow, cardStyle]}>
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

function ToggleRow({
  label,
  value,
  onToggle,
  cardStyle,
}: {
  label: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  cardStyle: object;
}) {
  return (
    <View style={[styles.row, cardStyle]}>
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
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontFamily: FONTS.display, fontSize: 15, color: THEME.text, marginBottom: 8, marginTop: 8 },
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 0.75, marginBottom: 6,
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
    borderRadius: 14,
    borderWidth: 0.75, marginBottom: 6,
  },
  actionText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: "#6CB4EE" },
  actionDesc: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted, marginTop: 2 },
});
