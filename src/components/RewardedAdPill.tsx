/**
 * RewardedAdPill — "Watch an ad, earn bananas" entry point for the SKR
 * treasury ad pipeline (see the SKR Rewards Pool memo). Uses Google Mobile
 * Ads' own useRewardedAd hook directly rather than reinventing load/show/
 * reward-event state.
 *
 * Currently wired to Google's public TEST ad unit ID (src/lib/ads.ts) —
 * swap AD_UNIT_IDS.rewardedMain for the real AdMob unit once one exists.
 * Renders nothing if the ad fails to load — optional/low-friction by
 * design, never blocks chat.
 */
import { useEffect, useRef } from "react";
import { Pressable, Text, StyleSheet } from "react-native";
import { useRewardedAd } from "react-native-google-mobile-ads";
import { toast } from "sonner-native";
import { THEME } from "@/lib/constants";
import { AD_UNIT_IDS, AD_REWARD_BANANAS } from "@/lib/ads";
import { addBananas } from "@/lib/bananaRewards";
import { useAppStore } from "@/store/appStore";

export function RewardedAdPill({ adUnitId = AD_UNIT_IDS.rewardedMain, rewardBananas = AD_REWARD_BANANAS.main }: {
  adUnitId?: string;
  rewardBananas?: number;
}) {
  const { isLoaded, isEarnedReward, isClosed, load, show } = useRewardedAd(adUnitId);
  const grantedRef = useRef(false);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isEarnedReward || grantedRef.current) return;
    grantedRef.current = true;
    addBananas(rewardBananas).then((balance) => {
      useAppStore.getState().setBananaBalance(balance);
      toast.success(`🍌 +${rewardBananas} bananas!`);
    }).catch(() => {});
  }, [isEarnedReward, rewardBananas]);

  useEffect(() => {
    if (isClosed) {
      grantedRef.current = false;
      load(); // preload the next one
    }
  }, [isClosed, load]);

  if (!isLoaded) {
    return null; // no test/real ad ready yet — stay invisible rather than show a dead button
  }

  return (
    <Pressable
      onPress={() => show()}
      style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
    >
      <Text style={styles.label}>🎬 Watch ad · +{rewardBananas}🍌</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: THEME.accentSoft,
    borderWidth: 1,
    borderColor: THEME.accent + "55",
  },
  pillPressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    color: THEME.accent,
  },
});
