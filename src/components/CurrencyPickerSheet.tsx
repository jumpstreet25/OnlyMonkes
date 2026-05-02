/**
 * CurrencyPickerSheet — picks SOL / USDC / SKR for a Banana Shop purchase.
 *
 * Shows the live USD price → token amount conversion, the user's balance for
 * each token, and a 10% off badge for SKR. Disables a row if the user lacks
 * the balance.
 */

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { THEME, FONTS, SKR_MINT, USDC_MINT, HELIUS_RPC_URL } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import {
  fetchSkrPriceUsd,
  fetchSolPriceUsd,
  effectiveUsdCost,
  type ShopCurrency,
} from "@/lib/solana";
import { GlassBottomSheet } from "@/components/GlassBottomSheet";

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
  effUsd: number;       // after discount
  tokenAmount: number;  // estimated, ui units
  balance: number | null; // null = loading
  hasDiscount: boolean;
}

const SOL_MINT = "So11111111111111111111111111111111111111112";

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

        // Fire price + balance fetches in parallel
        const [solPrice, skrPriceRes, solBal, usdcBal, skrBal] = await Promise.all([
          fetchSolPriceUsd().catch(() => 0),
          fetchSkrPriceUsd().catch(() => 0),
          userPub
            ? connection.getBalance(userPub).catch(() => 0)
            : Promise.resolve(0),
          userPub
            ? connection
                .getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), userPub))
                .then((r) => parseFloat(r.value.uiAmountString ?? "0"))
                .catch(() => 0)
            : Promise.resolve(0),
          userPub
            ? connection
                .getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(SKR_MINT), userPub))
                .then((r) => parseFloat(r.value.uiAmountString ?? "0"))
                .catch(() => 0)
            : Promise.resolve(0),
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
            tokenAmount: solPrice > 0 ? solEff / solPrice : 0,
            balance: solBal / 1e9,
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
            tokenAmount: skrPriceRes > 0 ? skrEff / skrPriceRes : 0,
            balance: skrPriceRes > 0 ? skrBal : null, // null = price unavailable
            hasDiscount: true,
          },
        ];
        setRows(built);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Failed to load prices");
      }
    })();
    return () => { cancelled = true; };
  }, [visible, usdCost, wallet?.address]);

  const handleChoose = (currency: ShopCurrency) => {
    Haptics.selectionAsync().catch(() => {});
    onChoose(currency);
  };

  return (
    <GlassBottomSheet visible={visible} onClose={onClose} snapPoints={["55%"]}>
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
              const sufficient =
                row.balance !== null && row.balance >= row.tokenAmount;
              const priceUnavailable =
                row.tokenAmount === 0 && row.currency !== "USDC";
              const disabled = priceUnavailable || !sufficient;
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
                      Balance: {row.balance === null ? "—" : formatTokenAmount(row.balance, row.currency)} {row.symbol}
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

        <Text style={styles.disclaimer}>
          You'll sign a wallet transaction to complete. Crypto payment is non-refundable.
        </Text>
      </View>
    </GlassBottomSheet>
  );
}

function formatTokenAmount(amount: number, currency: ShopCurrency): string {
  if (currency === "USDC") return amount.toFixed(2);
  if (currency === "SOL") return amount.toFixed(4);
  return amount.toFixed(2); // SKR
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
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
  loadingText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textMuted,
  },
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
  rowLabel: {
    fontFamily: FONTS.displayMed,
    fontSize: 15,
    color: THEME.text,
  },
  rowAmount: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: THEME.textMuted,
  },
  rowBalance: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
  },
  rowRight: { alignItems: "flex-end", gap: 4 },
  rowUsd: {
    fontFamily: FONTS.display,
    fontSize: 16,
    color: "#FFD54F",
  },
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
  disclaimer: {
    fontFamily: FONTS.body,
    fontSize: 10,
    color: THEME.textFaint,
    textAlign: "center",
    marginTop: 18,
    lineHeight: 14,
  },
});
