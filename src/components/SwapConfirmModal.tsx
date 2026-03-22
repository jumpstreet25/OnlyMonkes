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
  Modal,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { FONTS, TOKEN_TRADE_FEE_PCT } from "@/lib/constants";
import type { SwapQuote } from "@/lib/jupiterSwap";

const OM_BLUE = "#0096C7";
const OM_BLUE_DIM = "rgba(0, 150, 199, 0.55)";
const BG = "#000000";
const SURFACE = "#0A0A0F";
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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable style={s.backdrop} onPress={onCancel}>
        <Pressable style={s.card} onPress={() => {}}>
          <Text style={s.title}>Confirm Swap</Text>

          <View style={s.row}>
            <Text style={s.label}>You pay</Text>
            <Text style={s.value}>
              {quote.inAmountUi.toFixed(6)} {quote.inputSymbol}
            </Text>
          </View>

          <View style={s.arrowRow}>
            <Text style={s.arrow}>↓</Text>
          </View>

          <View style={s.row}>
            <Text style={s.label}>You receive</Text>
            <Text style={s.value}>
              {quote.outAmountUi.toFixed(6)} {quote.outputSymbol}
            </Text>
          </View>

          <View style={s.divider} />

          <View style={s.row}>
            <Text style={s.detailLabel}>Price Impact</Text>
            <Text style={[s.detailValue, { color: impactColor }]}>
              {quote.priceImpactPct.toFixed(2)}%
            </Text>
          </View>

          <View style={s.row}>
            <Text style={s.detailLabel}>Slippage</Text>
            <Text style={s.detailValue}>
              {(quote.slippageBps / 100).toFixed(1)}%
            </Text>
          </View>

          <View style={s.feeInfoBox}>
            <Text style={s.feeInfoText}>
              {isBuy
                ? `A ${feePct}% fee applies to profits when you sell`
                : `A ${feePct}% fee applies to profits only — no fee if you lost money on this trade`}
            </Text>
          </View>

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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: OM_BLUE,
    textAlign: "center",
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  label: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: OM_BLUE_DIM,
  },
  value: {
    fontFamily: FONTS.mono,
    fontSize: 16,
    color: OM_BLUE,
    fontWeight: "600",
  },
  arrowRow: { alignItems: "center", paddingVertical: 4 },
  arrow: { fontSize: 20, color: OM_BLUE },
  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 12,
  },
  detailLabel: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: OM_BLUE_DIM,
  },
  detailValue: {
    fontFamily: FONTS.mono,
    fontSize: 13,
    color: OM_BLUE,
  },
  feeInfoBox: {
    backgroundColor: "rgba(0, 150, 199, 0.06)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 10,
    marginTop: 10,
  },
  feeInfoText: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: OM_BLUE_DIM,
    textAlign: "center",
    lineHeight: 16,
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
