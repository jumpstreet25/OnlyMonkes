/**
 * /pair — opened on the phone from the desktop's QR. Shows the pairing code,
 * lets the user pick the phone's wallet (Seeker Connect / MWA), and sends the
 * encrypted login bundle to the waiting desktop (src/web/pairing.ts).
 */
import React, { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { THEME, FONTS } from "@/lib/constants";
import { PAIR_CHOICE_KEY, useWalletChoices } from "@/hooks/useWalletChoices";
import { approveOnPhone, lookupShortCode, pairCode, readPairLink } from "@/web/pairing";

export default function PairScreen() {
  const [link, setLink] = useState(() => (typeof window !== "undefined" ? readPairLink(window.location.hash) : null));
  const { choices: all, choose } = useWalletChoices();
  const choices = all.filter((c) => c.key !== PAIR_CHOICE_KEY);
  const [state, setState] = useState<"ready" | "busy" | "done" | "error">("ready");
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [looking, setLooking] = useState(false);

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
        <Text style={styles.body}>On your computer, choose Login → "Seeker / Saga — scan to log in", then type the 8-character code it shows.</Text>
        <TextInput
          value={typed}
          onChangeText={setTyped}
          onSubmitEditing={submit}
          placeholder="K7Q4-MX2P"
          placeholderTextColor={THEME.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={11}
          style={styles.input}
          accessibilityLabel="Code from your computer"
        />
        <Pressable
          onPress={submit}
          disabled={looking || typed.replace(/[\s-]/g, "").length < 8}
          style={({ pressed }) => [styles.button, (pressed || looking) && styles.rowDim]}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{looking ? "Checking…" : "Continue"}</Text>
        </Pressable>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    );
  }

  const approve = async (key: string) => {
    const c = choices.find((x) => x.key === key);
    if (!c) return;
    choose(c);
    setState("busy");
    setError(null);
    try {
      await approveOnPhone(link);
      setState("done");
    } catch (e) {
      setError((e as Error)?.message ?? "Approval failed");
      setState("error");
    }
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
          <Text style={styles.body}>Approve with (you'll sign twice: sign-in, then chat identity):</Text>
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
  rowLabel: { flex: 1, fontFamily: FONTS.bodyMed, fontSize: 16, color: THEME.text },
  input: { fontFamily: FONTS.display, fontSize: 26, letterSpacing: 4, textAlign: "center", color: THEME.text, backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border, borderRadius: 14, paddingVertical: 14, marginTop: 8 },
  button: { alignSelf: "center", paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12, backgroundColor: THEME.accent },
  buttonText: { fontFamily: FONTS.bodySemi, fontSize: 16, color: "#fff" },
});
