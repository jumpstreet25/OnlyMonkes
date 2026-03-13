/**
 * SwapConfirmModal
 *
 * Shows swap details (input → output, price impact, slippage) and
 * lets the user confirm or cancel before signing via MWA.
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
import { THEME, FONTS } from "@/lib/constants";
import type { SwapQuote } from "@/lib/jupiterSwap";

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

  const impactColor =
    quote.priceImpactPct > 3
      ? THEME.error
      : quote.priceImpactPct > 1
        ? THEME.warning
        : THEME.success;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>Confirm Swap</Text>

          <View style={styles.row}>
            <Text style={styles.label}>You pay</Text>
            <Text style={styles.value}>
              {quote.inAmountUi.toFixed(6)} {quote.inputSymbol}
            </Text>
          </View>

          <View style={styles.arrowRow}>
            <Text style={styles.arrow}>↓</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>You receive</Text>
            <Text style={styles.value}>
              {quote.outAmountUi.toFixed(6)} {quote.outputSymbol}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.detailLabel}>Price Impact</Text>
            <Text style={[styles.detailValue, { color: impactColor }]}>
              {quote.priceImpactPct.toFixed(2)}%
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.detailLabel}>Slippage</Text>
            <Text style={styles.detailValue}>
              {(quote.slippageBps / 100).toFixed(1)}%
            </Text>
          </View>

          {quote.priceImpactPct > 5 && (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                High price impact! You may lose significant value on this trade.
              </Text>
            </View>
          )}

          <View style={styles.buttonRow}>
            <Pressable
              style={[styles.btn, styles.cancelBtn]}
              onPress={onCancel}
              disabled={isExecuting}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>

            <Pressable
              style={[styles.btn, styles.confirmBtn, isExecuting && styles.btnDisabled]}
              onPress={onConfirm}
              disabled={isExecuting}
            >
              {isExecuting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.confirmBtnText}>Swap</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: THEME.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 20,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 18,
    color: THEME.text,
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
    color: THEME.textMuted,
  },
  value: {
    fontFamily: FONTS.mono,
    fontSize: 16,
    color: THEME.text,
    fontWeight: "600",
  },
  arrowRow: {
    alignItems: "center",
    paddingVertical: 4,
  },
  arrow: {
    fontSize: 20,
    color: THEME.accent,
  },
  divider: {
    height: 1,
    backgroundColor: THEME.border,
    marginVertical: 12,
  },
  detailLabel: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textMuted,
  },
  detailValue: {
    fontFamily: FONTS.mono,
    fontSize: 13,
    color: THEME.text,
  },
  warningBox: {
    backgroundColor: "rgba(239,68,68,0.15)",
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
  },
  warningText: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.error,
    textAlign: "center",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtn: {
    backgroundColor: THEME.surfaceHigh,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  cancelBtnText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 15,
    color: THEME.textMuted,
  },
  confirmBtn: {
    backgroundColor: THEME.accent,
  },
  confirmBtnText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 15,
    color: "#fff",
    fontWeight: "600",
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
