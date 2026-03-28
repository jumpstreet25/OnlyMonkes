/**
 * AutoMonkeDisclaimerModal
 *
 * Full-screen risk + fee disclaimer for AutonoMonke autonomous trading.
 * Black background, OnlyMonkes blue text, "I Understand" / "Decline" buttons.
 * On confirm: sends DM "/automonke start" to bot, navigates to DM screen.
 */

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import { GlassModal } from "@/components/GlassModal";
import { FONTS } from "@/lib/constants";

const OM_BLUE = "#0096C7";
const OM_BLUE_DIM = "rgba(0, 150, 199, 0.55)";
const BORDER = "rgba(0, 150, 199, 0.15)";
const RED = "#EF4444";
const GOLD = "#F59E0B";

export type AutonomyFeature = "trades" | "bets" | "predictions";

const FEATURE_LABELS: Record<AutonomyFeature, { title: string; subtitle: string }> = {
  trades:      { title: "AutonoMonke",      subtitle: "Autonomous Trading" },
  bets:        { title: "MonkeBets",        subtitle: "Autonomous Sports Betting" },
  predictions: { title: "MonkePredictions", subtitle: "Autonomous Predictions" },
};

interface AutoMonkeDisclaimerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  feature?: AutonomyFeature;
}

export default function AutoMonkeDisclaimerModal({
  visible,
  onClose,
  onConfirm,
  feature = "trades",
}: AutoMonkeDisclaimerModalProps) {
  const labels = FEATURE_LABELS[feature];
  return (
    <GlassModal visible={visible} onClose={onClose} cardStyle={s.container}>
          <ScrollView
            style={s.scrollArea}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={s.title}>{labels.title}</Text>
            <Text style={s.subtitle}>{labels.subtitle}</Text>

            <View style={s.warningBadge}>
              <Text style={s.warningText}>HIGH RISK</Text>
            </View>

            <Text style={s.sectionTitle}>What is AutonoMonke?</Text>
            <Text style={s.body}>
              AutonoMonke is an autonomous trading bot that uses AI-powered
              technical analysis to buy and sell Solana tokens on your behalf.
              It creates a separate hot wallet that you fund with SOL.
            </Text>

            <Text style={s.sectionTitle}>Risk Disclaimer</Text>

            {RISKS.map(({ num, bold, text }) => (
              <View key={num} style={s.riskItem}>
                <Text style={s.riskBullet}>{num}.</Text>
                <Text style={s.riskText}>
                  <Text style={s.riskBold}>{bold} </Text>
                  {text}
                </Text>
              </View>
            ))}

            <Text style={s.sectionTitle}>Trading Fees</Text>
            <Text style={s.body}>
              Fees are only charged on profitable trades — you pay nothing
              if you lose money. NFT sale fees apply to the sale price.
            </Text>

            <View style={s.feeTable}>
              <FeeRow label="NFT Sales (MonkeMarkets)" value="2%" />
              <FeeRow label="Token Trades — on profit" value="3%" />
              <FeeRow label="AutonoMonke — on profit" value="5%" last />
            </View>

            <Text style={s.sectionTitle}>How It Works</Text>
            <Text style={s.body}>
              {"\u2022"} A dedicated hot wallet is created for your trading{"\n"}
              {"\u2022"} You fund it by sending SOL to the wallet address{"\n"}
              {"\u2022"} The bot uses TA signals + AI confidence to enter trades{"\n"}
              {"\u2022"} Stop-losses and profit targets are set automatically{"\n"}
              {"\u2022"} Profits above your threshold are swept to your main wallet{"\n"}
              {"\u2022"} You can pause, withdraw, or delete at any time via DM
            </Text>

            <View style={{ height: 12 }} />
          </ScrollView>

          {/* ── Buttons ──────────────────────────────────────────────────── */}
          <View style={s.buttonRow}>
            <Pressable
              style={({ pressed }) => [s.btn, s.declineBtn, pressed && s.btnPressed]}
              onPress={onClose}
            >
              <Text style={s.declineText}>Decline</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.btn, s.acceptBtn, pressed && s.btnPressed]}
              onPress={onConfirm}
            >
              <Text style={s.acceptText}>I Understand</Text>
            </Pressable>
          </View>
    </GlassModal>
  );
}

// ── Risk items ────────────────────────────────────────────────────────────────

const RISKS = [
  { num: 1, bold: "RISK OF TOTAL LOSS:", text: "Autonomous trading carries significant risk. You may lose some or ALL of your deposited funds. Only deposit what you can afford to lose entirely." },
  { num: 2, bold: "NO GUARANTEES:", text: "Past performance does not guarantee future results. No trading system is 100% accurate. Markets are unpredictable." },
  { num: 3, bold: "EXPERIMENTAL SOFTWARE:", text: "AutonoMonke is experimental. Bugs, network issues, slippage, or extreme market conditions may cause unexpected losses." },
  { num: 4, bold: "HOT WALLET SECURITY:", text: "A separate Solana wallet is created and managed server-side. Private keys are encrypted at rest but are not under your direct control." },
  { num: 5, bold: "NO RESPONSIBILITY:", text: "OnlyMonkes, its developers, and contributors accept NO responsibility for any financial losses incurred through AutonoMonke trading." },
  { num: 6, bold: "YOUR DECISION:", text: "By tapping \"I Understand\", you acknowledge that you are solely responsible for funding, configuring, and monitoring this service." },
];

function FeeRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[s.feeRow, !last && s.feeRowBorder]}>
      <Text style={s.feeLabel}>{label}</Text>
      <Text style={s.feeValue}>{value}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: {
    maxHeight: "92%",
    overflow: "hidden",
    padding: 0,
  },
  scrollArea: { flexShrink: 1 },
  scrollContent: { padding: 20, paddingBottom: 8 },

  title: {
    fontFamily: FONTS.display,
    fontSize: 26,
    color: OM_BLUE,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: OM_BLUE_DIM,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 14,
  },
  warningBadge: {
    alignSelf: "center",
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.35)",
    marginBottom: 20,
  },
  warningText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 12,
    color: RED,
    letterSpacing: 1.5,
  },

  sectionTitle: {
    fontFamily: FONTS.displayMed,
    fontSize: 16,
    color: OM_BLUE,
    marginTop: 18,
    marginBottom: 8,
  },
  body: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: OM_BLUE_DIM,
    lineHeight: 20,
  },

  riskItem: { flexDirection: "row", marginBottom: 10, paddingRight: 8 },
  riskBullet: { fontFamily: FONTS.bodySemi, fontSize: 13, color: RED, width: 20 },
  riskText: { fontFamily: FONTS.body, fontSize: 13, color: OM_BLUE_DIM, lineHeight: 20, flex: 1 },
  riskBold: { fontFamily: FONTS.bodySemi, color: OM_BLUE },

  feeTable: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
  },
  feeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  feeRowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  feeLabel: { fontFamily: FONTS.body, fontSize: 13, color: OM_BLUE_DIM, flex: 1 },
  feeValue: { fontFamily: FONTS.bodySemi, fontSize: 15, color: GOLD },

  // Buttons
  buttonRow: {
    flexDirection: "row",
    padding: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  btnPressed: { opacity: 0.7 },
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
