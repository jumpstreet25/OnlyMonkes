/**
 * CurrencyPickerSheet — picks SOL / USDC / SKR for a Banana Shop purchase.
 *
 * Uses a native React Native <Modal> with slide-up animation rather than
 * @gorhom/bottom-sheet. Bottom-sheet gestures get eaten when mounted inside
 * another <Modal> (parent BananaShopModal), so a plain Modal is more reliable.
 *
 * Shows the live USD price → token amount conversion, the user's balance for
 * each token, and a 10% off badge for SKR. Disables a row if the user lacks
 * the balance. Always exposes a close button so the user can back out.
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Modal,
  Animated,
  Easing,
  Dimensions,
} from "react-native";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { THEME, FONTS, SKR_MINT, USDC_MINT, HELIUS_RPC_URL, DEV_WALLET } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import {
  fetchSkrPriceUsd,
  fetchSolPriceUsd,
  effectiveUsdCost,
  type ShopCurrency,
} from "@/lib/solana";

const { height: SCREEN_H } = Dimensions.get("window");

interface CurrencyPickerSheetProps {
  visible: boolean;
  usdCost: number;
  itemName: string;
  onClose: () => void;
  onChoose: (currency: ShopCurrency) => void;
}

interface CurrencyRow {
  currency: ShopCurrency;
  label: string;
  symbol: string;
  effUsd: number;
  tokenAmount: number;
  balance: number | null;
  hasDiscount: boolean;
}

export function CurrencyPickerSheet({
  visible,
  usdCost,
  itemName,
  onClose,
  onChoose,
}: CurrencyPickerSheetProps) {
  const wallet = useAppStore((s) => s.wallet);
  const [rows, setRows] = useState<CurrencyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slideAnim = React.useRef(new Animated.Value(SCREEN_H)).current;

  // Slide-up animation tied to visibility.
  //
  // useNativeDriver MUST stay false: native transforms break Android touch
  // hit-testing when the picker is mounted inside another <Modal>
  // (BananaShopModal). The sheet slides up visually on the UI thread but the
  // JS-side hit-target stays at the off-screen origin, so row taps miss.
  useEffect(() => {
    if (visible) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: SCREEN_H,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }).start();
    }
  }, [visible, slideAnim]);

  // Fetch prices + balances when sheet becomes visible
  useEffect(() => {
    if (!visible) {
      setRows(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const connection = new Connection(HELIUS_RPC_URL, "confirmed");
        const userPub = wallet?.address ? new PublicKey(wallet.address) : null;

        // Balance fetches return `null` on failure (RPC error, missing ATA)
        // so we can distinguish "user has 0" (number) from "we don't know"
        // (null). Unknown balances let the row stay tappable — Solflare/MWA
        // checks the real balance at signing time and rejects gracefully if
        // truly insufficient. This prevents a transient Helius blip from
        // dead-locking the picker for any non-dev user with funds.
        const [solPrice, skrPriceRes, solBal, usdcBal, skrBal] = await Promise.all<
          number | null
        >([
          fetchSolPriceUsd().catch(() => null),
          fetchSkrPriceUsd().catch(() => null),
          userPub
            ? connection.getBalance(userPub).catch(() => null)
            : Promise.resolve(null),
          userPub
            ? connection
                .getTokenAccountBalance(
                  getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), userPub),
                )
                .then((r) => parseFloat(r.value.uiAmountString ?? "0"))
                .catch(() => null)
            : Promise.resolve(null),
          userPub
            ? connection
                .getTokenAccountBalance(
                  getAssociatedTokenAddressSync(new PublicKey(SKR_MINT), userPub),
                )
                .then((r) => parseFloat(r.value.uiAmountString ?? "0"))
                .catch(() => null)
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        const solEff = effectiveUsdCost(usdCost, "SOL");
        const usdcEff = effectiveUsdCost(usdCost, "USDC");
        const skrEff = effectiveUsdCost(usdCost, "SKR");

        const built: CurrencyRow[] = [
          {
            currency: "SOL",
            label: "Solana",
            symbol: "SOL",
            effUsd: solEff,
            tokenAmount: solPrice && solPrice > 0 ? solEff / solPrice : 0,
            balance: solBal === null ? null : solBal / 1e9,
            hasDiscount: false,
          },
          {
            currency: "USDC",
            label: "USDC",
            symbol: "USDC",
            effUsd: usdcEff,
            tokenAmount: usdcEff,
            balance: usdcBal,
            hasDiscount: false,
          },
          {
            currency: "SKR",
            label: "SKR",
            symbol: "SKR",
            effUsd: skrEff,
            tokenAmount: skrPriceRes && skrPriceRes > 0 ? skrEff / skrPriceRes : 0,
            balance: skrPriceRes && skrPriceRes > 0 ? skrBal : null,
            hasDiscount: true,
          },
        ];
        setRows(built);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Failed to load prices");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, usdCost, wallet?.address]);

  const handleChoose = (currency: ShopCurrency) => {
    Haptics.selectionAsync().catch(() => {});
    onChoose(currency);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Wrap both children in a single root so Android keeps a stable view
          hierarchy. Without this, the Pressable backdrop and the sliding sheet
          are direct Modal children, and Android can collapse/reorder them in
          ways that let the backdrop steal touches from the row Pressables. */}
      <View style={{ flex: 1 }} collapsable={false}>
        {/* Backdrop — tap to close */}
        <Pressable style={styles.backdrop} onPress={onClose}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.dimLayer} />
        </Pressable>

        {/* Sliding sheet */}
        <Animated.View
          collapsable={false}
          style={[
            styles.sheet,
            { transform: [{ translateY: slideAnim }] },
          ]}
        >
        <LinearGradient
          colors={["rgba(248,248,255,0.06)", "rgba(0,0,0,0.15)"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}
        />
        <View style={styles.highlight} />
        <View style={styles.handle} />

        {/* Close button — always available */}
        <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>

        <View style={styles.container}>
          <Text style={styles.title}>Pay for {itemName}</Text>
          <Text style={styles.subtitle}>${usdCost.toFixed(2)} · pick your currency</Text>

          {!rows && !error && (
            <View style={styles.loading}>
              <ActivityIndicator color={THEME.accent} />
              <Text style={styles.loadingText}>Fetching prices…</Text>
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          {rows && (
            <View style={styles.rows}>
              {rows.map((row) => {
                // priceUnavailable: SOL/SKR can't be quoted without their USD
                // price (we need it to convert USD cost → token amount). USDC
                // is always 1:1, so it's never priceUnavailable.
                const priceUnavailable =
                  row.tokenAmount === 0 && row.currency !== "USDC";
                // balanceUnknown: our app-side fetch failed (RPC blip, missing
                // ATA on USDC/SKR, etc). DON'T disable in this case — the user
                // may genuinely hold the token; let Solflare/MWA validate at
                // signing time and reject gracefully if truly insufficient.
                const balanceUnknown = row.balance === null;
                const knownInsufficient =
                  row.balance !== null && row.balance < row.tokenAmount;
                // Dev wallet bypasses every check (matches the dev short-circuit
                // in BananaShopModal.onChoose).
                const isDev = wallet?.address === DEV_WALLET;
                const disabled = isDev ? false : (priceUnavailable || knownInsufficient);
                const sufficient =
                  row.balance !== null && row.balance >= row.tokenAmount;
                return (
                  <Pressable
                    key={row.currency}
                    style={[styles.row, disabled && styles.rowDisabled]}
                    onPress={() => !disabled && handleChoose(row.currency)}
                    disabled={disabled}
                  >
                    <View style={styles.rowLeft}>
                      <Text style={styles.rowLabel}>{row.label}</Text>
                      <Text style={styles.rowAmount}>
                        {priceUnavailable
                          ? "Price unavailable"
                          : `${formatTokenAmount(row.tokenAmount, row.currency)} ${row.symbol}`}
                      </Text>
                      <Text style={styles.rowBalance}>
                        Balance:{" "}
                        {row.balance === null
                          ? "—"
                          : formatTokenAmount(row.balance, row.currency)}{" "}
                        {row.symbol}
                      </Text>
                    </View>
                    <View style={styles.rowRight}>
                      <Text style={styles.rowUsd}>${row.effUsd.toFixed(2)}</Text>
                      {row.hasDiscount && (
                        <View style={styles.discountPill}>
                          <Text style={styles.discountText}>10% off</Text>
                        </View>
                      )}
                      {!sufficient && row.balance !== null && !priceUnavailable && (
                        <Text style={styles.insufficientText}>Insufficient</Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>

          <Text style={styles.disclaimer}>
            You'll sign a wallet transaction to complete. Crypto payment is non-refundable.
          </Text>
        </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function formatTokenAmount(amount: number, currency: ShopCurrency): string {
  if (currency === "USDC") return amount.toFixed(2);
  if (currency === "SOL") return amount.toFixed(4);
  return amount.toFixed(2);
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  dimLayer: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(12,12,22,0.96)",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: "rgba(248,248,255,0.10)",
    overflow: "hidden",
    paddingTop: 8,
    paddingBottom: 32,
  },
  highlight: {
    position: "absolute",
    top: 0,
    left: 24,
    right: 24,
    height: 1.5,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 1,
  },
  handle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginTop: 6,
    marginBottom: 6,
  },
  closeBtn: {
    position: "absolute",
    top: 14,
    right: 18,
    zIndex: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { fontSize: 14, color: THEME.textMuted },
  container: { paddingHorizontal: 20, paddingTop: 14 },
  title: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: THEME.text,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textMuted,
    marginBottom: 16,
  },
  loading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 30,
    justifyContent: "center",
  },
  loadingText: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted },
  error: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.error,
    paddingVertical: 20,
    textAlign: "center",
  },
  rows: { gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 14,
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowDisabled: { opacity: 0.4 },
  rowLeft: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: FONTS.displayMed, fontSize: 15, color: THEME.text },
  rowAmount: { fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted },
  rowBalance: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint },
  rowRight: { alignItems: "flex-end", gap: 4 },
  rowUsd: { fontFamily: FONTS.display, fontSize: 16, color: "#FFD54F" },
  discountPill: {
    backgroundColor: "rgba(20,241,149,0.12)",
    borderWidth: 0.75,
    borderColor: "rgba(20,241,149,0.30)",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  discountText: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: "#14F195",
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  insufficientText: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.error,
    letterSpacing: 0.3,
  },
  cancelBtn: {
    marginTop: 16,
    paddingVertical: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
  },
  cancelText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.textMuted,
  },
  disclaimer: {
    fontFamily: FONTS.body,
    fontSize: 10,
    color: THEME.textFaint,
    textAlign: "center",
    marginTop: 14,
    lineHeight: 14,
    paddingHorizontal: 8,
  },
});
