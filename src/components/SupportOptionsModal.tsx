/**
 * SupportOptionsModal — "Help Support OnlyMonkes" popup.
 *
 * Replaces the standalone floating "Watch Ad" pill (RewardedAdPill was
 * previously its own composer-area button) — folded in here alongside the
 * new pay-to-skip-ads option and the existing SKR tip flow, per 2026-08-24
 * request. Three choices:
 *   1. Watch an ad — same useRewardedAd flow RewardedAdPill used, +bananas
 *   2. Send ~$5 in $SKR — skip ads for 30 days (adSkip.ts, verified server-side)
 *   3. Tip the dev directly — closes this modal, opens the existing TipModal
 *
 * Ads are otherwise mandatory (fund the $SKR treasury/Vault) — this is the
 * one place a holder can either contribute via an ad view or buy 30 days
 * of not seeing them.
 */
import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRewardedAd } from "react-native-google-mobile-ads";
import { toast } from "sonner-native";
import { GlassModal } from "@/components/GlassModal";
import { THEME, FONTS } from "@/lib/constants";
import { AD_UNIT_IDS, AD_REWARD_BANANAS, resolveAdUnitId } from "@/lib/ads";
import { addBananas } from "@/lib/bananaRewards";
import { useAppStore } from "@/store/appStore";
import { getAdSkipStatus, payToSkipAds } from "@/lib/adSkip";

interface SupportOptionsModalProps {
  visible: boolean;
  onClose: () => void;
  onOpenTip: () => void;
  /** Genesis holders see the longer/higher-value rewarded slot. */
  variant?: "main" | "genesis";
}

export function SupportOptionsModal({ visible, onClose, onOpenTip, variant = "main" }: SupportOptionsModalProps) {
  const adUnitId = resolveAdUnitId(variant === "genesis" ? AD_UNIT_IDS.rewardedGenesis : AD_UNIT_IDS.rewardedMain);
  const rewardBananas = variant === "genesis" ? AD_REWARD_BANANAS.genesis : AD_REWARD_BANANAS.main;
  const { isLoaded, isEarnedReward, isClosed, load, show } = useRewardedAd(adUnitId);
  const wallet = useAppStore((s) => s.wallet?.address);

  const [skipStatus, setSkipStatus] = useState<{ skipAds: boolean; expiresAt: number | null }>({ skipAds: false, expiresAt: null });
  const [payingSkip, setPayingSkip] = useState(false);
  const grantedRef = React.useRef(false);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  useEffect(() => {
    if (!visible || !wallet) return;
    getAdSkipStatus(wallet).then(setSkipStatus);
  }, [visible, wallet]);

  useEffect(() => {
    if (!isEarnedReward || grantedRef.current) return;
    grantedRef.current = true;
    addBananas(rewardBananas).then((balance) => {
      useAppStore.getState().setBananaBalance(balance);
      toast.success(`🍌 +${rewardBananas} bananas — thanks for the support!`);
    }).catch(() => {});
  }, [isEarnedReward, rewardBananas]);

  useEffect(() => {
    if (isClosed) {
      grantedRef.current = false;
      load();
    }
  }, [isClosed, load]);

  const handleWatchAd = useCallback(() => {
    if (!isLoaded) {
      toast.error("Ad isn't ready yet — try again in a moment");
      return;
    }
    show();
    onClose();
  }, [isLoaded, show, onClose]);

  const handlePaySkip = useCallback(async () => {
    if (!wallet) {
      toast.error("Connect your wallet first");
      return;
    }
    setPayingSkip(true);
    try {
      const result = await payToSkipAds();
      setSkipStatus(result);
      toast.success("🍌 Ads skipped for 30 days — thanks for supporting the Vault!");
      onClose();
    } catch (err) {
      toast.error((err as Error).message || "Payment failed");
    } finally {
      setPayingSkip(false);
    }
  }, [wallet, onClose]);

  const handleTip = useCallback(() => {
    onClose();
    onOpenTip();
  }, [onClose, onOpenTip]);

  return (
    <GlassModal visible={visible} onClose={onClose} position="bottom">
      <Text style={styles.title}>🍌 Help Support OnlyMonkes</Text>
      <Text style={styles.subtitle}>
        Ad revenue funds the $SKR Vault — server/API costs, staking, and eventually community
        giveaways. Pick how you'd like to contribute.
      </Text>

      {skipStatus.skipAds && skipStatus.expiresAt && (
        <View style={styles.activeBanner}>
          <Text style={styles.activeBannerText}>
            ✅ Ads skipped until {new Date(skipStatus.expiresAt).toLocaleDateString()}
          </Text>
        </View>
      )}

      {adUnitId && (
        // 2026-08-27: real ad unit IDs don't exist yet (see resolveAdUnitId
        // in ads.ts) — adUnitId is null until they land, and this row would
        // otherwise show "Loading ad…" with a spinner forever, which reads
        // as a broken button rather than a temporarily-unavailable feature.
        <Pressable
          onPress={handleWatchAd}
          disabled={!isLoaded}
          style={({ pressed }) => [styles.row, (pressed || !isLoaded) && styles.rowPressed]}
        >
          <Text style={styles.rowEmoji}>🎬</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Watch an ad</Text>
            <Text style={styles.rowSubtitle}>{isLoaded ? `+${rewardBananas} bananas` : "Loading ad…"}</Text>
          </View>
          {!isLoaded && <ActivityIndicator size="small" color={THEME.accent} />}
        </Pressable>
      )}

      <Pressable
        onPress={handlePaySkip}
        disabled={payingSkip || skipStatus.skipAds}
        style={({ pressed }) => [styles.row, (pressed || payingSkip) && styles.rowPressed]}
      >
        <Text style={styles.rowEmoji}>🚫</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Send $SKR — skip ads 30 days</Text>
          <Text style={styles.rowSubtitle}>
            {skipStatus.skipAds ? "Already active" : "~$5 in $SKR, staked to the Vault"}
          </Text>
        </View>
        {payingSkip && <ActivityIndicator size="small" color={THEME.accent} />}
      </Pressable>

      <Pressable onPress={handleTip} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
        <Text style={styles.rowEmoji}>💙</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Tip the dev directly</Text>
          <Text style={styles.rowSubtitle}>Send $SKR straight to the OnlyMonkes wallet</Text>
        </View>
      </Pressable>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: FONTS.displayMed,
    fontSize: 18,
    color: THEME.text,
    marginBottom: 6,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textMuted,
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 18,
  },
  activeBanner: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  activeBannerText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 12,
    color: "#10B981",
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowEmoji: {
    fontSize: 22,
  },
  rowTitle: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.text,
  },
  rowSubtitle: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
    marginTop: 2,
  },
});
