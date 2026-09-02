/**
 * TradeCloseSharePrompt — mounts PnLCardModal at the root layout so a
 * winning AutonoMonke close's "Post this win" push notification can open
 * the share card from anywhere in the app, not just from tapping the
 * bubble in the bot DM thread. Same mount pattern as BananaBetPopup /
 * BananaBetResultPopup. All the actual capture/share/save logic already
 * lives in PnLCardModal — this is just the global read of the store slot
 * notifications.ts populates on a push tap (see autonomonke_trade_closed
 * handling there).
 */

import React from 'react';
import { useAppStore } from '@/store/appStore';
import { PnLCardModal } from '@/components/PnLCardModal';

export function TradeCloseSharePrompt() {
  const activeTradeCloseCard = useAppStore((s) => s.activeTradeCloseCard);
  const setActiveTradeCloseCard = useAppStore((s) => s.setActiveTradeCloseCard);

  return (
    <PnLCardModal
      trade={activeTradeCloseCard}
      visible={!!activeTradeCloseCard}
      onClose={() => setActiveTradeCloseCard(null)}
    />
  );
}
