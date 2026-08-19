/**
 * CopyTradeToggle — single-tap follow toggle for a Monke Trader #1/#3
 * leaderboard row. Sends /copy enable|disable to the bot over the standard
 * DM pattern; optimistic local state is reconciled by the bot's
 * COPY_TRADE_STATUS: DM (see useXmtp.ts / useDm.ts).
 *
 * Enabling requires AutonoMonke enrollment (shared custody/risk-gate
 * pipeline) — if the user isn't enrolled yet, this opens the existing
 * AutonoMonkeSetupWizard first and only sends /copy enable once enrollment
 * succeeds.
 */

import React, { useState } from 'react';
import { View, Switch, StyleSheet } from 'react-native';
import { THEME, BOT_INBOX_IDS } from '@/lib/constants';
import { useAppStore } from '@/store/appStore';
import { getXmtpClient } from '@/hooks/useXmtp';
import { sendDmMessage } from '@/lib/xmtp';
import AutonoMonkeSetupWizard from '@/components/AutonoMonkeSetupWizard';
import { toast } from 'sonner-native';

const BOT_INBOX_ID = BOT_INBOX_IDS[0];
// AutonoMonkeSetupWizard doesn't persist the user's chosen perTradeSOL back
// to appStore, so the app has no reliable "existing perTradeSOL" to read.
// The bot DOES have it (AutoMonkeUserState.perTradeSOL, set at enrollment) —
// omit the field from the enable payload entirely so copyTradeFlow.ts's
// server-side fallback (state.perTradeSOL, only defaulting to 0.1 for
// legacy users with none configured) is authoritative. This constant is
// ONLY for the optimistic local UI update, never sent to the bot.
const DEFAULT_PER_TRADE_SOL = 0.1;

interface Props {
  slot: 1 | 3;
  enabled: boolean;
}

export function CopyTradeToggle({ slot, enabled }: Props) {
  const [wizardVisible, setWizardVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const sendEnable = async () => {
    setBusy(true);
    try {
      const username = useAppStore.getState().username;
      const client = getXmtpClient();
      if (!client) throw new Error('Not connected to chat.');
      const dm = await (client.conversations as any).findOrCreateDm(BOT_INBOX_ID);
      if (!dm) throw new Error('Could not open bot DM.');
      // perTradeSOL intentionally omitted — bot-side defers to the user's
      // real configured AutonoMonke trade weight (see copyTradeFlow.ts).
      await sendDmMessage(dm, `/copy enable ${JSON.stringify({ slot })}`, username);
      useAppStore.getState().setCopyTradeSlot(slot, {
        enabled: true,
        perTradeSOL: DEFAULT_PER_TRADE_SOL, // optimistic display only — corrected by the incoming COPY_TRADE_STATUS: DM
        boundAt: Date.now(),
      });
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not enable copy-trade.');
    } finally {
      setBusy(false);
    }
  };

  const sendDisable = async () => {
    setBusy(true);
    try {
      const username = useAppStore.getState().username;
      const client = getXmtpClient();
      if (!client) throw new Error('Not connected to chat.');
      const dm = await (client.conversations as any).findOrCreateDm(BOT_INBOX_ID);
      if (!dm) throw new Error('Could not open bot DM.');
      await sendDmMessage(dm, `/copy disable ${JSON.stringify({ slot })}`, username);
      useAppStore.getState().setCopyTradeSlot(slot, { enabled: false });
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not disable copy-trade.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = (next: boolean) => {
    if (busy) return;
    if (!next) {
      void sendDisable();
      return;
    }
    const isEnrolled = useAppStore.getState().automonkeStatus?.enrolled ?? false;
    if (!isEnrolled) {
      setWizardVisible(true);
      return;
    }
    void sendEnable();
  };

  const handleWizardClose = () => {
    setWizardVisible(false);
    // If setup just succeeded, automonkeStatus.enrolled was optimistically
    // set true right before AutonoMonkeSetupWizard calls onClose — proceed
    // to the enable step. If the user canceled, enrolled is still false.
    const isEnrolled = useAppStore.getState().automonkeStatus?.enrolled ?? false;
    if (isEnrolled) void sendEnable();
  };

  return (
    <View style={styles.container}>
      <Switch
        value={enabled}
        onValueChange={handleToggle}
        disabled={busy}
        trackColor={{ false: THEME.border, true: THEME.accent + '88' }}
        thumbColor={enabled ? THEME.accent : THEME.textFaint}
      />
      <AutonoMonkeSetupWizard visible={wizardVisible} onClose={handleWizardClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
});
