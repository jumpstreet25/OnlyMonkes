import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, StatusBar,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { THEME, FONTS, SOLANA_RPC_URL, SKR_MINT } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { MiniChart } from "@/components/MiniChart";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { ChartModal } from "@/components/ChartModal";

interface TokenHolding {
  mint: string;
  symbol: string;
  balance: number;
  usdPrice?: number;
  usdValue?: number;
  change24h?: number;
  sparkline?: number[];
}

// ─── Jupiter token list cache ───────────────────────────────────────────────

let _jupTokenMap: Map<string, { symbol: string; name: string }> | null = null;

async function getJupTokenMap(): Promise<Map<string, { symbol: string; name: string }>> {
  if (_jupTokenMap) return _jupTokenMap;
  try {
    const res = await fetchWithTimeout("https://token.jup.ag/strict", { timeoutMs: 8000 });
    if (!res.ok) return new Map();
    const data = await res.json();
    const map = new Map<string, { symbol: string; name: string }>();
    for (const t of data) {
      map.set(t.address, { symbol: t.symbol, name: t.name });
    }
    _jupTokenMap = map;
    return map;
  } catch {
    return new Map();
  }
}

// ─── Price + sparkline fetching ─────────────────────────────────────────────

async function fetchPrices(mints: string[]): Promise<Record<string, number>> {
  if (!mints.length) return {};
  try {
    const ids = mints.join(",");
    const res = await fetchWithTimeout(`https://api.jup.ag/price/v2?ids=${ids}`, { timeoutMs: 8000 });
    if (!res.ok) return {};
    const data = await res.json();
    const out: Record<string, number> = {};
    for (const mint of mints) {
      const p = data?.data?.[mint]?.price;
      if (p) out[mint] = parseFloat(p);
    }
    return out;
  } catch {
    return {};
  }
}

async function fetchSparkline(mint: string): Promise<number[]> {
  try {
    const searchRes = await fetchWithTimeout(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
      { timeoutMs: 5000 },
    );
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const pair = searchData?.pairs?.[0];
    if (!pair?.pairAddress) return [];

    const start = Math.floor((Date.now() - 24 * 3600000) / 1000);
    const dpRes = await fetchWithTimeout(
      `https://api.dexpaprika.com/networks/solana/pools/${pair.pairAddress}/ohlcv?start=${start}&limit=24&interval=1h`,
      { timeoutMs: 5000 },
    );
    if (!dpRes.ok) return [];
    const dpData = await dpRes.json();
    if (!Array.isArray(dpData)) return [];
    return dpData.map((c: any) => parseFloat(c.close)).filter((n: number) => !isNaN(n) && n > 0);
  } catch {
    return [];
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function PortfolioScreen() {
  const wallet = useAppStore(s => s.wallet);
  const bananaBalance = useAppStore(s => s.bananaBalance);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [tokens, setTokens] = useState<TokenHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [chartSymbol, setChartSymbol] = useState("");

  const loadPortfolio = useCallback(async () => {
    if (!wallet?.address) return;
    try {
      // Plain SOL/token-account balance reads don't need Helius's indexing —
      // route through the free public RPC to keep this off the shared,
      // often-maxed Helius account (2026-07-12).
      const connection = new Connection(SOLANA_RPC_URL, "confirmed");

      // Fetch SOL balance, token accounts, token map in parallel
      const [lamports, tokenRes, jupMap] = await Promise.all([
        connection.getBalance(new PublicKey(wallet.address)),
        fetchWithTimeout(SOLANA_RPC_URL, {
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
          timeoutMs: 10000,
        }).then(r => r.json()),
        getJupTokenMap(),
      ]);

      const sol = lamports / LAMPORTS_PER_SOL;
      setSolBalance(sol);

      // Parse token accounts
      const accounts = tokenRes?.result?.value ?? [];
      const holdings: TokenHolding[] = [];
      const mints: string[] = [];

      for (const acct of accounts) {
        const info = acct.account?.data?.parsed?.info;
        if (!info) continue;
        const balance = parseFloat(info.tokenAmount?.uiAmountString ?? "0");
        if (balance <= 0) continue;
        const mint = info.mint ?? "";
        const jupToken = jupMap.get(mint);
        const symbol = mint === SKR_MINT ? "SKR" : jupToken?.symbol ?? `${mint.slice(0, 4)}...${mint.slice(-4)}`;
        holdings.push({ mint, symbol, balance });
        mints.push(mint);
      }

      // Fetch prices for all tokens + SOL
      const solMint = "So11111111111111111111111111111111111111112";
      const allMints = [solMint, ...mints];
      const prices = await fetchPrices(allMints);

      const sp = prices[solMint];
      if (sp) setSolPrice(sp);

      // Enrich holdings with USD values
      for (const h of holdings) {
        const p = prices[h.mint];
        if (p) {
          h.usdPrice = p;
          h.usdValue = p * h.balance;
        }
      }

      // Sort by USD value descending (unknown values last)
      holdings.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));
      setTokens(holdings);

      // Fetch sparklines for top 10 tokens (don't block UI)
      const top10 = holdings.slice(0, 10);
      Promise.all(
        top10.map(async h => {
          const spark = await fetchSparkline(h.mint);
          if (spark.length > 2) {
            const change = ((spark[spark.length - 1] - spark[0]) / spark[0]) * 100;
            h.sparkline = spark;
            h.change24h = change;
          }
        }),
      ).then(() => setTokens([...holdings]));

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

  // Total portfolio value
  const totalUsd = (solBalance && solPrice ? solBalance * solPrice : 0)
    + tokens.reduce((sum, t) => sum + (t.usdValue ?? 0), 0);
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
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
            {/* Total Portfolio Value */}
            {totalUsd > 0 && (
              <View style={styles.totalCard}>
                <Text style={styles.totalLabel}>Total Value</Text>
                <Text style={styles.totalAmount}>${totalUsd.toFixed(2)}</Text>
              </View>
            )}

            {/* SOL Balance Card */}
            <View style={styles.solCard}>
              <View style={styles.solRow}>
                <View>
                  <Text style={styles.solLabel}>SOL Balance</Text>
                  <Text style={styles.solAmount}>
                    {solBalance !== null ? solBalance.toFixed(4) : "—"}
                  </Text>
                </View>
                {solPrice && solBalance !== null && (
                  <Text style={styles.solUsd}>${(solBalance * solPrice).toFixed(2)}</Text>
                )}
              </View>
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
                <Pressable
                  key={t.mint}
                  style={styles.tokenRow}
                  onPress={() => t.symbol.length <= 10 && setChartSymbol(t.symbol)}
                >
                  <View style={styles.tokenLeft}>
                    <Text style={styles.tokenSymbol}>{t.symbol}</Text>
                    <Text style={styles.tokenBalance}>{formatBalance(t.balance)}</Text>
                  </View>

                  {/* Sparkline */}
                  <View style={styles.sparkWrap}>
                    {t.sparkline && t.sparkline.length > 2 ? (
                      <MiniChart
                        data={t.sparkline}
                        color={(t.change24h ?? 0) >= 0 ? "#22c55e" : "#ef4444"}
                        height={32}
                      />
                    ) : null}
                  </View>

                  <View style={styles.tokenRight}>
                    {t.usdValue !== undefined ? (
                      <>
                        <Text style={styles.tokenUsd}>${t.usdValue.toFixed(2)}</Text>
                        {t.change24h !== undefined && (
                          <Text style={[styles.tokenChange, { color: t.change24h >= 0 ? "#22c55e" : "#ef4444" }]}>
                            {t.change24h >= 0 ? "+" : ""}{t.change24h.toFixed(1)}%
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text style={styles.tokenUsd}>—</Text>
                    )}
                  </View>
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Chart modal */}
      <ChartModal
        visible={!!chartSymbol}
        symbol={chartSymbol}
        onClose={() => setChartSymbol("")}
      />
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
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 0.75, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  backText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: "#6CB4EE" },
  headerTitle: { fontFamily: FONTS.display, fontSize: 20, color: THEME.text },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  loadingWrap: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  loadingText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: THEME.textMuted },

  // Total value card
  totalCard: {
    backgroundColor: "rgba(124,58,237,0.10)", borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: "rgba(124,58,237,0.20)", alignItems: "center",
  },
  totalLabel: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted, letterSpacing: 1 },
  totalAmount: { fontFamily: FONTS.display, fontSize: 38, color: THEME.text, marginTop: 4 },

  // SOL card
  solCard: {
    backgroundColor: "rgba(108,180,238,0.08)", borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: "rgba(108,180,238,0.15)",
  },
  solRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  solLabel: { fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted },
  solAmount: { fontFamily: FONTS.display, fontSize: 28, color: THEME.text, marginTop: 2 },
  solUsd: { fontFamily: FONTS.mono, fontSize: 16, color: THEME.textMuted },
  solSub: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textFaint, marginTop: 8 },

  // Banana card
  bananaCard: {
    backgroundColor: "rgba(255,213,79,0.06)", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "rgba(255,213,79,0.12)", alignItems: "center",
  },
  bananaLabel: { fontFamily: FONTS.mono, fontSize: 12, color: "#FFD54F" },
  bananaAmount: { fontFamily: FONTS.display, fontSize: 28, color: "#FFD54F", marginVertical: 2 },
  bananaSub: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint },

  // Token list
  sectionTitle: { fontFamily: FONTS.display, fontSize: 16, color: THEME.text, marginTop: 12 },
  emptyText: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, textAlign: "center", paddingVertical: 20 },
  tokenRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: "rgba(18,18,30,0.8)", borderRadius: 14,
    borderWidth: 0.75, borderColor: "rgba(255,255,255,0.06)",
  },
  tokenLeft: { width: 80 },
  tokenSymbol: { fontFamily: FONTS.bodySemi, fontSize: 14, color: "#FFD700" },
  tokenBalance: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted, marginTop: 2 },
  sparkWrap: { flex: 1, height: 32, marginHorizontal: 8 },
  tokenRight: { alignItems: "flex-end", minWidth: 70 },
  tokenUsd: { fontFamily: FONTS.mono, fontSize: 13, color: THEME.text },
  tokenChange: { fontFamily: FONTS.mono, fontSize: 11, marginTop: 2 },
});
