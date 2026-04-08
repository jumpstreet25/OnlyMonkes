/**
 * WatchlistScreen — Personal token watchlist.
 *
 * Shows the user's watched tokens with live prices and sparklines.
 * Tokens are managed via bot DM commands (/watch, /unwatch).
 * Tap a token row to open ChartModal with full candlestick view.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { THEME, FONTS } from "@/lib/constants";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { ChartModal } from "@/components/ChartModal";
import { MiniChart } from "@/components/MiniChart";

// ─── Types ──────────────────────────────────────────────────────────────────

interface WatchlistToken {
  symbol: string;
  address: string;
  price?: number;
  change24h?: number;
  sparkline?: number[];
}

// ─── Price fetching ─────────────────────────────────────────────────────────

async function fetchPrices(tokens: WatchlistToken[]): Promise<WatchlistToken[]> {
  if (!tokens.length) return tokens;
  const ids = tokens.map(t => t.address).join(",");
  try {
    const res = await fetchWithTimeout(
      `https://api.jup.ag/price/v2?ids=${ids}`,
      { timeoutMs: 8000 },
    );
    if (!res.ok) return tokens;
    const data = await res.json();
    return tokens.map(t => {
      const p = data?.data?.[t.address];
      return {
        ...t,
        price: p?.price ? parseFloat(p.price) : undefined,
      };
    });
  } catch {
    return tokens;
  }
}

async function fetchSparkline(address: string): Promise<number[]> {
  try {
    // DexScreener search → pool → DexPaprika 24h OHLCV
    const searchRes = await fetchWithTimeout(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`,
      { timeoutMs: 6000 },
    );
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const pair = searchData?.pairs?.[0];
    if (!pair?.pairAddress) return [];

    const start = Math.floor((Date.now() - 24 * 3600000) / 1000);
    const dpRes = await fetchWithTimeout(
      `https://api.dexpaprika.com/networks/solana/pools/${pair.pairAddress}/ohlcv?start=${start}&limit=24&interval=1h`,
      { timeoutMs: 6000 },
    );
    if (!dpRes.ok) return [];
    const dpData = await dpRes.json();
    if (!Array.isArray(dpData)) return [];
    return dpData.map((c: any) => parseFloat(c.close)).filter(n => !isNaN(n) && n > 0);
  } catch {
    return [];
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

// Demo watchlist — in production, this would sync via bot DM
const DEMO_TOKENS: WatchlistToken[] = [
  { symbol: "SOL", address: "So11111111111111111111111111111111111111112" },
  { symbol: "BONK", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { symbol: "WIF", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
];

export default function WatchlistScreen() {
  const insets = useSafeAreaInsets();
  const [tokens, setTokens] = useState<WatchlistToken[]>(DEMO_TOKENS);
  const [loading, setLoading] = useState(true);
  const [addText, setAddText] = useState("");
  const [chartSymbol, setChartSymbol] = useState("");

  // Fetch prices on mount
  useEffect(() => {
    (async () => {
      setLoading(true);
      const withPrices = await fetchPrices(tokens);
      // Fetch sparklines in parallel
      const withSparklines = await Promise.all(
        withPrices.map(async t => ({
          ...t,
          sparkline: await fetchSparkline(t.address),
        })),
      );
      setTokens(withSparklines);
      setLoading(false);
    })();
  }, []);

  const handleAdd = useCallback(() => {
    const sym = addText.replace(/^\$/, "").trim().toUpperCase();
    if (!sym) return;
    if (tokens.some(t => t.symbol === sym)) {
      Alert.alert("Already watching", `$${sym} is already on your watchlist.`);
      setAddText("");
      return;
    }
    // TODO: In production, send /watch $SYM via DM to bot and parse response
    // For now, just add locally with placeholder address
    Alert.alert("DM the bot", `Send "/watch $${sym}" to AI Agent #9385 in DMs to add it to your watchlist.`);
    setAddText("");
  }, [addText, tokens]);

  const handleRemove = useCallback((symbol: string) => {
    Alert.alert(
      `Remove $${symbol}?`,
      `Send "/unwatch $${symbol}" to AI Agent #9385 in DMs to remove it.`,
      [{ text: "OK" }],
    );
  }, []);

  const formatPrice = (price?: number) => {
    if (!price) return "—";
    if (price < 0.01) return `$${price.toFixed(6)}`;
    if (price < 1) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(2)}`;
  };

  const renderToken = useCallback(({ item }: { item: WatchlistToken }) => {
    const hasSparkline = item.sparkline && item.sparkline.length > 2;
    const isUp = hasSparkline ? item.sparkline![item.sparkline!.length - 1] > item.sparkline![0] : undefined;

    return (
      <Pressable style={styles.tokenRow} onPress={() => setChartSymbol(item.symbol)}>
        <View style={styles.tokenInfo}>
          <Text style={styles.tokenSymbol}>${item.symbol}</Text>
          <Text style={styles.tokenPrice}>{formatPrice(item.price)}</Text>
        </View>
        <View style={styles.sparklineWrap}>
          {hasSparkline ? (
            <MiniChart
              data={item.sparkline!}
              color={isUp ? "#22c55e" : "#ef4444"}
              height={36}
            />
          ) : (
            <Text style={styles.noData}>—</Text>
          )}
        </View>
        <Pressable
          style={styles.removeBtn}
          onPress={() => handleRemove(item.symbol)}
          hitSlop={8}
        >
          <Text style={styles.removeBtnText}>✕</Text>
        </Pressable>
      </Pressable>
    );
  }, [handleRemove]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backBtn}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Watchlist</Text>
        <Text style={styles.count}>{tokens.length} tokens</Text>
      </View>

      {/* Add token input */}
      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          value={addText}
          onChangeText={setAddText}
          placeholder="Add token (e.g. SOL)"
          placeholderTextColor={THEME.textDim}
          autoCapitalize="characters"
          returnKeyType="done"
          onSubmitEditing={handleAdd}
        />
        <Pressable style={styles.addBtn} onPress={handleAdd}>
          <Text style={styles.addBtnText}>+</Text>
        </Pressable>
      </View>

      <Text style={styles.hint}>
        Manage via DM: /watch $TOKEN, /unwatch $TOKEN
      </Text>

      {/* Token list */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={THEME.accent} />
          <Text style={styles.loadingText}>Fetching prices...</Text>
        </View>
      ) : (
        <FlashList
          data={tokens}
          renderItem={renderToken}
          keyExtractor={item => item.symbol}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              No tokens on your watchlist yet.{"\n"}
              DM the bot: /watch $SOL
            </Text>
          }
        />
      )}

      {/* Chart modal */}
      <ChartModal
        visible={!!chartSymbol}
        symbol={chartSymbol}
        onClose={() => setChartSymbol("")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  backBtn: { fontFamily: FONTS.mono, fontSize: 14, color: "#0096C7" },
  title: {
    fontFamily: FONTS.mono, fontSize: 18, fontWeight: "700",
    color: THEME.text, marginLeft: 12, flex: 1,
  },
  count: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted },
  addRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 10, gap: 8,
  },
  addInput: {
    flex: 1, height: 40, borderRadius: 10,
    backgroundColor: THEME.surface, paddingHorizontal: 12,
    fontFamily: FONTS.mono, fontSize: 14, color: THEME.text,
    borderWidth: 1, borderColor: THEME.border,
  },
  addBtn: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: THEME.accent, alignItems: "center", justifyContent: "center",
  },
  addBtnText: { fontSize: 22, color: "#fff", fontWeight: "700" },
  hint: {
    fontFamily: FONTS.mono, fontSize: 10, color: THEME.textDim,
    paddingHorizontal: 14, paddingBottom: 8,
  },
  list: { paddingHorizontal: 8 },
  tokenRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: THEME.surface, marginVertical: 3,
    marginHorizontal: 6, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: THEME.border,
  },
  tokenInfo: { width: 90 },
  tokenSymbol: {
    fontFamily: FONTS.mono, fontSize: 15, fontWeight: "700", color: "#FFD700",
  },
  tokenPrice: {
    fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted, marginTop: 2,
  },
  sparklineWrap: { flex: 1, height: 36, marginHorizontal: 8 },
  noData: {
    fontFamily: FONTS.mono, fontSize: 11, color: THEME.textDim, textAlign: "center",
    lineHeight: 36,
  },
  removeBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.15)", alignItems: "center", justifyContent: "center",
  },
  removeBtnText: { fontSize: 12, color: "#ef4444" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: {
    fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted, marginTop: 8,
  },
  emptyText: {
    fontFamily: FONTS.mono, fontSize: 13, color: THEME.textMuted,
    textAlign: "center", paddingVertical: 60, lineHeight: 22,
  },
});
