/**
 * LinkedDevicesModal — the phones and browsers signed in to this wallet's chat,
 * with Remove for the old ones (see src/lib/xmtpDevices.ts). Two taps per
 * removal: Remove, then Confirm.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GlassModal } from '@/components/GlassModal';
import { THEME, FONTS } from '@/lib/constants';
import { INSTALLATION_CAP, listLinkedDevices, removeLinkedDevices, type LinkedDevice } from '@/lib/xmtpDevices';

interface LinkedDevicesModalProps {
  visible: boolean;
  onClose: () => void;
}

export function LinkedDevicesModal({ visible, onClose }: LinkedDevicesModalProps) {
  const { t, i18n } = useTranslation();
  const [devices, setDevices] = useState<LinkedDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDevices(await listLinkedDevices());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (visible) { setDevices(null); setConfirmId(null); load(); }
  }, [visible, load]);

  const remove = async (ids: string[]) => {
    setBusy(ids.length > 1 ? 'all' : ids[0]);
    setError(null);
    try {
      await removeLinkedDevices(ids);
      setConfirmId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('linkedDevices.removeFailed'));
    } finally {
      setBusy(null);
    }
  };

  const fmtDate = (ms?: number) =>
    ms ? new Date(ms).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) : t('linkedDevices.dateUnknown');

  const others = devices?.filter((d) => !d.isThisDevice) ?? [];

  return (
    <GlassModal visible={visible} onClose={() => !busy && onClose()} position="center" animationType="fade">
      <Text style={styles.title}>{t('linkedDevices.title')}</Text>
      <Text style={styles.note}>{t('linkedDevices.intro', { cap: INSTALLATION_CAP })}</Text>

      {!devices && !error && <ActivityIndicator color={THEME.gold} style={{ marginVertical: 20 }} />}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {devices && (
        <>
          <Text style={styles.count}>{t('linkedDevices.count', { n: devices.length, cap: INSTALLATION_CAP })}</Text>
          <ScrollView style={styles.list} contentContainerStyle={{ gap: 8 }}>
            {devices.map((d) => (
              <View key={d.id} style={styles.row}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle}>
                    {d.isThisDevice ? t(Platform.OS === 'web' ? 'linkedDevices.thisBrowser' : 'linkedDevices.thisDevice') : t('linkedDevices.otherDevice')}
                  </Text>
                  <Text style={styles.rowMeta}>{t('linkedDevices.linked', { date: fmtDate(d.createdAt) })}</Text>
                </View>
                {!d.isThisDevice && (busy === d.id ? (
                  <ActivityIndicator color={THEME.gold} />
                ) : confirmId === d.id ? (
                  <Pressable style={styles.confirmBtn} onPress={() => remove([d.id])} disabled={!!busy}>
                    <Text style={styles.confirmText}>{t('linkedDevices.confirm')}</Text>
                  </Pressable>
                ) : (
                  <Pressable style={styles.removeBtn} onPress={() => setConfirmId(d.id)} disabled={!!busy}>
                    <Text style={styles.removeText}>{t('linkedDevices.remove')}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
          {others.length > 1 && (
            confirmId === 'all' ? (
              <Pressable style={styles.allBtn} onPress={() => remove(others.map((d) => d.id))} disabled={!!busy}>
                {busy === 'all' ? <ActivityIndicator color="#2A0A0A" /> : (
                  <Text style={styles.allText}>{t('linkedDevices.confirmAll', { n: others.length })}</Text>
                )}
              </Pressable>
            ) : (
              <Pressable style={styles.allBtnOutline} onPress={() => setConfirmId('all')} disabled={!!busy}>
                <Text style={styles.allTextOutline}>{t('linkedDevices.removeAll')}</Text>
              </Pressable>
            )
          )}
          <Text style={styles.note}>{t('linkedDevices.footnote')}</Text>
        </>
      )}

      <Pressable style={styles.cancelBtn} onPress={onClose} disabled={!!busy}>
        <Text style={styles.cancelText}>{t('linkedDevices.close')}</Text>
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
  allBtn: { alignSelf: 'stretch', borderRadius: 12, paddingVertical: 12, backgroundColor: '#FF6B6B', alignItems: 'center', marginTop: 12 },
  allText: { fontFamily: FONTS.display, fontSize: 14, color: '#2A0A0A' },
  allBtnOutline: { alignSelf: 'stretch', borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: '#FF6B6B', alignItems: 'center', marginTop: 12 },
  allTextOutline: { fontFamily: FONTS.display, fontSize: 14, color: '#FF6B6B' },
  cancelBtn: { paddingVertical: 10, marginTop: 4 },
  cancelText: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textFaint, textAlign: 'center' },
});
