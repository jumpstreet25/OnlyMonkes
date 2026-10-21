/**
 * Desktop: "Seeker / Saga — scan to log in". Shows the pairing QR + code,
 * waits for the phone, then logs this browser in as the phone's wallet
 * (same XMTP inbox). See src/web/pairing.ts for the protocol.
 */
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import QRCode from "qrcode";
import { MonkeGlass } from "@/components/MonkeGlass";
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { rehydrateForWallet } from "@/lib/walletIdentity";
import { bindXmtpToWallet, prepareWalletBoundXmtp } from "@/lib/xmtp";
import { formatShortCode, pairedIdentitySigner, startDesktopPairing, type DesktopPairing, type PairBundle } from "@/web/pairing";
import type { WalletAccount } from "@/types";

function siteHost(): string {
  return typeof window !== "undefined" ? window.location.host : "this site";
}

async function completePairedLogin(bundle: PairBundle): Promise<WalletAccount> {
  const account: WalletAccount = {
    address: bundle.wallet,
    label: "Seeker (paired)",
    chains: ["solana:mainnet"],
    features: ["solana:signMessage"],
  };
  useAppStore.getState().setWallet(account);
  await rehydrateForWallet(account.address);
  bindXmtpToWallet(account.address);
  await prepareWalletBoundXmtp(account.address, pairedIdentitySigner(bundle));
  return account;
}

export function PairModal({ visible, onClose, onPaired }: {
  visible: boolean;
  onClose: () => void;
  onPaired: (account: WalletAccount) => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [status, setStatus] = useState<"starting" | "waiting" | "finishing" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pairing = useRef<DesktopPairing | null>(null);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setQr(null);
    setError(null);
    setStatus("starting");
    (async () => {
      try {
        const p = await startDesktopPairing();
        if (!live) return p.cancel();
        pairing.current = p;
        setCode(p.code);
        setShortCode(p.shortCode);
        setQr(await QRCode.toDataURL(p.url, { margin: 1, width: 260, errorCorrectionLevel: "M" }));
        setStatus("waiting");
        const bundle = await p.result;
        if (!live) return;
        setStatus("finishing");
        onPaired(await completePairedLogin(bundle));
      } catch (e) {
        if (!live) return;
        setError((e as Error)?.message ?? "Pairing failed");
        setStatus("error");
      }
    })();
    return () => {
      live = false;
      pairing.current?.cancel();
      pairing.current = null;
    };
  }, [visible, attempt]);

  return (
    <MonkeGlass visible={visible} onClose={onClose} cardStyle={styles.card}>
      <Text style={styles.title}>Log in with your Seeker or Saga</Text>
      <Text style={styles.step}>1. Scan this QR with your phone's camera or Google Lens. Or open {siteHost()} in your phone's browser, tap "Approving a login on your computer?" and type the code below.</Text>
      <Text style={styles.step}>2. Check the 4-digit number on your phone matches, then approve in your wallet.</Text>
      <View style={styles.qrBox}>
        {qr ? <Image source={{ uri: qr }} style={styles.qr} /> : <ActivityIndicator color={THEME.accent} />}
      </View>
      {shortCode ? <Text style={styles.shortCode}>{formatShortCode(shortCode)}</Text> : null}
      {code ? <Text style={styles.code}>Match number: {code}</Text> : null}
      {status === "waiting" && <Text style={styles.muted}>Waiting for your phone… (expires in 5 minutes)</Text>}
      {status === "finishing" && <Text style={styles.muted}>Approved — opening chat…</Text>}
      {status === "error" && (
        <>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.button} onPress={() => setAttempt((n) => n + 1)} accessibilityRole="button">
            <Text style={styles.buttonText}>Show a new code</Text>
          </Pressable>
        </>
      )}
      <Text style={styles.note}>Your wallet's keys stay on the phone. This browser gets chat access only; payments still need your phone.</Text>
      <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel}>
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </MonkeGlass>
  );
}

const styles = StyleSheet.create({
  card: { maxWidth: 420, width: "100%", alignSelf: "center", padding: 22 },
  title: { fontFamily: FONTS.display, fontSize: 18, color: THEME.text, textAlign: "center", marginBottom: 12 },
  step: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textMuted, lineHeight: 20, marginBottom: 4 },
  qrBox: { alignSelf: "center", width: 272, height: 272, marginTop: 12, borderRadius: 14, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  qr: { width: 260, height: 260 },
  shortCode: { fontFamily: FONTS.display, fontSize: 30, letterSpacing: 4, color: THEME.gold, textAlign: "center", marginTop: 14 },
  code: { fontFamily: FONTS.body, fontSize: 15, letterSpacing: 2, color: THEME.text, textAlign: "center", marginTop: 6 },
  muted: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, textAlign: "center", marginTop: 8 },
  error: { fontFamily: FONTS.body, fontSize: 14, color: THEME.error, textAlign: "center", marginTop: 8 },
  note: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textDim, textAlign: "center", marginTop: 14, lineHeight: 17 },
  button: { alignSelf: "center", marginTop: 10, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12, backgroundColor: THEME.accent },
  buttonText: { fontFamily: FONTS.bodySemi, fontSize: 14, color: "#fff" },
  cancel: { alignSelf: "center", marginTop: 12, padding: 8 },
  cancelText: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textMuted },
});
