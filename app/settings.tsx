import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Switch, ScrollView } from "react-native";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import type { SupportedLanguage } from "@/lib/i18n";
import { getActiveThreats, getThreatSeverity } from "@/lib/security";
import { showGlassAlert } from "@/lib/glassAlert";
import { WorldScreenShell, useWorldGlassCardStyle } from "@/components/worlds/WorldScreenShell";
import { useSentimentOptIn } from "@/hooks/useSentimentOptIn";

export default function SettingsScreen() {
  const { t } = useTranslation();
  const {
    language, setLanguage,
    notificationsEnabled, setNotificationsEnabled,
    mentionsOnly, setMentionsOnly,
    botNotificationsEnabled, setBotNotificationsEnabled,
    dmNotificationsEnabled, setDmNotificationsEnabled,
    liveRoomNotificationsEnabled, setLiveRoomNotificationsEnabled,
    textScale, setTextScale,
    sentimentOracleOptIn,
  } = useAppStore();

  const [clearing, setClearing] = useState(false);
  const [oracleBusy, setOracleBusy] = useState(false);
  const cardStyle = useWorldGlassCardStyle();
  const { optIn: optInOracle, optOut: optOutOracle } = useSentimentOptIn();

  const handleOracleToggle = async (next: boolean) => {
    setOracleBusy(true);
    try {
      if (next) {
        const result = await optInOracle();
        if (!result.ok) {
          showGlassAlert(t("settings.couldntEnableOracle"), result.error ?? t("settings.tryAgainInAMoment"));
        }
      } else {
        await optOutOracle();
      }
    } finally {
      setOracleBusy(false);
    }
  };

  const handleClearCache = async () => {
    showGlassAlert(
      t("settings.clearCacheAlertTitle"),
      t("settings.clearCacheAlertBody"),
      [
        { text: t("settings.cancel"), style: "cancel" },
        {
          text: t("settings.clear"),
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
            showGlassAlert(t("settings.cacheClearedTitle"), t("settings.cacheClearedBody"));
          },
        },
      ]
    );
  };

  return (
    <WorldScreenShell title="Settings" onBack={() => router.back()}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Notifications */}
        <Text style={styles.sectionTitle}>{t("settings.notifications")}</Text>
        <ToggleRow label={t("settings.allMessages")} value={notificationsEnabled} onToggle={setNotificationsEnabled} cardStyle={cardStyle} />
        <ToggleRow label={t("settings.mentionsOnly")} value={mentionsOnly} onToggle={setMentionsOnly} cardStyle={cardStyle} />
        <ToggleRow label={t("settings.botAlerts")} value={botNotificationsEnabled} onToggle={setBotNotificationsEnabled} cardStyle={cardStyle} />
        <ToggleRow label={t("settings.dmNotifications")} value={dmNotificationsEnabled} onToggle={setDmNotificationsEnabled} cardStyle={cardStyle} />
        <ToggleRow label={t("settings.liveRoomAlerts")} value={liveRoomNotificationsEnabled} onToggle={setLiveRoomNotificationsEnabled} cardStyle={cardStyle} />

        {/* Display */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t("settings.display")}</Text>
        <View style={[styles.row, cardStyle]}>
          <Text style={styles.rowLabel}>{t("settings.textSize")}</Text>
          <View style={styles.textScaleRow}>
            {[0.85, 1.0, 1.15, 1.3].map(s => (
              <Pressable
                key={s}
                style={[styles.scalePill, textScale === s && styles.scalePillActive]}
                onPress={() => setTextScale(s)}
              >
                <Text style={[styles.scaleText, textScale === s && styles.scaleTextActive]}>
                  {s === 1.0 ? t("settings.default") : `${Math.round(s * 100)}%`}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.row, cardStyle, { marginTop: 8 }]}>
          <Text style={styles.rowLabel}>{t("settings.language")}</Text>
          <View style={styles.textScaleRow}>
            {([
              { code: "en" as SupportedLanguage, label: t("settings.languageEnglish") },
              { code: "es" as SupportedLanguage, label: t("settings.languageSpanish") },
            ]).map(({ code, label }) => (
              <Pressable
                key={code}
                style={[styles.scalePill, language === code && styles.scalePillActive]}
                onPress={() => setLanguage(code)}
              >
                <Text style={[styles.scaleText, language === code && styles.scaleTextActive]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Data */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t("settings.data")}</Text>
        <Pressable style={[styles.actionRow, cardStyle]} onPress={handleClearCache} disabled={clearing}>
          <Text style={styles.actionText}>{clearing ? t("settings.clearing") : t("settings.clearCache")}</Text>
          <Text style={styles.actionDesc}>{t("settings.clearCacheDesc")}</Text>
        </Pressable>

        {/* Data Oracle — Phase 1: attestation + collection only, no payouts yet */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t("settings.dataOracle")}</Text>
        <View style={[styles.row, cardStyle]}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={styles.rowLabel}>{t("settings.contributeSentiment")}</Text>
            <Text style={styles.actionDesc}>
              {t("settings.sentimentDesc")}
            </Text>
          </View>
          <Switch
            value={sentimentOracleOptIn}
            onValueChange={handleOracleToggle}
            disabled={oracleBusy}
            trackColor={{ false: THEME.border, true: "rgba(124,58,237,0.5)" }}
            thumbColor={sentimentOracleOptIn ? "#7C3AED" : THEME.textMuted}
          />
        </View>

        {/* Device Security */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t("settings.deviceSecurity")}</Text>
        <SecurityPanel cardStyle={cardStyle} />

        {/* Links */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t("settings.info")}</Text>
        <Pressable style={[styles.actionRow, cardStyle]} onPress={() => router.push("/about" as any)}>
          <Text style={styles.actionText}>{t("settings.aboutOnlyMonkes")}</Text>
          <Text style={styles.actionDesc}>{t("settings.aboutDesc")}</Text>
        </Pressable>
      </ScrollView>
    </WorldScreenShell>
  );
}

const THREAT_LABEL_KEYS: Record<string, string> = {
  privilegedAccess: "privilegedAccess",
  hooks: "hooks",
  appIntegrity: "appIntegrity",
  deviceBinding: "deviceBinding",
  raspNotConfigured: "raspNotConfigured",
  simulator: "simulator",
  debug: "debug",
  unofficialStore: "unofficialStore",
  adbEnabled: "adbEnabled",
  passcode: "passcode",
  devMode: "devMode",
};

function SecurityPanel({ cardStyle }: { cardStyle: object }) {
  const { t } = useTranslation();
  // "info" threats (e.g. devMode) are tracked for future gating but never
  // shown — only "hard"/"soft" are actionable enough to surface to the user.
  const threats = getActiveThreats().filter((threat) => getThreatSeverity(threat) !== "info");
  if (threats.length === 0) {
    return (
      <View style={[styles.actionRow, cardStyle]}>
        <Text style={[styles.actionText, { color: "#22c55e" }]}>✓ {t("settings.deviceVerified")}</Text>
        <Text style={styles.actionDesc}>{t("settings.noThreatsDesc")}</Text>
      </View>
    );
  }
  const hard = threats.filter((threat) => getThreatSeverity(threat) === "hard");
  return (
    <View style={[styles.actionRow, cardStyle]}>
      <Text style={[styles.actionText, { color: hard.length > 0 ? "#ef4444" : "#f59e0b" }]}>
        {hard.length > 0 ? `⚠ ${t("settings.tradingBlocked")}` : `ℹ ${t("settings.securityNotice")}`}
      </Text>
      <Text style={styles.actionDesc}>
        {hard.length > 0
          ? t("settings.hardThreatsDesc")
          : t("settings.softThreatsDesc")}
      </Text>
      {threats.map((threat) => (
        <Text
          key={threat}
          style={[
            styles.actionDesc,
            {
              marginTop: 4,
              color: getThreatSeverity(threat) === "hard" ? "#ef4444" : THEME.textMuted,
            },
          ]}
        >
          • {THREAT_LABEL_KEYS[threat] ? t(`settings.threats.${THREAT_LABEL_KEYS[threat]}`) : threat}
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
