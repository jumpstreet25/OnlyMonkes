/**
 * SwapConfirmModal
 *
 * Shows swap details (input → output, price impact, slippage, fee policy)
 * and lets the user confirm or cancel before signing via MWA.
 *
 * Black background, OnlyMonkes blue text — consistent disclaimer styling.
 */

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { GlassModal } from "@/components/GlassModal";
import { FONTS, TOKEN_TRADE_FEE_PCT } from "@/lib/constants";
import type { SwapQuote } from "@/lib/jupiterSwap";

const OM_BLUE = "#0096C7";
const OM_BLUE_DIM = "rgba(0, 150, 199, 0.55)";
const BORDER = "rgba(0, 150, 199, 0.15)";
const RED = "#EF4444";
const GOLD = "#F59E0B";
const GREEN = "#10B981";

interface SwapConfirmModalProps {
  visible: boolean;
  quote: SwapQuote | null;
  isExecuting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SwapConfirmModal({
  visible,
  quote,
  isExecuting,
  onConfirm,
  onCancel,
}: SwapConfirmModalProps) {
  if (!quote) return null;

  const feePct = TOKEN_TRADE_FEE_PCT * 100;
  const isBuy = quote.inputSymbol === "SOL";

  const impactColor =
    quote.priceImpactPct > 3
      ? RED
      : quote.priceImpactPct > 1
        ? GOLD
        : GREEN;

  return (
    <GlassModal visible={visible} onClose={onCancel}>
          <Text style={s.title}>Confirm Swap</Text>

          <View style={s.swapRow}>
            <Text style={s.swapAmount} numberOfLines={1}>
              {quote.inAmountUi.toFixed(6)} {quote.inputSymbol}
            </Text>
            <Text style={s.swapArrow}>→</Text>
            <Text style={s.swapAmount} numberOfLines={1}>
              {quote.outAmountUi.toFixed(6)} {quote.outputSymbol}
            </Text>
          </View>

          <View style={s.row}>
            <Text style={s.detailLabel}>
              Impact <Text style={{ color: impactColor }}>{quote.priceImpactPct.toFixed(2)}%</Text>
              {"   ·   "}
              Slippage {(quote.slippageBps / 100).toFixed(1)}%
            </Text>
          </View>

          <Text style={s.feeCaption}>
            {isBuy
              ? `${feePct}% fee on profits when you sell`
              : `${feePct}% fee on profits only — none if this trade lost money`}
          </Text>

          {quote.priceImpactPct > 5 && (
            <View style={s.warningBox}>
              <Text style={s.warningText}>
                High price impact! You may lose significant value on this trade.
              </Text>
            </View>
          )}

          <View style={s.buttonRow}>
            <Pressable
              style={({ pressed }) => [s.btn, s.declineBtn, pressed && s.btnPressed]}
              onPress={onCancel}
              disabled={isExecuting}
            >
              <Text style={s.declineText}>Decline</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                s.btn, s.acceptBtn,
                isExecuting && s.btnDisabled,
                pressed && s.btnPressed,
              ]}
              onPress={onConfirm}
              disabled={isExecuting}
            >
              {isExecuting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={s.acceptText}>I Understand</Text>
              )}
            </Pressable>
          </View>
    </GlassModal>
  );
}

const s = StyleSheet.create({
  title: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: OM_BLUE,
    textAlign: "center",
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 4,
  },
  swapRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
  },
  swapAmount: {
    fontFamily: FONTS.mono,
    fontSize: 15,
    color: OM_BLUE,
    fontWeight: "600",
    flexShrink: 1,
  },
  swapArrow: { fontSize: 16, color: OM_BLUE_DIM },
  detailLabel: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: OM_BLUE_DIM,
  },
  feeCaption: {
    fontFamily: FONTS.body,
    fontSize: 10,
    color: OM_BLUE_DIM,
    textAlign: "center",
    marginTop: 8,
  },
  warningBox: {
    backgroundColor: "rgba(239,68,68,0.12)",
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  warningText: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: RED,
    textAlign: "center",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPressed: { opacity: 0.7 },
  btnDisabled: { opacity: 0.5 },
  declineBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.35)",
  },
  declineText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 15,
    color: RED,
  },
  acceptBtn: {
    backgroundColor: OM_BLUE,
  },
  acceptText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 15,
    color: "#fff",
  },
});
