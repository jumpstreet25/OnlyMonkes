/**
 * OtaUpdateIndicator — branded, non-blocking OTA download progress + silent
 * auto-reload. Mounted at root alongside the other app-wide popups.
 *
 * 2026-07-22: replaces the old Alert.alert("Update Available"... "Restart?")
 * flow in otaUpdates.ts. That flow required the user to notice a system
 * dialog and tap "Restart" — a real candidate for why OTA updates weren't
 * reliably landing this session (repeated force-stop + reopen cycles never
 * seemed to apply a pending update). This component instead follows
 * expo-updates' own documented recommended pattern (useUpdates()'s JSDoc
 * example): auto-reload the instant a downloaded update is pending, no user
 * interaction required. The only UI is a slim, dismiss-proof progress toast
 * shown while actively downloading — nothing to miss, nothing to tap.
 *
 * Root cause of the earlier update-not-applying mystery is still NOT
 * confirmed from this environment (no device to test against) — this is
 * the most promising structural fix (removes the failure-prone manual
 * confirmation step entirely) but needs real on-device verification.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import * as Updates from 'expo-updates';
import { THEME, FONTS } from '@/lib/constants';

export function OtaUpdateIndicator() {
  const { isChecking, isDownloading, isUpdatePending, isUpdateAvailable, downloadProgress, checkError, downloadError } = Updates.useUpdates();
  const fetchTriggered = useRef(false);

  // Explicit check on mount — don't just trust the silent native ON_LOAD
  // check. Being explicit here is what makes isChecking/checkError/
  // downloadError actually observable (console + Sentry breadcrumb via
  // initSentry's global error capture) instead of a black box.
  useEffect(() => {
    if (__DEV__) return;
    Updates.checkForUpdateAsync().catch((err) => {
      console.log('[OTA] checkForUpdateAsync failed:', err);
    });
  }, []);

  // Once an update is confirmed available, download it.
  useEffect(() => {
    if (!isUpdateAvailable || fetchTriggered.current || isDownloading || isUpdatePending) return;
    fetchTriggered.current = true;
    Updates.fetchUpdateAsync().catch((err) => {
      console.log('[OTA] fetchUpdateAsync failed:', err);
      fetchTriggered.current = false;
    });
  }, [isUpdateAvailable, isDownloading, isUpdatePending]);

  // Once downloaded, reload immediately — no confirmation dialog, no
  // dismissable "Later" path for a critical update to silently miss.
  useEffect(() => {
    if (!isUpdatePending) return;
    console.log('[OTA] Update downloaded — reloading now');
    Updates.reloadAsync().catch((err) => {
      console.log('[OTA] reloadAsync failed:', err);
    });
  }, [isUpdatePending]);

  useEffect(() => {
    if (checkError) console.log('[OTA] checkError:', checkError.message);
    if (downloadError) console.log('[OTA] downloadError:', downloadError.message);
  }, [checkError, downloadError]);

  if (!isDownloading) return null;

  const pct = Math.round((downloadProgress ?? 0) * 100);

  return (
    <View style={styles.toast} pointerEvents="none">
      <Image source={require('../../assets/watermark.png')} style={styles.watermark} resizeMode="contain" />
      <View style={styles.textCol}>
        <Text style={styles.title}>Updating OnlyMonkes…</Text>
        <View style={styles.trackWrap}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(4, pct)}%` }]} />
          </View>
          <Text style={styles.pct}>{pct}%</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(12, 12, 22, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(248, 248, 255, 0.10)',
    zIndex: 9999,
    elevation: 12,
  },
  watermark: { width: 26, height: 26, opacity: 0.85 },
  textCol: { flex: 1, gap: 4 },
  title: { fontFamily: FONTS.bodyMed, fontSize: 12, color: THEME.text },
  trackWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: THEME.accent,
  },
  pct: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint, width: 32, textAlign: 'right' },
});
