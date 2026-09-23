/**
 * ResetIdentityModal
 *
 * Last-resort opt-in escape hatch for when the bot's DM with this wallet has
 * gone permanently MLS-inactive (confirmed 2026-09-13 as an open, unmerged
 * upstream libxmtp bug — no supported recovery for a mutually-inactive 1:1).
 * Mints a fresh per-wallet XMTP identity (generation bump, never touches the
 * global XMTP_IDENTITY_DOMAIN) and re-adds this wallet to Main/Trades/Genesis.
 * Does not touch AutonoMonke funds. Other devices on the same wallet keep
 * their existing inbox untouched.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GlassModal } from '@/components/GlassModal';
import { THEME, FONTS } from '@/lib/constants';

interface ResetIdentityModalProps {
  visible: boolean;
  onClose: () => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'success'; inboxId: string; generation: number }
  | { kind: 'error'; message: string };

export function ResetIdentityModal({ visible, onClose }: ResetIdentityModalProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const start = async () => {
    setPhase({ kind: 'running' });
    try {
      const { resetWalletChatIdentity } = await import('@/lib/xmtpIdentityReset');
      const { inboxId, generation } = await resetWalletChatIdentity();
      setPhase({ kind: 'success', inboxId, generation });
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'Reset failed' });
    }
  };

  const close = () => {
    if (phase.kind === 'running') return; // don't allow close mid-flow
    setPhase({ kind: 'idle' });
    onClose();
  };

  return (
    <GlassModal visible={visible} onClose={close} position="center" animationType="fade">
      <Text style={styles.title}>{t('resetIdentity.title')}</Text>

      {phase.kind === 'idle' && (
        <>
          <Text style={styles.body}>
            {t('resetIdentity.idleBody')}
          </Text>
          <Text style={styles.note}>
            {t('resetIdentity.idleNote')}
          </Text>
          <Pressable style={styles.destructiveBtn} onPress={start}>
            <Text style={styles.destructiveText}>{t('resetIdentity.reset')}</Text>
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={close}>
            <Text style={styles.cancelText}>{t('resetIdentity.cancel')}</Text>
          </Pressable>
        </>
      )}

      {phase.kind === 'running' && (
        <>
          <ActivityIndicator color={THEME.gold ?? '#FFD700'} style={{ marginVertical: 20 }} />
          <Text style={styles.statusText}>{t('resetIdentity.signingIdentity')}</Text>
          <Text style={styles.note}>
            {t('resetIdentity.runningNote')}
          </Text>
        </>
      )}

      {phase.kind === 'success' && (
        <>
          <Text style={styles.body}>{t('resetIdentity.successBody')}</Text>
          <View style={styles.summaryBlock}>
            <SummaryRow label={t('resetIdentity.newInbox')} value={`${phase.inboxId.slice(0, 10)}…`} />
            <SummaryRow label={t('resetIdentity.generation')} value={String(phase.generation)} />
          </View>
          <Text style={styles.note}>
            {t('resetIdentity.successNote')}
          </Text>
          <Pressable style={styles.destructiveBtn} onPress={close}>
            <Text style={styles.destructiveText}>{t('resetIdentity.done')}</Text>
          </Pressable>
        </>
      )}

      {phase.kind === 'error' && (
        <>
          <Text style={styles.errorText}>❌ {phase.message}</Text>
          <Pressable style={styles.destructiveBtn} onPress={start}>
            <Text style={styles.destructiveText}>{t('resetIdentity.tryAgain')}</Text>
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={close}>
            <Text style={styles.cancelText}>{t('resetIdentity.close')}</Text>
          </Pressable>
        </>
      )}
    </GlassModal>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: FONTS.display,
    fontSize: 18,
    color: THEME.text,
    textAlign: 'center',
    marginBottom: 14,
  },
  body: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.text,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 10,
  },
  note: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textFaint,
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 17,
  },
  statusText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  errorText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: '#FF6B6B',
    textAlign: 'center',
    marginVertical: 20,
    lineHeight: 20,
  },
  summaryBlock: {
    alignSelf: 'stretch',
    marginVertical: 18,
    paddingHorizontal: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  summaryLabel: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textDim ?? THEME.text,
  },
  summaryValue: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    color: THEME.text,
  },
  destructiveBtn: {
    alignSelf: 'stretch',
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: '#FF6B6B',
    alignItems: 'center',
    marginTop: 8,
  },
  destructiveText: {
    fontFamily: FONTS.display,
    fontSize: 15,
    color: '#2A0A0A',
  },
  cancelBtn: { paddingVertical: 10, marginTop: 4 },
  cancelText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textFaint,
    textAlign: 'center',
  },
});
