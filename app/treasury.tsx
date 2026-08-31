/**
 * treasury.tsx — public transparency screen for the OnlyMonkes Dev/Treasury
 * wallet: what it currently holds and how much SKR is staked with Solana
 * Mobile's Guardian program. Read-only, no wallet connection required —
 * pulls from worker-actions' GET /api/treasury/status (treasury.ts), which
 * only ever reads public on-chain state.
 *
 * DEV_WALLET is the publisher's own intentionally-public treasury (already
 * referenced by full address across this app's Blinks and legal pages) —
 * showing it here is the whole point of the screen, not an exception to the
 * "never expose a user's wallet address" rule, which is about other people's
 * wallets, not this one.
 */
import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Pressable, Linking } from "react-native";
import { router } from "expo-router";
import { THEME, FONTS, DEV_WALLET } from "@/lib/constants";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { WorldScreenShell, useWorldGlassCardStyle } from "@/components/worlds/WorldScreenShell";

const ACTIONS_BASE = "https://onlymonkes-actions.jumpstreet25.workers.dev";

interface TreasuryStatus {
  wallet: string;
  sol: number;
  usdc: number;
  skr: number;
  stakedSkr: number;
  sharePrice: number | null;
  solUsdPrice: number | null;
  skrUsdPrice: number | null;
  totalUsd: number;
}

export default function TreasuryScreen() {
  const [status, setStatus] = useState<TreasuryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const cardStyle = useWorldGlassCardStyle();

  const load = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(`${ACTIONS_BASE}/api/treasury/status`, { timeoutMs: 10000 });
      if (res.ok) setStatus(await res.json());
    } catch (err) {
      console.warn("[Treasury] Load failed:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const skrUnstakedValue = status?.skrUsdPrice ? status.skr * status.skrUsdPrice : null;
  const skrStakedValue = status?.skrUsdPrice ? status.stakedSkr * status.skrUsdPrice : null;
  const solValue = status?.solUsdPrice ? status.sol * status.solUsdPrice : null;

  return (
    <WorldScreenShell title="OnlyTreasury" onBack={() => router.back()}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={THEME.accent} />}
      >
        <Text style={styles.intro}>
          Every dApp fee, tip, ad, and swap fee lands here. It's swept into SKR and staked with
          Solana Mobile's Guardian — the yield funds community giveaways and OnlyMonkes' own
          infra costs. This wallet never signs into chat; it's the public treasury, not a login.
        </Text>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={THEME.accent} />
            <Text style={styles.loadingText}>Reading on-chain balances…</Text>
          </View>
        ) : !status ? (
          <Text style={styles.emptyText}>Couldn't load treasury status — pull to retry.</Text>
        ) : (
          <>
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>TOTAL TREASURY VALUE</Text>
              <Text style={styles.totalAmount}>${status.totalUsd.toFixed(2)}</Text>
              <Pressable onPress={() => Linking.openURL(`https://solscan.io/account/${DEV_WALLET}`)}>
                <Text style={styles.walletLink}>{status.wallet.slice(0, 6)}…{status.wallet.slice(-6)} ↗</Text>
              </Pressable>
            </View>

            <View style={[styles.row, cardStyle]}>
              <View>
                <Text style={styles.rowLabel}>Staked SKR</Text>
                <Text style={styles.rowSub}>Solana Mobile Guardian · 0% commission</Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.rowAmount}>{status.stakedSkr.toFixed(2)} SKR</Text>
                {skrStakedValue !== null && <Text style={styles.rowUsd}>${skrStakedValue.toFixed(2)}</Text>}
              </View>
            </View>

            {status.sharePrice !== null && (
              <Text style={styles.footnote}>
                Share price {status.sharePrice.toFixed(4)}× par — rewards accrue as this grows,
                not as separate drops. Every staked SKR is worth more over time.
              </Text>
            )}

            <View style={[styles.row, cardStyle]}>
              <Text style={styles.rowLabel}>SOL</Text>
              <View style={styles.rowRight}>
                <Text style={styles.rowAmount}>{status.sol.toFixed(4)}</Text>
                {solValue !== null && <Text style={styles.rowUsd}>${solValue.toFixed(2)}</Text>}
              </View>
            </View>

            <View style={[styles.row, cardStyle]}>
              <Text style={styles.rowLabel}>USDC</Text>
              <View style={styles.rowRight}>
                <Text style={styles.rowAmount}>{status.usdc.toFixed(2)}</Text>
                <Text style={styles.rowUsd}>${status.usdc.toFixed(2)}</Text>
              </View>
            </View>

            <View style={[styles.row, cardStyle]}>
              <View>
                <Text style={styles.rowLabel}>SKR (unstaked)</Text>
                <Text style={styles.rowSub}>Awaiting the next sweep into staking</Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.rowAmount}>{status.skr.toFixed(4)}</Text>
                {skrUnstakedValue !== null && <Text style={styles.rowUsd}>${skrUnstakedValue.toFixed(2)}</Text>}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </WorldScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  intro: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, lineHeight: 19, marginBottom: 4 },
  loadingWrap: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  loadingText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: THEME.textMuted },
  emptyText: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, textAlign: "center", paddingVertical: 20 },

  totalCard: {
    backgroundColor: "rgba(124,58,237,0.10)", borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: "rgba(124,58,237,0.20)", alignItems: "center", gap: 4,
  },
  totalLabel: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted, letterSpacing: 1 },
  totalAmount: { fontFamily: FONTS.display, fontSize: 38, color: THEME.text, marginTop: 4 },
  walletLink: { fontFamily: FONTS.mono, fontSize: 12, color: THEME.accent, marginTop: 6 },

  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, borderWidth: 0.75,
  },
  rowLabel: { fontFamily: FONTS.bodySemi, fontSize: 14, color: THEME.text },
  rowSub: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint, marginTop: 2 },
  rowRight: { alignItems: "flex-end" },
  rowAmount: { fontFamily: FONTS.mono, fontSize: 14, color: THEME.text },
  rowUsd: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted, marginTop: 2 },
  footnote: { fontFamily: FONTS.body, fontSize: 11, color: THEME.textFaint, lineHeight: 16, paddingHorizontal: 4 },
});
