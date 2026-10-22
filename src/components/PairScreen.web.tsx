/**
 * /pair — opened on the phone from the desktop's QR. Shows the pairing code,
 * lets the user pick the phone's wallet (Seeker Connect / MWA), and sends the
 * encrypted login bundle to the waiting desktop (src/web/pairing.ts).
 */
import React, { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { THEME, FONTS } from "@/lib/constants";
import { PAIR_CHOICE_KEY, useWalletChoices } from "@/hooks/useWalletChoices";
import { approveOnPhone, collectWithWalletStandard, lookupShortCode, pairCode, pairingIsLive, readPairLink } from "@/web/pairing";
import { router } from "expo-router";
import { collectWithMwa } from "@/web/mwaSession";
import { MWA_WALLET_NAME, isInAppBrowser, openInChrome } from "@/web/walletStandard";

export default function PairScreen() {
  const [link, setLink] = useState(() => (typeof window !== "undefined" ? readPairLink(window.location.hash) : null));
  const { choices: all, choose } = useWalletChoices();
  const choices = all.filter((c) => c.key !== PAIR_CHOICE_KEY);
  const [state, setState] = useState<"ready" | "busy" | "done" | "error">("ready");
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [looking, setLooking] = useState(false);
  const [expired, setExpired] = useState(false);

  // A /pair link reopened from browser history points at a pairing that has
  // long expired; say so instead of offering an approval that can't work.
  useEffect(() => {
    if (!link) return;
    let live = true;
    pairingIsLive(link.id).then((ok) => { if (live && !ok) setExpired(true); });
    return () => { live = false; };
  }, [link]);

  const goHome = () => {
    if (typeof window !== "undefined") window.history.replaceState(null, "", "/pair");
    router.replace("/");
  };
  const homeLink = (
    <Pressable onPress={goHome} accessibilityRole="link" style={styles.homeLink}>
      <Text style={styles.homeLinkText}>Log in to OnlyMonkes on this phone instead</Text>
    </Pressable>
  );

  if (link && expired && state !== "done") {
    return (
      <View style={styles.page}>
        <Text style={styles.title}>This login code has expired</Text>
        <Text style={styles.body}>Codes last 5 minutes. To log in on your computer, show a new code there and enter it here.</Text>
        <Pressable
          onPress={() => { setExpired(false); setLink(null); if (typeof window !== "undefined") window.history.replaceState(null, "", "/pair"); }}
          style={styles.button}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Enter a new code</Text>
        </Pressable>
        {homeLink}
      </View>
    );
  }

  // Opened from Google Lens / the camera: those in-app browsers
  // can't open a wallet (the Seeker Connect link lands on solanamobile.com).
  if (isInAppBrowser()) {
    return (
      <View style={styles.page}>
        <Text style={styles.title}>Open this page in Chrome</Text>
        {link && <Text style={styles.code}>{pairCode(link.desktopKey)}</Text>}
        <Text style={styles.body}>
          This page opened inside another app's browser, and your wallet can't open from there. Tap below to continue in Chrome
          {link ? " — the match number stays the same." : "."}
        </Text>
        <Pressable onPress={openInChrome} style={styles.button} accessibilityRole="button">
          <Text style={styles.buttonText}>Open in Chrome</Text>
        </Pressable>
        <Text style={styles.body}>Nothing happens? Tap ⋮ (top right) → "Open in Chrome" / "Open in browser".</Text>
      </View>
    );
  }

  if (!link) {
    const submit = async () => {
      setLooking(true);
      setError(null);
      try {
        setLink(await lookupShortCode(typed));
      } catch (e) {
        setError((e as Error)?.message ?? "Code not found");
      } finally {
        setLooking(false);
      }
    };
    return (
      <View style={styles.page}>
        <Text style={styles.title}>Approve a login on your computer</Text>
        <Text style={styles.body}>This page is only for logging in on a computer with your phone.</Text>
        <Text style={styles.body}>1. On your computer, open this site and choose Login → "Seeker / Saga — scan to log in".</Text>
        <Text style={styles.body}>2. Type the gold 8-character code your computer shows here, then tap Continue.</Text>
        <TextInput
          value={typed}
          onChangeText={setTyped}
          onSubmitEditing={submit}
          placeholder="Code from your computer"
          placeholderTextColor={THEME.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={11}
          style={styles.input}
          accessibilityLabel="Code from your computer"
        />
        <Pressable
          onPress={submit}
          disabled={looking}
          style={({ pressed }) => [styles.button, (pressed || looking) && styles.rowDim]}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{looking ? "Checking…" : "Continue"}</Text>
        </Pressable>
        {error && <Text style={styles.error}>{error}</Text>}
        {homeLink}
      </View>
    );
  }

  // Start the wallet session synchronously inside the tap: Chrome on Android
  // only opens the wallet app for a launch that directly follows a tap.
  const approve = (key: string) => {
    const c = choices.find((x) => x.key === key);
    if (!c) return;
    choose(c);
    const bundle = c.key === MWA_WALLET_NAME ? collectWithMwa() : collectWithWalletStandard();
    setState("busy");
    setError(null);
    approveOnPhone(link, bundle)
      .then(() => setState("done"))
      .catch((e) => {
        setError((e as Error)?.message ?? "Approval failed");
        setState("error");
      });
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Log in to OnlyMonkes on your computer?</Text>
      <Text style={styles.code}>{pairCode(link.desktopKey)}</Text>
      <Text style={styles.warn}>
        Only continue if your computer shows this same match number and you started this login yourself.
        Approving gives that browser access to your OnlyMonkes chats.
      </Text>

      {state === "done" ? (
        <Text style={styles.ok}>Approved. Continue on your computer — you can close this page.</Text>
      ) : choices.length === 0 ? (
        <Text style={styles.body}>
          No wallet found in this browser. Open this page in your Seeker or Saga's built-in browser.
        </Text>
      ) : (
        <View style={styles.list}>
          <Text style={styles.body}>Approve with (one wallet approval covers the sign-in and your chat identity):</Text>
          {choices.map((c) => (
            <Pressable
              key={c.key}
              disabled={state === "busy"}
              onPress={() => approve(c.key)}
              style={({ pressed }) => [styles.row, (pressed || state === "busy") && styles.rowDim]}
              accessibilityRole="button"
            >
              {c.iconUri ? <Image source={{ uri: c.iconUri }} style={styles.icon} /> : <Text style={styles.iconText}>{c.icon}</Text>}
              <Text style={styles.rowLabel}>{c.label}</Text>
            </Pressable>
          ))}
          {state === "busy" && <Text style={styles.body}>Waiting for your wallet…</Text>}
          {state === "error" && <Text style={styles.error}>{error}</Text>}
        </View>
      )}
      {homeLink}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: THEME.bg, padding: 24, paddingTop: 48, gap: 14, maxWidth: 520, width: "100%", alignSelf: "center" },
  title: { fontFamily: FONTS.display, fontSize: 20, color: THEME.text, textAlign: "center" },
  code: { fontFamily: FONTS.display, fontSize: 40, letterSpacing: 8, color: THEME.gold, textAlign: "center", marginVertical: 6 },
  warn: { fontFamily: FONTS.body, fontSize: 14, color: THEME.warning, textAlign: "center", lineHeight: 20 },
  body: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textMuted, textAlign: "center", lineHeight: 20 },
  ok: { fontFamily: FONTS.bodySemi, fontSize: 16, color: THEME.success, textAlign: "center", marginTop: 12 },
  error: { fontFamily: FONTS.body, fontSize: 14, color: THEME.error, textAlign: "center" },
  list: { gap: 10, marginTop: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 14, backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border },
  rowDim: { opacity: 0.6 },
  icon: { width: 28, height: 28, borderRadius: 6 },
  iconText: { fontSize: 22, width: 28, textAlign: "center" },
  homeLink: { alignSelf: "center", marginTop: 18, padding: 8 },
  homeLinkText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: THEME.accent, textDecorationLine: "underline" },
  rowLabel: { flex: 1, fontFamily: FONTS.bodyMed, fontSize: 16, color: THEME.text },
  input: { fontFamily: FONTS.display, fontSize: 22, letterSpacing: 3, textAlign: "center", color: THEME.text, backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border, borderRadius: 14, paddingVertical: 14, marginTop: 8 },
  button: { alignSelf: "center", paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12, backgroundColor: THEME.accent },
  buttonText: { fontFamily: FONTS.bodySemi, fontSize: 16, color: "#fff" },
});
