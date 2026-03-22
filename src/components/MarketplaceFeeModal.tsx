/**
 * MarketplaceFeeModal
 *
 * One-time fee agreement popup shown before a user's first NFT listing.
 * Black background, OnlyMonkes blue text, "I Understand" / "Decline" buttons.
 *
 * Acceptance is persisted in AsyncStorage so it only shows once.
 */

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FONTS } from "@/lib/constants";

const AK_FEE_ACCEPTED = "om_nft_fee_accepted_v1";

const OM_BLUE = "#0096C7";
const OM_BLUE_DIM = "rgba(0, 150, 199, 0.55)";
const BG = "#000000";
const SURFACE = "#0A0A0F";
const BORDER = "rgba(0, 150, 199, 0.15)";
const RED = "#EF4444";
const GOLD = "#F59E0B";

interface MarketplaceFeeModalProps {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

/** Check if the user has already accepted the marketplace fee agreement. */
export async function hasAcceptedMarketplaceFee(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(AK_FEE_ACCEPTED)) === "1";
  } catch {
    return false;
  }
}

/** Persist acceptance. */
export async function acceptMarketplaceFee(): Promise<void> {
  await AsyncStorage.setItem(AK_FEE_ACCEPTED, "1").catch(() => {});
}

export default function MarketplaceFeeModal({
  visible,
  onAccept,
  onDecline,
}: MarketplaceFeeModalProps) {
  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent>
      <View style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.title}>MonkeMarkets Fee Agreement</Text>

          <Text style={s.body}>
            A <Text style={s.highlight}>2% fee</Text> is deducted from the sale
            price of every NFT sold through MonkeMarkets. The fee is sent to the
            dev wallet to support ongoing OnlyMonkes development.
          </Text>

          <View style={s.exampleBox}>
            <Text style={s.exampleTitle}>Example</Text>
            <View style={s.exampleRow}>
              <Text style={s.exampleLabel}>You list for</Text>
              <Text style={s.exampleValue}>10 SOL</Text>
            </View>
            <View style={s.exampleRow}>
              <Text style={s.exampleLabel}>Fee (2%)</Text>
              <Text style={[s.exampleValue, { color: GOLD }]}>0.2 SOL</Text>
            </View>
            <View style={[s.exampleRow, { borderBottomWidth: 0 }]}>
              <Text style={s.exampleLabel}>You receive</Text>
              <Text style={[s.exampleValue, { color: OM_BLUE }]}>9.8 SOL</Text>
            </View>
          </View>

          <Text style={s.note}>
            The fee is built into the atomic swap transaction — the buyer pays
            the listed price and you receive 98%. No hidden charges.
          </Text>

          <View style={s.buttonRow}>
            <Pressable
              style={({ pressed }) => [s.btn, s.declineBtn, pressed && s.btnPressed]}
              onPress={onDecline}
            >
              <Text style={s.declineText}>Decline</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.btn, s.acceptBtn, pressed && s.btnPressed]}
              onPress={onAccept}
            >
              <Text style={s.acceptText}>I Understand</Text>
            </Pressable>
          </View>
        </View>
      </View>
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
    maxWidth: 380,
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 22,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: OM_BLUE,
    textAlign: "center",
    marginBottom: 16,
  },
  body: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: OM_BLUE_DIM,
    lineHeight: 21,
    textAlign: "center",
  },
  highlight: {
    fontFamily: FONTS.bodySemi,
    color: OM_BLUE,
  },
  exampleBox: {
    marginTop: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
  },
  exampleTitle: {
    fontFamily: FONTS.bodySemi,
    fontSize: 12,
    color: OM_BLUE_DIM,
    textAlign: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  exampleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  exampleLabel: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: OM_BLUE_DIM,
  },
  exampleValue: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    color: OM_BLUE,
    fontWeight: "600",
  },
  note: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: OM_BLUE_DIM,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 14,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
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
