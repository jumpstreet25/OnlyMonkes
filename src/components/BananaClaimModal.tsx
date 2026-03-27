/**
 * BananaClaimModal — Daily reward popup.
 *
 * Shows when user opens the app and has unclaimed bananas (24h cooldown).
 * Animated banana, streak progress bar, days-until-bonus countdown.
 * Day 7 = confetti + bonus celebration.
 */

import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  Alert,
} from "react-native";
import * as Haptics from "expo-haptics";
import { THEME, FONTS } from "@/lib/constants";
import { ConfettiView } from "@/components/ConfettiView";
import { shareDay7Bonus } from "@/lib/shareToX";
import type { ClaimResult } from "@/lib/bananaRewards";

interface BananaClaimModalProps {
  visible: boolean;
  claim: ClaimResult | null;
  onDismiss: () => void;
}

export function BananaClaimModal({ visible, claim, onDismiss }: BananaClaimModalProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const bananaAnim = useRef(new Animated.Value(0)).current;
  const countAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible && claim) {
      // Reset
      scaleAnim.setValue(0);
      bananaAnim.setValue(0);
      countAnim.setValue(0);

      // Sequence: popup scales in → banana bounces → count fades in
      Animated.sequence([
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 80,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.spring(bananaAnim, {
          toValue: 1,
          tension: 120,
          friction: 5,
          useNativeDriver: true,
        }),
        Animated.timing(countAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, claim]);

  if (!visible || !claim) return null;

  const handleClaim = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (claim?.isBonus) {
      // Day 7 — prompt to share on X
      Alert.alert(
        "Share your streak? 🐒",
        "Let the world know you completed a full banana cycle!",
        [
          { text: "Not now", style: "cancel", onPress: onDismiss },
          {
            text: "Share to X",
            onPress: () => {
              shareDay7Bonus(claim.balance, claim.state.totalCycles);
              onDismiss();
            },
          },
        ],
      );
    } else {
      onDismiss();
    }
  };

  const streakDays = Array.from({ length: 7 }, (_, i) => i + 1);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      {/* Day 7 confetti */}
      {claim.isBonus && <ConfettiView onDone={() => {}} />}

      <View style={styles.overlay}>
        <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>

          {/* Header */}
          <Text style={styles.gmonke}>
            {claim.isBonus ? "BANANA BONUS!" : "GMonke!"}
          </Text>

          {/* Big banana + earned amount */}
          <Animated.View style={{
            transform: [
              { scale: bananaAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 1.3, 1] }) },
              { rotate: bananaAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["0deg", "-15deg", "0deg"] }) },
            ],
          }}>
            <Text style={styles.bigBanana}>🍌</Text>
          </Animated.View>

          <Animated.View style={{ opacity: countAnim }}>
            <Text style={styles.earnedText}>
              +{claim.earned} {claim.earned === 1 ? "Banana" : "Bananas"}
            </Text>
          </Animated.View>

          {/* 7-Day Streak Bar */}
          <View style={styles.streakBar}>
            {streakDays.map((day) => {
              const filled = day <= claim.streakDay;
              const isToday = day === claim.streakDay;
              return (
                <View key={day} style={[
                  styles.streakSlot,
                  filled && styles.streakSlotFilled,
                  isToday && styles.streakSlotToday,
                ]}>
                  <Text style={[
                    styles.streakEmoji,
                    !filled && styles.streakEmojiDim,
                  ]}>
                    {filled ? "🍌" : "🍌"}
                  </Text>
                  <Text style={[
                    styles.streakDayLabel,
                    filled && styles.streakDayLabelFilled,
                  ]}>
                    {day}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Days until bonus */}
          {!claim.isBonus && (
            <Text style={styles.countdownText}>
              {claim.daysUntilBonus === 1
                ? "1 more day until your Banana Bonus!"
                : `${claim.daysUntilBonus} more days until your Banana Bonus!`}
            </Text>
          )}
          {claim.isBonus && (
            <Text style={styles.bonusText}>
              You completed a full cycle! New streak begins tomorrow.
            </Text>
          )}

          {/* Balance */}
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>Total Bananas</Text>
            <Text style={styles.balanceValue}>{claim.balance} 🍌</Text>
          </View>

          {/* Claim button */}
          <Pressable
            style={({ pressed }) => [
              styles.claimBtn,
              pressed && styles.claimBtnPressed,
            ]}
            onPress={handleClaim}
          >
            <Text style={styles.claimBtnText}>
              {claim.isBonus ? "Claim Bonus!" : "Claim"}
            </Text>
          </Pressable>

          <Text style={styles.hint}>Come back daily to fill the banana bar</Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: THEME.surface,
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    gap: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 213, 79, 0.2)",
    shadowColor: "#FFD54F",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 12,
    width: "100%",
    maxWidth: 340,
  },

  gmonke: {
    fontFamily: FONTS.display,
    fontSize: 28,
    color: "#FFD54F",
    textShadowColor: "rgba(255, 213, 79, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },

  bigBanana: {
    fontSize: 64,
  },

  earnedText: {
    fontFamily: FONTS.display,
    fontSize: 22,
    color: "#FFD54F",
    textAlign: "center",
  },

  // 7-day streak bar
  streakBar: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
  },
  streakSlot: {
    width: 38,
    height: 50,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  streakSlotFilled: {
    backgroundColor: "rgba(255, 213, 79, 0.12)",
    borderColor: "rgba(255, 213, 79, 0.25)",
  },
  streakSlotToday: {
    borderColor: "#FFD54F",
    borderWidth: 2,
    shadowColor: "#FFD54F",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  streakEmoji: {
    fontSize: 18,
  },
  streakEmojiDim: {
    opacity: 0.2,
  },
  streakDayLabel: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.textFaint,
  },
  streakDayLabelFilled: {
    color: "#FFD54F",
  },

  countdownText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: THEME.textMuted,
    textAlign: "center",
    lineHeight: 18,
  },
  bonusText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: "#FFD54F",
    textAlign: "center",
    lineHeight: 18,
  },

  balanceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255, 213, 79, 0.08)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 213, 79, 0.12)",
  },
  balanceLabel: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
  },
  balanceValue: {
    fontFamily: FONTS.display,
    fontSize: 18,
    color: "#FFD54F",
  },

  claimBtn: {
    backgroundColor: "#FFD54F",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 48,
    shadowColor: "#FFD54F",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  claimBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  claimBtnText: {
    fontFamily: FONTS.display,
    fontSize: 18,
    color: "#1a1a1a",
    letterSpacing: 0.5,
  },

  hint: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textFaint,
    textAlign: "center",
  },
});
