/**
 * OtaUpdateIndicator — branded, non-blocking OTA download progress toast.
 * Mounted at root alongside the other app-wide popups.
 *
 * 2026-09-02: REMOVED the silent auto-reload-on-pending behavior this
 * component used to own. Real on-device report: OTA updates were
 * "crashing instead of showing a pop-up." Root cause found — this
 * component's own useEffect called Updates.reloadAsync() the INSTANT a
 * download finished, with zero delay and zero confirmation, while
 * app/_layout.tsx *also* mounts <UpdateAvailableModal /> (via
 * useUpdatePrompt) watching the exact same isUpdatePending state to show
 * a proper "Update ready — Update Now / Later" glass prompt. Both fired
 * off the same state change; this component's instant, unconditional
 * reload always won the race, tearing down the JS context before the
 * modal could ever render — which reads as an unannounced crash, not an
 * update prompt. This component now only checks/fetches the update and
 * shows the download-progress toast; UpdateAvailableModal exclusively
 * owns calling reloadAsync(), only on an explicit user tap.
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

  // 2026-09-02: no longer auto-reloads here — <UpdateAvailableModal />
  // (app/_layout.tsx, via useUpdatePrompt) owns the actual reloadAsync()
  // call, gated on an explicit user tap. See file header for why.
  useEffect(() => {
    if (isUpdatePending) console.log('[OTA] Update downloaded — pending user confirmation via UpdateAvailableModal');
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
