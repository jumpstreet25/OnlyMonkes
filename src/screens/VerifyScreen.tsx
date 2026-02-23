/**
 * VerifyScreen
 *
 * After wallet connection, verifies NFT ownership.
 * XMTP initialises inside ChatScreen so send/react/reply are
 * all in the same hook instance — eliminates "Not connected" errors.
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useNFTVerification } from "@/hooks/useNFTVerification";
import { useMobileWallet } from "@/hooks/useMobileWallet";
import { useAppStore } from "@/store/appStore";
import { NftPickerModal } from "@/components/NftPickerModal";
import { THEME, FONTS } from "@/lib/constants";
import { shortenAddress } from "@/lib/nftVerification";
import type { OwnedNFT } from "@/types";

type VerifyState = "idle" | "checking-nft" | "nft-fail" | "nft-ok" | "pick-nft" | "ready";

export default function VerifyScreen() {
  const { wallet, verifiedNft, allNfts, error, setVerified } = useAppStore();
  const { verify } = useNFTVerification();
  const { disconnect } = useMobileWallet();

  const [phase, setPhase] = useState<VerifyState>("idle");

  useEffect(() => {
    runVerification();
  }, []);

  // Navigate to chat — XMTP connects inside ChatScreen
  const goToChat = async () => {
    setPhase("ready");
    await new Promise((r) => setTimeout(r, 500));
    router.replace("/chat");
  };

  const runVerification = async () => {
    setPhase("checking-nft");
    const verified = await verify();

    if (!verified) {
      setPhase("nft-fail");
      return;
    }

    setPhase("nft-ok");
    await new Promise((r) => setTimeout(r, 800));

    if (allNfts.length > 1) {
      setPhase("pick-nft");
      return;
    }

    await goToChat();
  };

  const handleNftPicked = async (nft: OwnedNFT) => {
    setVerified(true, nft);
    await goToChat();
  };

  const handleDisconnect = () => {
    disconnect();
    router.replace("/");
  };

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

      <View style={styles.content}>
        {/* Wallet pill */}
        <View style={styles.walletPill}>
          <View style={styles.walletDot} />
          <Text style={styles.walletAddress}>
            {wallet ? shortenAddress(wallet.address) : "—"}
          </Text>
        </View>

        {/* Status card */}
        <View style={styles.card}>
          <View style={styles.statusInner}>
            {phase === "checking-nft" && (
              <>
                <ActivityIndicator size="large" color={THEME.accent} />
                <Text style={styles.statusText}>Checking NFT ownership…</Text>
              </>
            )}

            {(phase === "nft-ok" || phase === "ready") && verifiedNft?.image && (
              <>
                <Image source={{ uri: verifiedNft.image }} style={styles.nftImage} />
                <Text style={styles.nftFoundLabel}>NFT Verified ✓</Text>
                <Text style={styles.nftName}>{verifiedNft.name}</Text>
              </>
            )}

            {phase === "nft-fail" && (
              <>
                <Text style={styles.failIcon}>🔒</Text>
                <Text style={styles.statusText}>No eligible NFT found</Text>
              </>
            )}
          </View>
        </View>

        {/* Single step indicator */}
        <View style={styles.steps}>
          <StepRow
            done={["nft-ok", "pick-nft", "ready"].includes(phase)}
            active={phase === "checking-nft"}
            label="Verifying NFT ownership"
            index={1}
          />
        </View>

        {/* Error state */}
        {phase === "nft-fail" && (
          <View style={styles.errorBlock}>
            <Text style={styles.errorTitle}>Access Denied</Text>
            <Text style={styles.errorMessage}>
              {error ?? "You need a Saga Monkes NFT to access OnlyMonkes."}
            </Text>
            <Pressable style={styles.retryButton} onPress={handleDisconnect}>
              <Text style={styles.retryButtonText}>Disconnect & Try Again</Text>
            </Pressable>
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
    paddingTop: 80,
    paddingBottom: 48,
    gap: 24,
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
  card: {
    alignSelf: "stretch",
    backgroundColor: THEME.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 32,
    minHeight: 200,
    alignItems: "center",
    justifyContent: "center",
  },
  statusInner: { alignItems: "center", gap: 16 },
  statusText: { fontFamily: FONTS.bodyMed, fontSize: 15, color: THEME.textMuted, textAlign: "center" },
  nftImage: { width: 120, height: 120, borderRadius: 16, borderWidth: 2, borderColor: THEME.accent },
  nftFoundLabel: { fontFamily: FONTS.mono, fontSize: 12, color: "#44ff88", letterSpacing: 1 },
  nftName: { fontFamily: FONTS.display, fontSize: 18, color: THEME.text },
  failIcon: { fontSize: 48 },
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
  errorBlock: {
    alignSelf: "stretch",
    backgroundColor: "#ff444411",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ff444444",
    padding: 20,
    gap: 10,
    alignItems: "center",
  },
  errorTitle: { fontFamily: FONTS.displayMed, fontSize: 17, color: "#ff7777" },
  errorMessage: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, textAlign: "center", lineHeight: 20 },
  retryButton: { marginTop: 4, borderRadius: 10, borderWidth: 1, borderColor: THEME.border, paddingHorizontal: 20, paddingVertical: 10 },
  retryButtonText: { fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.textMuted },
});
