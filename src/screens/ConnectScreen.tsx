/**
 * ConnectScreen
 *
 * Entry point after splash. Checks for a valid 7-day session first —
 * if found, restores the wallet and goes straight to NFT verification.
 * Otherwise, prompts the user to connect their Solana wallet via MWA.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useMobileWallet } from "@/hooks/useMobileWallet";
import { useAppStore } from "@/store/appStore";
import { loadSession, saveSession } from "@/lib/session";
import { THEME, FONTS } from "@/lib/constants";

export default function ConnectScreen() {
  const { connect } = useMobileWallet();
  const { isLoading, error, setWallet } = useAppStore();
  const [checkingSession, setCheckingSession] = useState(true);

  // ─── Restore session on mount ──────────────────────────────────────────────
  useEffect(() => {
    loadSession().then((saved) => {
      if (saved) {
        // Restore wallet without re-prompting MWA
        setWallet(saved);
        router.replace("/verify");
      } else {
        setCheckingSession(false);
      }
    });
  }, []);

  const handleConnect = useCallback(async () => {
    const account = await connect();
    if (account) {
      await saveSession(account);
      router.replace("/verify");
    }
  }, [connect]);

  // Show a minimal spinner while we check SecureStore
  if (checkingSession) {
    return (
      <View style={styles.splashCheck}>
        <ActivityIndicator size="large" color={THEME.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Background glow */}
      <LinearGradient
        colors={["#7c5cfc22", "#0a0a1400", "#7c5cfc11"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Grid overlay */}
      <View style={styles.gridOverlay} pointerEvents="none" />

      <View style={styles.content}>
        {/* Logo mark */}
        <View style={styles.logoContainer}>
          <View style={styles.logoOuter}>
            <View style={styles.logoInner}>
              <Text style={styles.logoGlyph}>◆</Text>
            </View>
          </View>
          <View style={styles.logoPulse} />
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.eyebrow}>MEMBERS ONLY</Text>
          <Text style={styles.title}>Only{"\n"}Monkes</Text>
          <Text style={styles.subtitle}>
            Connect your wallet to verify your Saga Monkes NFT and unlock
            the holder-exclusive global chat.
          </Text>
        </View>

        {/* Features */}
        <View style={styles.features}>
          {[
            { icon: "🔐", label: "NFT-gated access" },
            { icon: "💬", label: "Holder-only chat" },
            { icon: "🔥", label: "Reactions & replies" },
          ].map((f) => (
            <View key={f.label} style={styles.featureRow}>
              <Text style={styles.featureIcon}>{f.icon}</Text>
              <Text style={styles.featureLabel}>{f.label}</Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        <Pressable
          style={({ pressed }) => [
            styles.connectButton,
            pressed && styles.connectButtonPressed,
          ]}
          onPress={handleConnect}
          disabled={isLoading}
        >
          <LinearGradient
            colors={["#9c7cff", "#7c5cfc", "#5c3cec"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.connectGradient}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.connectButtonText}>Connect Wallet</Text>
            )}
          </LinearGradient>
        </Pressable>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.hint}>
          Requires a Solana wallet app installed (Phantom, Solflare, etc.)
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  splashCheck: {
    flex: 1,
    backgroundColor: THEME.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.03,
    borderWidth: 1,
    borderColor: THEME.accent,
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 100,
    paddingBottom: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
  },
  logoContainer: {
    alignItems: "center",
    justifyContent: "center",
    width: 100,
    height: 100,
  },
  logoOuter: {
    width: 80,
    height: 80,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: THEME.accent + "66",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: THEME.accentSoft,
  },
  logoInner: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: THEME.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  logoGlyph: {
    fontSize: 24,
    color: "#fff",
  },
  logoPulse: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: THEME.accent + "33",
  },
  titleBlock: {
    alignItems: "center",
    gap: 10,
  },
  eyebrow: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 3,
    color: THEME.accent,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 38,
    color: THEME.text,
    textAlign: "center",
    lineHeight: 44,
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 15,
    color: THEME.textMuted,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 280,
  },
  features: {
    gap: 12,
    alignSelf: "stretch",
    backgroundColor: THEME.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  featureIcon: {
    fontSize: 18,
    width: 28,
    textAlign: "center",
  },
  featureLabel: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.text,
  },
  connectButton: {
    alignSelf: "stretch",
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: THEME.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
  },
  connectButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  connectGradient: {
    paddingVertical: 18,
    alignItems: "center",
  },
  connectButtonText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 17,
    color: "#fff",
    letterSpacing: 0.3,
  },
  errorBox: {
    backgroundColor: "#ff444422",
    borderWidth: 1,
    borderColor: "#ff4444",
    borderRadius: 10,
    padding: 12,
    alignSelf: "stretch",
  },
  errorText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: "#ff7777",
    textAlign: "center",
  },
  hint: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textFaint,
    textAlign: "center",
  },
});
