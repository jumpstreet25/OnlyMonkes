/**
 * VerifyScreen
 *
 * After wallet connection, verifies NFT ownership via Helius DAS API.
 * Three phases:
 *   checking-nft — skeleton loader + fun Monke-themed loading texts
 *   nft-ok       — verified NFT display → routes to chat
 *   nft-fail     — "not a holder" screen with marketplace CTAs
 */

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Image,
  Animated,
  Linking,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useNFTVerification } from "@/hooks/useNFTVerification";
import { useMobileWallet } from "@/hooks/useMobileWallet";
import { useAppStore } from "@/store/appStore";
import { saveVerifiedNft, stampNftCheck } from "@/lib/session";
import { NftPickerModal } from "@/components/NftPickerModal";
import { THEME, FONTS } from "@/lib/constants";
import { shortenAddress } from "@/lib/nftVerification";
import { loadListings, getActiveListings } from "@/lib/marketplace";
import type { OwnedNFT } from "@/types";

type VerifyState = "idle" | "checking-nft" | "nft-fail" | "nft-ok" | "pick-nft" | "ready";

// Fun Monke-themed loading texts — rotate every 1.8 s
const LOADING_TEXTS = [
  "Sniffing bananas in your wallet…",
  "Counting Monkes on-chain…",
  "Verifying you're not a tourist…",
  "Checking with Shyft…",
  "Scanning for Saga Monkes…",
  "Checking the banana vault…",
  "Asking the chain nicely…",
];

// Magic Eden delisted Saga Monkes (cNFT collection support dropped, 0 active
// listings as of 2026-07) — Tensor is the only working marketplace link.
const MARKETPLACES = [
  {
    label: "Buy on Tensor",
    emoji: "⚡",
    url: "https://www.tensor.trade/trade/sagamonkes",
  },
];

export default function VerifyScreen() {
  const { wallet, verifiedNft, allNfts, error, setVerified, setIsGuest } = useAppStore();
  const { verify } = useNFTVerification();
  const { disconnect } = useMobileWallet();

  const [phase, setPhase] = useState<VerifyState>("idle");
  const [loadingTextIdx, setLoadingTextIdx] = useState(0);
  const textFade = useRef(new Animated.Value(1)).current;
  const shimmer  = useRef(new Animated.Value(0)).current;

  // ── Skeleton shimmer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "checking-nft") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase]);

  // ── Rotate loading text with fade ─────────────────────────────────────────
  useEffect(() => {
    if (phase !== "checking-nft") return;
    const timer = setInterval(() => {
      Animated.sequence([
        Animated.timing(textFade, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(textFade, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      setLoadingTextIdx(i => (i + 1) % LOADING_TEXTS.length);
    }, 1800);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => { runVerification(); }, []);

  const goToChat = async (nftOverride?: OwnedNFT) => {
    setPhase("ready");
    const nftToSave = nftOverride ?? verifiedNft;
    if (nftToSave) {
      await saveVerifiedNft(nftToSave);
      await stampNftCheck();
    }
    await new Promise((r) => setTimeout(r, 500));
    router.replace("/chat");
  };

  const runVerification = async () => {
    setPhase("checking-nft");
    const verified = await verify();
    if (!verified) {
      // No Saga Monke — check if MonkeMarkets has any listed for sale
      await loadListings();
      const active = getActiveListings();
      if (active.length > 0) {
        // Listings exist → enter as guest, can only access MonkeMarkets
        setIsGuest(true);
        router.replace("/marketplace");
      } else {
        // Nothing for sale in-app — show nft-fail screen with marketplace links
        setPhase("nft-fail");
      }
      return;
    }
    setPhase("nft-ok");
    if (allNfts.length > 1) { setPhase("pick-nft"); return; }
    await goToChat();
  };

  const handleNftPicked = async (nft: OwnedNFT) => {
    setVerified(true, nft);
    await goToChat(nft);
  };

  const handleDisconnect = () => {
    disconnect();
    router.replace("/");
  };

  const shimmerOpacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.55] });
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <NftPickerModal
        visible={phase === "pick-nft"}
        nfts={allNfts}
        onSelect={handleNftPicked}
      />

      <LinearGradient
        colors={["#7c5cfc11", "#0a0a1400", "#7c5cfc22"]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
        {/* Wallet pill */}
        <View style={styles.walletPill}>
          <View style={styles.walletDot} />
          <Text style={styles.walletAddress}>
            {wallet ? shortenAddress(wallet.address) : "—"}
          </Text>
        </View>

        {/* ── LOADING: skeleton + fun text ─────────────────────────────── */}
        {phase === "checking-nft" && (
          <View style={styles.card}>
            {/* Skeleton rows */}
            <Animated.View style={[styles.skeletonRow, styles.skeletonWide,  { opacity: shimmerOpacity }]} />
            <Animated.View style={[styles.skeletonRow, styles.skeletonMed,   { opacity: shimmerOpacity }]} />
            <Animated.View style={[styles.skeletonRow, styles.skeletonShort, { opacity: shimmerOpacity }]} />

            {/* Pulsing spinner below skeletons */}
            <View style={styles.spinnerRow}>
              <ActivityIndicator size="small" color={THEME.accent} />
              <Animated.Text style={[styles.loadingText, { opacity: textFade }]}>
                {LOADING_TEXTS[loadingTextIdx]}
              </Animated.Text>
            </View>

            {/* Progress dots */}
            <View style={styles.stepDots}>
              {[0, 1, 2].map(i => (
                <Animated.View
                  key={i}
                  style={[
                    styles.stepDot,
                    { opacity: shimmer.interpolate({ inputRange: [0, 1], outputRange: [i === 0 ? 0.4 : 0.15, i === 1 ? 0.9 : i === 2 ? 0.5 : 0.3] }) },
                    i === 1 && styles.stepDotActive,
                  ]}
                />
              ))}
            </View>
          </View>
        )}

        {/* ── NFT OK ───────────────────────────────────────────────────── */}
        {(phase === "nft-ok" || phase === "ready") && verifiedNft?.image && (
          <View style={styles.card}>
            <View style={styles.statusInner}>
              <Image source={{ uri: verifiedNft.image }} style={styles.nftImage} />
              <Text style={styles.nftFoundLabel}>NFT Verified ✓</Text>
              <Text style={styles.nftName}>{verifiedNft.name}</Text>
            </View>
          </View>
        )}

        {/* ── NOT A HOLDER ─────────────────────────────────────────────── */}
        {phase === "nft-fail" && (
          <View style={styles.notHolderBlock}>
            {/* Icon */}
            <Text style={styles.notHolderEmoji}>🔒</Text>
            <Text style={styles.notHolderTitle}>You Need a Saga Monke</Text>
            <Text style={styles.notHolderBody}>
              {error ?? "OnlyMonkes is an exclusive club for Saga Monkes NFT holders. No Monkes are listed in MonkeMarkets right now — grab one below to unlock holder-only chat, AI signals, voice rooms, and more."}
            </Text>

            {/* Divider */}
            <View style={styles.divider} />

            {/* "Why Saga Monkes?" blurb */}
            <View style={styles.whyBlock}>
              <Text style={styles.whyTitle}>Why Saga Monkes?</Text>
              {[
                "🐒  Rare — only 10,000 exist on Solana",
                "🔐  Private group chat via XMTP encryption",
                "📈  Live AI trading signals & alerts",
                "🎙  Voice rooms & holder-only events",
              ].map(line => (
                <Text key={line} style={styles.whyLine}>{line}</Text>
              ))}
            </View>

            {/* Marketplace buttons */}
            <View style={styles.marketplaceRow}>
              {MARKETPLACES.map(({ label, emoji, url }) => (
                <Pressable
                  key={label}
                  style={({ pressed }) => [styles.marketBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => Linking.openURL(url)}
                >
                  <LinearGradient
                    colors={["#9c7cff", "#7c5cfc"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.marketBtnGradient}
                  >
                    <Text style={styles.marketBtnEmoji}>{emoji}</Text>
                    <Text style={styles.marketBtnText}>{label}</Text>
                  </LinearGradient>
                </Pressable>
              ))}
            </View>

            {/* Retry same wallet */}
            <Pressable
              style={({ pressed }) => [styles.retryNowButton, pressed && { opacity: 0.7 }]}
              onPress={runVerification}
            >
              <Text style={styles.retryNowButtonText}>Retry Verification</Text>
            </Pressable>

            {/* Try different wallet */}
            <Pressable style={styles.retryButton} onPress={handleDisconnect}>
              <Text style={styles.retryButtonText}>← Try a Different Wallet</Text>
            </Pressable>
          </View>
        )}

        {/* Step indicator (checking-nft / ok states) */}
        {phase !== "nft-fail" && (
          <View style={styles.steps}>
            <StepRow
              done={["nft-ok", "pick-nft", "ready"].includes(phase)}
              active={phase === "checking-nft"}
              label={phase === "checking-nft" ? "Verifying NFT ownership…" : "Verified ✓"}
              index={1}
            />
          </View>
        )}
      </View>
    </View>
  );
}

function StepRow({
  done, active, label, index,
}: {
  done: boolean; active: boolean; label: string; index: number;
}) {
  return (
    <View style={styles.stepRow}>
      <View style={[styles.stepCircle, done && styles.stepCircleDone, active && styles.stepCircleActive]}>
        {done
          ? <Text style={styles.stepCheck}>✓</Text>
          : <Text style={[styles.stepNum, active && styles.stepNumActive]}>{index}</Text>
        }
      </View>
      <Text style={[styles.stepLabel, done && styles.stepLabelDone, active && styles.stepLabelActive]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    gap: 20,
    alignItems: "center",
    justifyContent: "center",
  },

  walletPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: THEME.surface,
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  walletDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#44ff88" },
  walletAddress: { fontFamily: FONTS.mono, fontSize: 13, color: THEME.textMuted },

  // ── Shared card ──────────────────────────────────────────────────────────
  card: {
    alignSelf: "stretch",
    backgroundColor: THEME.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 28,
    minHeight: 200,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },

  // ── Skeleton loader ──────────────────────────────────────────────────────
  skeletonRow: {
    height: 14,
    borderRadius: 7,
    backgroundColor: THEME.surfaceHigh,
  },
  skeletonWide:  { width: "85%" },
  skeletonMed:   { width: "65%" },
  skeletonShort: { width: "45%" },

  spinnerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  loadingText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: THEME.textMuted,
    flexShrink: 1,
  },

  stepDots: { flexDirection: "row", gap: 6, marginTop: 4 },
  stepDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: THEME.border },
  stepDotActive: { backgroundColor: THEME.accent },

  // ── NFT OK ───────────────────────────────────────────────────────────────
  statusInner: { alignItems: "center", gap: 16 },
  nftImage: { width: 120, height: 120, borderRadius: 60 },
  nftFoundLabel: { fontFamily: FONTS.mono, fontSize: 12, color: "#44ff88", letterSpacing: 1 },
  nftName: { fontFamily: FONTS.display, fontSize: 18, color: THEME.text },

  // ── Not a holder ─────────────────────────────────────────────────────────
  notHolderBlock: {
    alignSelf: "stretch",
    backgroundColor: THEME.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 24,
    gap: 14,
    alignItems: "center",
  },
  notHolderEmoji: { fontSize: 48, marginBottom: 2 },
  notHolderTitle: {
    fontFamily: FONTS.displayMed,
    fontSize: 20,
    color: THEME.text,
    textAlign: "center",
  },
  notHolderBody: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },

  divider: {
    alignSelf: "stretch",
    height: 1,
    backgroundColor: THEME.border,
    marginVertical: 4,
  },

  whyBlock: { alignSelf: "stretch", gap: 6 },
  whyTitle: {
    fontFamily: FONTS.bodySemi,
    fontSize: 13,
    color: THEME.text,
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  whyLine: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textMuted,
    lineHeight: 20,
  },

  marketplaceRow: { flexDirection: "row", gap: 10, alignSelf: "stretch" },
  marketBtn: { flex: 1, borderRadius: 12, overflow: "hidden" },
  marketBtnGradient: {
    paddingVertical: 13,
    alignItems: "center",
    gap: 4,
  },
  marketBtnEmoji: { fontSize: 18 },
  marketBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 12,
    color: "#fff",
    textAlign: "center",
  },

  retryNowButton: {
    alignSelf: "stretch",
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.accent,
    alignItems: "center",
  },
  retryNowButtonText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 14,
    color: THEME.accent,
  },
  retryButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  retryButtonText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: THEME.textFaint,
  },

  // ── Step indicator ───────────────────────────────────────────────────────
  steps: { alignSelf: "stretch" },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10 },
  stepCircle: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1,
    borderColor: THEME.border, alignItems: "center", justifyContent: "center",
    backgroundColor: THEME.surface,
  },
  stepCircleDone: { backgroundColor: "#44ff8822", borderColor: "#44ff88" },
  stepCircleActive: { borderColor: THEME.accent, backgroundColor: THEME.accentSoft },
  stepNum: { fontFamily: FONTS.mono, fontSize: 13, color: THEME.textFaint },
  stepNumActive: { color: THEME.accent },
  stepCheck: { fontFamily: FONTS.bodySemi, fontSize: 14, color: "#44ff88" },
  stepLabel: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textFaint },
  stepLabelDone: { color: "#44ff88" },
  stepLabelActive: { color: THEME.text },
});
