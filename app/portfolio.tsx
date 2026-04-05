import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, StatusBar,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { THEME, FONTS, HELIUS_RPC_URL, SKR_MINT } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";

interface TokenHolding {
  mint: string;
  symbol: string;
  balance: number;
  usdValue?: number;
}

export default function PortfolioScreen() {
  const wallet = useAppStore(s => s.wallet);
  const bananaBalance = useAppStore(s => s.bananaBalance);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokens, setTokens] = useState<TokenHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadPortfolio = useCallback(async () => {
    if (!wallet?.address) return;
    try {
      const connection = new Connection(HELIUS_RPC_URL, "confirmed");

      // SOL balance
      const lamports = await connection.getBalance(new PublicKey(wallet.address));
      setSolBalance(lamports / LAMPORTS_PER_SOL);

      // Token accounts via Helius DAS
      const res = await fetch(HELIUS_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "getTokenAccountsByOwner",
          params: [
            wallet.address,
            { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
            { encoding: "jsonParsed" },
          ],
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      const accounts = data?.result?.value ?? [];

      const holdings: TokenHolding[] = [];
      for (const acct of accounts) {
        const info = acct.account?.data?.parsed?.info;
        if (!info) continue;
        const balance = parseFloat(info.tokenAmount?.uiAmountString ?? "0");
        if (balance <= 0) continue;
        const mint = info.mint ?? "";
        // Known token symbols
        const symbol = mint === SKR_MINT ? "SKR"
          : mint === "So11111111111111111111111111111111" ? "SOL"
          : `${mint.slice(0, 4)}...${mint.slice(-4)}`;
        holdings.push({ mint, symbol, balance });
      }

      // Sort by balance descending
      holdings.sort((a, b) => b.balance - a.balance);
      setTokens(holdings);
    } catch (err) {
      console.warn("[Portfolio] Load failed:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [wallet?.address]);

  useEffect(() => { loadPortfolio(); }, [loadPortfolio]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadPortfolio();
  }, [loadPortfolio]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Portfolio</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={THEME.accent} />}
      >
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={THEME.accent} />
            <Text style={styles.loadingText}>Loading portfolio...</Text>
          </View>
        ) : (
          <>
            {/* SOL Balance Card */}
            <View style={styles.solCard}>
              <Text style={styles.solLabel}>SOL Balance</Text>
              <Text style={styles.solAmount}>
                {solBalance !== null ? solBalance.toFixed(4) : "—"}
              </Text>
              <Text style={styles.solSub}>{wallet?.address?.slice(0, 8)}...{wallet?.address?.slice(-4)}</Text>
            </View>

            {/* Banana Balance */}
            <View style={styles.bananaCard}>
              <Text style={styles.bananaLabel}>🍌 Bananas</Text>
              <Text style={styles.bananaAmount}>{bananaBalance}</Text>
              <Text style={styles.bananaSub}>In-app currency (not tradeable)</Text>
            </View>

            {/* Token Holdings */}
            <Text style={styles.sectionTitle}>
              Token Holdings ({tokens.length})
            </Text>
            {tokens.length === 0 ? (
              <Text style={styles.emptyText}>No SPL tokens found</Text>
            ) : (
              tokens.map((t) => (
                <View key={t.mint} style={styles.tokenRow}>
                  <View>
                    <Text style={styles.tokenSymbol}>{t.symbol}</Text>
                    <Text style={styles.tokenMint}>{t.mint.slice(0, 8)}...{t.mint.slice(-4)}</Text>
                  </View>
                  <Text style={styles.tokenBalance}>{formatBalance(t.balance)}</Text>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function formatBalance(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(6);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 52, paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: THEME.border,
  },
  backText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: "#6CB4EE" },
  headerTitle: { fontFamily: FONTS.display, fontSize: 20, color: THEME.text },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  loadingWrap: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  loadingText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: THEME.textMuted },
  solCard: {
    backgroundColor: "rgba(108,180,238,0.08)", borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: "rgba(108,180,238,0.15)", alignItems: "center",
  },
  solLabel: { fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted },
  solAmount: { fontFamily: FONTS.display, fontSize: 36, color: THEME.text, marginVertical: 4 },
  solSub: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textFaint },
  bananaCard: {
    backgroundColor: "rgba(255,213,79,0.06)", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "rgba(255,213,79,0.12)", alignItems: "center",
  },
  bananaLabel: { fontFamily: FONTS.mono, fontSize: 12, color: "#FFD54F" },
  bananaAmount: { fontFamily: FONTS.display, fontSize: 28, color: "#FFD54F", marginVertical: 2 },
  bananaSub: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint },
  sectionTitle: { fontFamily: FONTS.display, fontSize: 16, color: THEME.text, marginTop: 12 },
  emptyText: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, textAlign: "center", paddingVertical: 20 },
  tokenRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: THEME.surface, borderRadius: 12,
    borderWidth: 1, borderColor: THEME.border,
  },
  tokenSymbol: { fontFamily: FONTS.bodySemi, fontSize: 14, color: THEME.text },
  tokenMint: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint, marginTop: 2 },
  tokenBalance: { fontFamily: FONTS.mono, fontSize: 14, color: THEME.text },
});
