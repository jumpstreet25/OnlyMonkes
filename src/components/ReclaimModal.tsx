/**
 * ReclaimModal
 *
 * Cross-device profile recovery UI. Prompts the user to sign a bot-issued
 * challenge with their main wallet (MWA biometric), then merges the returned
 * PROFILE_SNAPSHOT into local state. Non-destructive — only ever union-merges
 * / takes MAX, never wipes local data.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import bs58 from 'bs58';
import { GlassModal } from '@/components/GlassModal';
import { THEME, FONTS } from '@/lib/constants';
import { useMobileWallet } from '@/hooks/useMobileWallet';
import { useAppStore } from '@/store/appStore';
import { runReclaim, type ReclaimSummary } from '@/lib/reclaim';

interface ReclaimModalProps {
  visible: boolean;
  onClose: () => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; status: string }
  | { kind: 'success'; summary: ReclaimSummary }
  | { kind: 'error'; message: string };

export function ReclaimModal({ visible, onClose }: ReclaimModalProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const { signMessage } = useMobileWallet();
  const wallet = useAppStore(s => s.wallet);

  const start = async () => {
    if (!wallet) {
      setPhase({ kind: 'error', message: 'Connect a wallet first.' });
      return;
    }
    setPhase({ kind: 'running', status: 'Starting…' });

    try {
      const summary = await runReclaim({
        onStatus: (msg) => setPhase({ kind: 'running', status: msg }),
        signChallenge: async (challenge) => {
          const messageBytes = new TextEncoder().encode(challenge);
          const sigBytes = await signMessage(messageBytes);
          return {
            signatureBase58: bs58.encode(sigBytes),
            pubkeyBase58: wallet.address,
          };
        },
      });
      setPhase({ kind: 'success', summary });
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
    }
  };

  const close = () => {
    if (phase.kind === 'running') return; // don't allow close mid-flow
    setPhase({ kind: 'idle' });
    onClose();
  };

  return (
    <GlassModal visible={visible} onClose={close} position="center" animationType="fade">
      <Text style={styles.title}>🔐  Restore from previous device</Text>

      {phase.kind === 'idle' && (
        <>
          <Text style={styles.body}>
            Sign a one-time challenge with your main wallet and the bot will
            return your profile — bananas, shop items, marketplace history,
            and your AutonoMonke hot wallet (if enrolled).
          </Text>
          <Text style={styles.note}>
            Safe to run on any device. Nothing is overwritten — local data merges
            with the server copy.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={start}>
            <Text style={styles.primaryText}>Start</Text>
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={close}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </>
      )}

      {phase.kind === 'running' && (
        <>
          <ActivityIndicator color={THEME.gold ?? '#FFD700'} style={{ marginVertical: 20 }} />
          <Text style={styles.statusText}>{phase.status}</Text>
          <Text style={styles.note}>
            If your wallet asks for approval, tap the notification to sign.
          </Text>
        </>
      )}

      {phase.kind === 'success' && (
        <>
          <Text style={styles.body}>✅ Profile restored.</Text>
          <View style={styles.summaryBlock}>
            <SummaryRow label="🍌 Bananas" value={String(phase.summary.bananaBalance)} />
            <SummaryRow label="🛒 Shop items" value={String(phase.summary.shopItemsRestored)} />
            <SummaryRow label="📜 Marketplace entries" value={String(phase.summary.marketplaceEntriesRestored)} />
            {phase.summary.legendary && <SummaryRow label="🌟 Status" value="Legendary" />}
            {phase.summary.username && <SummaryRow label="Username" value={phase.summary.username} />}
          </View>
          <Pressable style={styles.primaryBtn} onPress={close}>
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
        </>
      )}

      {phase.kind === 'error' && (
        <>
          <Text style={styles.errorText}>❌ {phase.message}</Text>
          <Pressable style={styles.primaryBtn} onPress={start}>
            <Text style={styles.primaryText}>Try again</Text>
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={close}>
            <Text style={styles.cancelText}>Close</Text>
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
  primaryBtn: {
    alignSelf: 'stretch',
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: THEME.gold ?? '#FFD700',
    alignItems: 'center',
    marginTop: 8,
  },
  primaryText: {
    fontFamily: FONTS.display,
    fontSize: 15,
    color: '#1A1A00',
  },
  cancelBtn: { paddingVertical: 10, marginTop: 4 },
  cancelText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textFaint,
    textAlign: 'center',
  },
});
