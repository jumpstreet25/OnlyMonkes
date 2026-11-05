/**
 * AppUpdateBanner — "a new OnlyMonkes is on the dApp Store" bar at the top of
 * Main/Genesis chat. Off until config/app-update.json enables it; see
 * src/lib/appUpdateNotice.ts.
 */
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { THEME, FONTS } from "@/lib/constants";
import {
  STORE_DEEP_LINK,
  STORE_FALLBACK_URL,
  currentRuntime,
  fetchAppUpdateConfig,
  shouldShowUpdateBanner,
  type AppUpdateConfig,
} from "@/lib/appUpdateNotice";

const AK_DISMISSED = "om_app_update_dismissed_at";

export function AppUpdateBanner() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<AppUpdateConfig | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  useEffect(() => {
    const runtime = currentRuntime();
    if (!runtime) return;
    let live = true;
    (async () => {
      const [c, d] = await Promise.all([
        fetchAppUpdateConfig(),
        AsyncStorage.getItem(AK_DISMISSED).catch(() => null),
      ]);
      if (!live) return;
      setDismissedAt(d ? Number(d) || null : null);
      setCfg(c);
    })();
    return () => { live = false; };
  }, []);

  if (!cfg || !shouldShowUpdateBanner(cfg, currentRuntime(), dismissedAt, Date.now())) return null;

  const openStore = () => {
    Linking.openURL(STORE_DEEP_LINK).catch(() => Linking.openURL(STORE_FALLBACK_URL).catch(() => {}));
  };
  const dismiss = () => {
    const now = Date.now();
    setDismissedAt(now);
    AsyncStorage.setItem(AK_DISMISSED, String(now)).catch(() => {});
  };

  return (
    <View style={styles.banner}>
      <View style={styles.info}>
        <Text style={styles.title}>{t("appUpdate.title")}</Text>
        <Text style={styles.body}>{t(cfg.required ? "appUpdate.bodyRequired" : "appUpdate.body")}</Text>
      </View>
      <Pressable style={styles.updateBtn} onPress={openStore} accessibilityRole="button">
        <Text style={styles.updateBtnText}>{t("appUpdate.update")}</Text>
      </Pressable>
      {!cfg.required && (
        <Pressable style={styles.laterBtn} onPress={dismiss} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.laterBtnText}>{t("appUpdate.later")}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: THEME.surfaceHigh,
    borderBottomWidth: 1,
    borderBottomColor: THEME.gold,
  },
  info: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    fontWeight: "700",
    color: THEME.gold,
  },
  body: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textMuted,
    marginTop: 2,
  },
  updateBtn: {
    backgroundColor: THEME.gold,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  updateBtnText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    fontWeight: "800",
    color: THEME.bg,
  },
  laterBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginLeft: 4,
  },
  laterBtnText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textDim,
  },
});
