/**
 * ConnectScreen
 *
 * Entry point after splash.
 *  - Checks for a valid 7-day wallet session → skip straight to verify.
 *  - Checks for a valid 7-day Matrica session → same skip.
 *  - Otherwise shows two sign-in options: Wallet (MWA) or Matrica.
 *
 * Layout:
 *   ┌─────────────────────────┐
 *   │      header.png         │  ← full-width, bleeds to status bar
 *   ├─────────────────────────┤
 *   │   OnlyMonkes            │
 *   │   Holder-only chat      │
 *   │                         │
 *   │  [ Connect Wallet ]     │
 *   │     ── or ──            │
 *   │  [ Continue w/ Matrica ]│
 *   └─────────────────────────┘
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Image,
  Modal,
  useWindowDimensions,
  Linking,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useMobileWallet } from "@/hooks/useMobileWallet";
import { useAppStore } from "@/store/appStore";
import {
  loadSession,
  saveSession,
  loadMatricaSession,
  saveMatricaSession,
} from "@/lib/session";
import {
  startMatricaAuth,
  handleMatricaCallback,
  isMatricaCallback,
} from "@/lib/matrica";
import { THEME, FONTS } from "@/lib/constants";

export default function ConnectScreen() {
  const insets = useSafeAreaInsets();
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const HEADER_HEIGHT = Math.round(SCREEN_H * 0.30);
  const { connect } = useMobileWallet();
  const { isLoading, error, setError, setWallet } = useAppStore();
  const [checkingSession, setCheckingSession] = useState(true);
  const [matricaLoading, setMatricaLoading] = useState(false);
  const [walletSheetOpen, setWalletSheetOpen] = useState(false);

  // ─── Restore session on mount ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      // Check Matrica session first
      const matrica = await loadMatricaSession();
      if (matrica) {
        setWallet(matrica);
        router.replace("/verify");
        return;
      }
      // Then wallet session
      const wallet = await loadSession();
      if (wallet) {
        setWallet(wallet);
        router.replace("/verify");
        return;
      }
      setCheckingSession(false);
    })();
  }, []);

  // ─── Matrica deep-link callback ────────────────────────────────────────────
  useEffect(() => {
    const handleUrl = async ({ url }: { url: string }) => {
      if (!isMatricaCallback(url)) return;
      setMatricaLoading(true);
      try {
        const { accessToken, walletAddress } = await handleMatricaCallback(url);
        await saveMatricaSession(accessToken, walletAddress);
        const account = {
          address: walletAddress,
          label: "Matrica",
          chains: ["solana:mainnet"] as string[],
          features: ["solana:signMessage", "solana:signTransaction"] as string[],
        };
        setWallet(account);
        router.replace("/verify");
      } catch (err: any) {
        setError(err?.message ?? "Matrica login failed");
      } finally {
        setMatricaLoading(false);
      }
    };

    const sub = Linking.addEventListener("url", handleUrl);
    // Also handle cold-start callback (app launched from redirect)
    Linking.getInitialURL().then((url) => {
      if (url && isMatricaCallback(url)) handleUrl({ url });
    });

    return () => sub.remove();
  }, []);

  // ─── Wallet connect ────────────────────────────────────────────────────────
  const handleConnect = useCallback(async () => {
    setError(null);
    const account = await connect();
    if (account) {
      await saveSession(account);
      router.replace("/verify");
    }
  }, [connect]);

  // ─── Matrica connect ───────────────────────────────────────────────────────
  const handleMatrica = useCallback(async () => {
    setError(null);
    try {
      await startMatricaAuth();
      // Callback handled by the Linking listener above
    } catch (err: any) {
      Alert.alert("Matrica", err?.message ?? "Could not open Matrica login.");
    }
  }, []);

  // ─── Session check spinner ─────────────────────────────────────────────────
  if (checkingSession) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={THEME.accent} />
      </View>
    );
  }

  const busy = isLoading || matricaLoading;

  return (
    <View style={styles.container}>
      {/* ── Header image — bleeds behind status bar ── */}
      <Image
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require("../../assets/header.png")}
        style={{ width: SCREEN_W, height: HEADER_HEIGHT }}
        resizeMode="cover"
      />

      {/* ── Content ── */}
      <View style={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {/* Title */}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>OnlyMonkes</Text>
          <Text style={styles.subtitle}>
            Holder-only global chat for Saga Monkes.
          </Text>
        </View>

        {/* Buttons */}
        <View style={styles.buttons}>
          {/* Single Login button */}
          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && styles.btnPressed,
            ]}
            onPress={() => setWalletSheetOpen(true)}
            disabled={busy}
          >
            <LinearGradient
              colors={["#9c7cff", "#7c5cfc", "#5c3cec"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryGradient}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Login</Text>
              )}
            </LinearGradient>
          </Pressable>
        </View>

        {/* Error */}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <Text style={styles.hint}>
            Requires a Solana wallet app (Phantom, Solflare, etc.)
          </Text>
        )}
      </View>

      {/* Wallet picker bottom sheet */}
      <Modal
        visible={walletSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setWalletSheetOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setWalletSheetOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Choose Wallet</Text>

          {[
            { icon: "🟣", label: "Phantom", onPress: async () => { setWalletSheetOpen(false); await handleConnect(); } },
            { icon: "🔥", label: "Solflare", onPress: async () => { setWalletSheetOpen(false); await handleConnect(); } },
            { icon: "📱", label: "Mobile Wallet Adapter", onPress: async () => { setWalletSheetOpen(false); await handleConnect(); } },
            { icon: "M",  label: "Continue with Matrica", onPress: async () => { setWalletSheetOpen(false); await handleMatrica(); } },
          ].map(({ icon, label, onPress }) => (
            <Pressable
              key={label}
              style={({ pressed }) => [styles.walletRow, pressed && styles.walletRowPressed]}
              onPress={onPress}
            >
              <Text style={styles.walletIcon}>{icon}</Text>
              <Text style={styles.walletLabel}>{label}</Text>
              <Text style={styles.walletChevron}>›</Text>
            </Pressable>
          ))}

          <Pressable style={styles.sheetCancelBtn} onPress={() => setWalletSheetOpen(false)}>
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: THEME.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },

  // ── Content ───────────────────────────────────────────────────────────────
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 36,
    alignItems: "center",
    justifyContent: "space-between",
  },
  titleBlock: {
    alignItems: "center",
    gap: 10,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 34,
    color: THEME.text,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 15,
    color: THEME.textMuted,
    textAlign: "center",
    lineHeight: 22,
  },

  // ── Buttons ───────────────────────────────────────────────────────────────
  buttons: {
    alignSelf: "stretch",
    gap: 0,
  },
  btnPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },

  primaryBtn: {
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: THEME.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  primaryGradient: {
    paddingVertical: 17,
    alignItems: "center",
  },
  primaryBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 16,
    color: "#fff",
    letterSpacing: 0.3,
  },

  // ── Wallet Picker Sheet ───────────────────────────────────────────────────
  sheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: THEME.surfaceHigh,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: THEME.border,
    padding: 24,
    paddingBottom: 36,
    gap: 4,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: THEME.border,
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetTitle: {
    fontFamily: FONTS.display,
    fontSize: 18,
    color: THEME.text,
    textAlign: "center",
    marginBottom: 12,
  },
  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    marginBottom: 8,
  },
  walletRowPressed: {
    opacity: 0.75,
    backgroundColor: THEME.surfaceHigh,
  },
  walletIcon: {
    fontSize: 22,
    width: 28,
    textAlign: "center",
  },
  walletLabel: {
    flex: 1,
    fontFamily: FONTS.bodyMed,
    fontSize: 16,
    color: THEME.text,
  },
  walletChevron: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: THEME.textFaint,
  },
  sheetCancelBtn: {
    alignItems: "center",
    paddingVertical: 10,
    marginTop: 4,
  },
  sheetCancelText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textFaint,
  },

  // ── Error / Hint ──────────────────────────────────────────────────────────
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
