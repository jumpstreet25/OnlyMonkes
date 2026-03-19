/**
 * AutoMonkeDisclaimerModal
 *
 * Full-screen risk disclaimer for AutonoMonke autonomous trading.
 * User must check the checkbox and tap "Enable" to proceed.
 * On confirm: sends DM "/automonke start" to bot, navigates to DM screen.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
} from "react-native";
import { THEME, FONTS } from "@/lib/constants";

interface AutoMonkeDisclaimerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function AutoMonkeDisclaimerModal({
  visible,
  onClose,
  onConfirm,
}: AutoMonkeDisclaimerModalProps) {
  const [accepted, setAccepted] = useState(false);

  const handleConfirm = () => {
    if (!accepted) return;
    setAccepted(false);
    onConfirm();
  };

  const handleClose = () => {
    setAccepted(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
            <Text style={styles.title}>AutonoMonke</Text>
            <Text style={styles.subtitle}>Autonomous Trading</Text>

            <View style={styles.warningBadge}>
              <Text style={styles.warningText}>HIGH RISK</Text>
            </View>

            <Text style={styles.sectionTitle}>What is AutonoMonke?</Text>
            <Text style={styles.body}>
              AutonoMonke is an autonomous trading bot that uses AI-powered
              technical analysis to buy and sell Solana tokens on your behalf.
              It creates a separate hot wallet that you fund with SOL.
            </Text>

            <Text style={styles.sectionTitle}>Risk Disclaimer</Text>

            <View style={styles.riskItem}>
              <Text style={styles.riskBullet}>1.</Text>
              <Text style={styles.riskText}>
                <Text style={styles.riskBold}>RISK OF TOTAL LOSS: </Text>
                Autonomous trading carries significant risk. You may lose some
                or ALL of your deposited funds. Only deposit what you can afford
                to lose entirely.
              </Text>
            </View>

            <View style={styles.riskItem}>
              <Text style={styles.riskBullet}>2.</Text>
              <Text style={styles.riskText}>
                <Text style={styles.riskBold}>NO GUARANTEES: </Text>
                Past performance does not guarantee future results. No trading
                system is 100% accurate. Markets are unpredictable.
              </Text>
            </View>

            <View style={styles.riskItem}>
              <Text style={styles.riskBullet}>3.</Text>
              <Text style={styles.riskText}>
                <Text style={styles.riskBold}>EXPERIMENTAL SOFTWARE: </Text>
                AutonoMonke is experimental. Bugs, network issues, slippage,
                or extreme market conditions may cause unexpected losses.
              </Text>
            </View>

            <View style={styles.riskItem}>
              <Text style={styles.riskBullet}>4.</Text>
              <Text style={styles.riskText}>
                <Text style={styles.riskBold}>HOT WALLET SECURITY: </Text>
                A separate Solana wallet is created and managed server-side.
                Private keys are encrypted at rest but are not under your
                direct control.
              </Text>
            </View>

            <View style={styles.riskItem}>
              <Text style={styles.riskBullet}>5.</Text>
              <Text style={styles.riskText}>
                <Text style={styles.riskBold}>NO RESPONSIBILITY: </Text>
                OnlyMonkes, its developers, and contributors accept NO
                responsibility for any financial losses incurred through
                AutonoMonke trading.
              </Text>
            </View>

            <View style={styles.riskItem}>
              <Text style={styles.riskBullet}>6.</Text>
              <Text style={styles.riskText}>
                <Text style={styles.riskBold}>YOUR DECISION: </Text>
                By enabling AutonoMonke, you acknowledge that you are solely
                responsible for funding, configuring, and monitoring this
                service.
              </Text>
            </View>

            <Text style={styles.sectionTitle}>How It Works</Text>
            <Text style={styles.body}>
              {"\u2022"} A dedicated hot wallet is created for your trading{"\n"}
              {"\u2022"} You fund it by sending SOL to the wallet address{"\n"}
              {"\u2022"} The bot uses TA signals + AI confidence to enter trades{"\n"}
              {"\u2022"} Stop-losses and profit targets are set automatically{"\n"}
              {"\u2022"} Profits above your threshold are swept to your main wallet{"\n"}
              {"\u2022"} You can pause, withdraw, or delete at any time via DM
            </Text>
          </ScrollView>

          {/* Checkbox */}
          <Pressable
            style={styles.checkboxRow}
            onPress={() => setAccepted(!accepted)}
          >
            <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
              {accepted && <Text style={styles.checkmark}>{"\u2713"}</Text>}
            </View>
            <Text style={styles.checkboxLabel}>
              I understand the risks and want to proceed
            </Text>
          </Pressable>

          {/* Buttons */}
          <View style={styles.buttonRow}>
            <Pressable style={styles.cancelBtn} onPress={handleClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.confirmBtn, !accepted && styles.confirmBtnDisabled]}
              onPress={handleConfirm}
              disabled={!accepted}
            >
              <Text style={[styles.confirmText, !accepted && styles.confirmTextDisabled]}>
                Enable AutonoMonke
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  container: {
    width: "100%",
    maxHeight: "90%",
    backgroundColor: THEME.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.border,
    overflow: "hidden",
  },
  scrollArea: {
    maxHeight: 500,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 8,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 24,
    color: THEME.text,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 12,
  },
  warningBadge: {
    alignSelf: "center",
    backgroundColor: "rgba(239, 68, 68, 0.2)",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
    marginBottom: 20,
  },
  warningText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 12,
    color: THEME.error,
    letterSpacing: 1,
  },
  sectionTitle: {
    fontFamily: FONTS.displayMed,
    fontSize: 16,
    color: THEME.text,
    marginTop: 16,
    marginBottom: 8,
  },
  body: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textMuted,
    lineHeight: 20,
  },
  riskItem: {
    flexDirection: "row",
    marginBottom: 10,
    paddingRight: 8,
  },
  riskBullet: {
    fontFamily: FONTS.bodySemi,
    fontSize: 13,
    color: THEME.error,
    width: 20,
  },
  riskText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textMuted,
    lineHeight: 20,
    flex: 1,
  },
  riskBold: {
    fontFamily: FONTS.bodySemi,
    color: THEME.text,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: THEME.textFaint,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  checkboxChecked: {
    borderColor: THEME.accent,
    backgroundColor: THEME.accentSoft,
  },
  checkmark: {
    fontSize: 14,
    color: THEME.accent,
    fontWeight: "700",
  },
  checkboxLabel: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: THEME.text,
    flex: 1,
  },
  buttonRow: {
    flexDirection: "row",
    padding: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: THEME.surfaceHigh,
    alignItems: "center",
  },
  cancelText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.textMuted,
  },
  confirmBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: THEME.accent,
    alignItems: "center",
  },
  confirmBtnDisabled: {
    backgroundColor: THEME.surfaceHigh,
    opacity: 0.5,
  },
  confirmText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 14,
    color: "#fff",
  },
  confirmTextDisabled: {
    color: THEME.textFaint,
  },
});
