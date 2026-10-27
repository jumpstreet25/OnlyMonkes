/**
 * Full-screen cover while the fingerprint lock is on and locked (src/lib/appLock.ts).
 * Locks at launch and after APP_LOCK_AFTER_MS in the background; asks right away when shown.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { AppState, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { THEME } from "@/lib/constants";
import { APP_LOCK_AFTER_MS, authenticate, loadAppLock, useAppLock } from "@/lib/appLock";

export function AppLockGate() {
  const { t } = useTranslation();
  const { enabled, locked, loaded, setLocked } = useAppLock();
  const awayAt = useRef(0);
  const asking = useRef(false);

  useEffect(() => { loadAppLock().catch(() => {}); }, []);

  const unlock = useCallback(async () => {
    if (asking.current) return;
    asking.current = true;
    const ok = await authenticate(t("appLock.prompt"));
    asking.current = false;
    if (ok) setLocked(false);
  }, [setLocked, t]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (!useAppLock.getState().enabled) return;
      if (s === "background") awayAt.current = Date.now();
      else if (s === "active" && awayAt.current && Date.now() - awayAt.current >= APP_LOCK_AFTER_MS) setLocked(true);
      if (s === "active") awayAt.current = 0;
    });
    return () => sub.remove();
  }, [setLocked]);

  useEffect(() => {
    if (enabled && locked) unlock();
  }, [enabled, locked, unlock]);

  if (!loaded || !enabled || !locked) return null;
  return (
    <View style={styles.cover} accessibilityViewIsModal>
      {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
      <Image source={require("../../assets/icon.png")} style={styles.logo} />
      <Text style={styles.title}>{t("appLock.locked")}</Text>
      <Pressable style={styles.btn} onPress={unlock} accessibilityRole="button" accessibilityLabel={t("appLock.unlock")}>
        <Text style={styles.btnText}>{t("appLock.unlock")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: "#0A0A0F",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  logo: { width: 96, height: 96, borderRadius: 24 },
  title: { color: THEME.text, fontSize: 18, fontWeight: "600" },
  btn: { backgroundColor: THEME.accent, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
