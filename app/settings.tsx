import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Switch, ScrollView, StatusBar, Alert } from "react-native";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";

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
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
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
    paddingTop: 52, paddingHorizontal: 16, paddingBottom: 12,
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
