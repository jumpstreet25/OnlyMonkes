/**
 * MyDevicesModal — the phones verified on this wallet (up to 5), with Remove for the
 * ones no longer used (see src/lib/myDevices.ts). Two taps per removal: Remove, then
 * Confirm; an armed Confirm disarms itself after 5 s.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GlassModal } from '@/components/GlassModal';
import { THEME, FONTS } from '@/lib/constants';
import { useAppStore } from '@/store/appStore';
import { listMyDevices, removeMyDevice, MyDevicesError, type MyDevice } from '@/lib/myDevices';
import { reverifyDevice } from '@/lib/deviceReverify';

const CONFIRM_MS = 5_000;

interface MyDevicesModalProps {
  visible: boolean;
  onClose: () => void;
}

export function MyDevicesModal({ visible, onClose }: MyDevicesModalProps) {
  const { t, i18n } = useTranslation();
  const wallet = useAppStore((s) => s.wallet?.address);
  const [devices, setDevices] = useState<MyDevice[] | null>(null);
  const [max, setMax] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [notVerified, setNotVerified] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const errorText = useCallback((err: unknown, fallbackKey: string) => {
    if (err instanceof MyDevicesError && err.code === 'UNSUPPORTED') return t('myDevices.unsupported');
    console.warn('[myDevices]', err instanceof Error ? err.message : err);
    return t(fallbackKey);
  }, [t]);

  const load = useCallback(async () => {
    if (!wallet) return;
    const seq = ++loadSeq.current;
    setError(null);
    setNotVerified(false);
    setDevices(null);
    try {
      const r = await listMyDevices(wallet);
      if (seq !== loadSeq.current) return;
      setMax(r.max);
      setDevices(r.devices);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      if (err instanceof MyDevicesError && err.code === 'NOT_VERIFIED') setNotVerified(true);
      else setError(errorText(err, 'myDevices.loadFailed'));
    }
  }, [wallet, errorText]);

  useEffect(() => {
    if (visible) { setConfirmId(null); load(); }
  }, [visible, load]);

  useEffect(() => {
    if (!confirmId || busy) return;
    const timer = setTimeout(() => setConfirmId(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmId, busy]);

  const verifyThisPhone = async () => {
    setBusy('verify');
    setError(null);
    try {
      const r = await reverifyDevice('my-devices', { walletPrompt: true });
      if (r.status === 'clean') await load();
      else setError(r.error ? `${t('myDevices.verifyFailed')}\n${r.error}` : t('myDevices.verifyFailed'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!wallet) return;
    setBusy(id);
    setError(null);
    try {
      const r = await removeMyDevice(wallet, id);
      setConfirmId(null);
      setDevices(r.devices);
      // Removing this phone itself leaves it unverified until it verifies again.
      if (!r.devices.some((d) => d.isThisDevice)) setNotVerified(true);
    } catch (err) {
      setError(errorText(err, 'myDevices.removeFailed'));
    } finally {
      setBusy(null);
    }
  };

  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <GlassModal visible={visible} onClose={() => !busy && onClose()} position="center" animationType="fade">
      <Text style={styles.title}>{t('myDevices.title')}</Text>
      <Text style={styles.note}>{t('myDevices.intro', { max })}</Text>

      {!devices && !error && !notVerified && <ActivityIndicator color={THEME.gold} style={{ marginVertical: 20 }} />}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {notVerified && (
        <>
          <Text style={styles.note}>{t('myDevices.notVerified')}</Text>
          <Pressable style={styles.primaryBtn} onPress={verifyThisPhone} disabled={!!busy}>
            {busy === 'verify' ? <ActivityIndicator color="#04101f" /> : <Text style={styles.primaryText}>{t('myDevices.verify')}</Text>}
          </Pressable>
        </>
      )}
      {error && !devices && !notVerified && (
        <Pressable style={styles.outlineBtn} onPress={load}>
          <Text style={styles.outlineText}>{t('myDevices.retry')}</Text>
        </Pressable>
      )}

      {devices && (
        <>
          <Text style={styles.count}>{t('myDevices.count', { n: devices.length, max })}</Text>
          <ScrollView style={styles.list} contentContainerStyle={{ gap: 8 }}>
            {devices.map((d) => (
              <View key={d.id} style={styles.row}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle}>
                    {d.label ?? t('myDevices.phone')}{d.isThisDevice ? ` · ${t('myDevices.thisPhone')}` : ''}
                  </Text>
                  <Text style={styles.rowMeta}>{t('myDevices.verifiedOn', { date: fmtDate(d.verifiedAt) })}</Text>
                </View>
                {busy === d.id ? (
                  <ActivityIndicator color={THEME.gold} />
                ) : confirmId === d.id ? (
                  <Pressable style={styles.confirmBtn} onPress={() => remove(d.id)} disabled={!!busy}>
                    <Text style={styles.confirmText}>{t('myDevices.confirm')}</Text>
                  </Pressable>
                ) : (
                  <Pressable style={styles.removeBtn} onPress={() => setConfirmId(d.id)} disabled={!!busy}>
                    <Text style={styles.removeText}>{t('myDevices.remove')}</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </ScrollView>
          <Text style={styles.note}>{t('myDevices.footnote')}</Text>
        </>
      )}

      <Pressable style={styles.cancelBtn} onPress={onClose} disabled={!!busy}>
        <Text style={styles.cancelText}>{t('myDevices.close')}</Text>
      </Pressable>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: FONTS.display, fontSize: 18, color: THEME.text, textAlign: 'center', marginBottom: 10 },
  note: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textFaint, textAlign: 'center', lineHeight: 17, marginVertical: 8 },
  count: { fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted, textAlign: 'center', marginBottom: 8 },
  errorText: { fontFamily: FONTS.body, fontSize: 14, color: '#FF6B6B', textAlign: 'center', marginVertical: 14, lineHeight: 20 },
  list: { alignSelf: 'stretch', maxHeight: 320 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 10, backgroundColor: THEME.surfaceHigh, borderWidth: 1, borderColor: THEME.border,
  },
  rowInfo: { flex: 1, marginRight: 8 },
  rowTitle: { fontFamily: FONTS.bodySemi, fontSize: 14, color: THEME.text },
  rowMeta: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textDim, marginTop: 2 },
  removeBtn: { borderRadius: 8, borderWidth: 1, borderColor: '#FF6B6B', paddingHorizontal: 12, paddingVertical: 6 },
  removeText: { fontFamily: FONTS.bodySemi, fontSize: 12, color: '#FF6B6B' },
  confirmBtn: { borderRadius: 8, backgroundColor: '#FF6B6B', paddingHorizontal: 12, paddingVertical: 6 },
  confirmText: { fontFamily: FONTS.bodySemi, fontSize: 12, color: '#2A0A0A' },
  primaryBtn: { alignSelf: 'stretch', borderRadius: 12, paddingVertical: 12, backgroundColor: '#6CB4EE', alignItems: 'center', marginTop: 8 },
  primaryText: { fontFamily: FONTS.display, fontSize: 14, color: '#04101f' },
  outlineBtn: { alignSelf: 'stretch', borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: '#6CB4EE', alignItems: 'center', marginTop: 12 },
  outlineText: { fontFamily: FONTS.display, fontSize: 14, color: '#6CB4EE' },
  cancelBtn: { paddingVertical: 10, marginTop: 4 },
  cancelText: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textFaint, textAlign: 'center' },
});
