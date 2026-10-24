/**
 * invite.tsx — accept a referral invite: opened by onlymonkes://invite/<code>
 * or onlymonkes.app/r/<code> (deepLinks.ts, held until after login), or with
 * a code typed in. The worker records it; the bananas then come through
 * collectReferralBananas() (src/lib/referrals.ts).
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Image, TextInput, Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner-native";
import { THEME, FONTS } from "@/lib/constants";
import { WorldScreenShell, useWorldGlassCardStyle } from "@/components/worlds/WorldScreenShell";
import { monkeImageForNumber } from "@/lib/monkeMeme/monkeNumbers";
import { INVITE_CODE, claimInvite, collectReferralBananas, isReferralError, lookupInvite } from "@/lib/referrals";

const REWARDS = { referrer: 250, newHolder: 100 };

export default function InviteScreen() {
  const { t } = useTranslation();
  const cardStyle = useWorldGlassCardStyle();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(String(params.code ?? "").toUpperCase());
  const [typed, setTyped] = useState("");
  const [inviter, setInviter] = useState<{ name: string; pfp: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setInviter(null);
    setMessage(null);
    if (!INVITE_CODE.test(code)) return;
    let live = true;
    lookupInvite(code).then((r) => {
      if (!live) return;
      if (r) setInviter(r);
      else setMessage(t("invite.notFound"));
    });
    return () => { live = false; };
  }, [code, t]);

  const accept = async () => {
    setBusy(true);
    setMessage(null);
    const r = await claimInvite(code);
    if (isReferralError(r)) {
      setMessage(r.error);
    } else {
      setDone(true);
      // The web never adds bananas (it mirrors the phone's balance); the phone app collects them.
      setMessage(r.already ? t("invite.alreadyAccepted") : Platform.OS === "web" ? t("invite.acceptedWeb", { bananas: REWARDS.newHolder }) : t("invite.accepted"));
      const got = await collectReferralBananas(true);
      if (got.welcome) toast(t("invite.toastWelcome", { bananas: REWARDS.newHolder }));
    }
    setBusy(false);
  };

  const pfpUrl = inviter?.pfp ? monkeImageForNumber(inviter.pfp) : null;

  return (
    <WorldScreenShell title={t("invite.acceptTitle")} onBack={() => router.back()}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!INVITE_CODE.test(code) ? (
          <View style={[styles.card, cardStyle]}>
            <Text style={styles.label}>{t("invite.enterCode")}</Text>
            <TextInput
              value={typed}
              onChangeText={(v) => setTyped(v.replace(/[^2-9a-hj-np-z]/gi, "").toUpperCase().slice(0, 6))}
              placeholder={t("invite.codePlaceholder")}
              placeholderTextColor={THEME.textFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.input}
            />
            <Pressable style={[styles.btn, !INVITE_CODE.test(typed) && styles.off]} disabled={!INVITE_CODE.test(typed)} onPress={() => setCode(typed)}>
              <Text style={styles.btnText}>{t("invite.lookUp")}</Text>
            </Pressable>
          </View>
        ) : !inviter && !message ? (
          <ActivityIndicator style={{ marginTop: 60 }} size="large" color={THEME.accent} />
        ) : inviter ? (
          <View style={[styles.card, cardStyle, styles.center]}>
            {pfpUrl ? <Image source={{ uri: pfpUrl }} style={styles.pfp} /> : null}
            <Text style={styles.big}>{t("invite.invitedBy", { name: inviter.name })}</Text>
            {!done ? (
              <>
                <Text style={styles.muted}>{t("invite.acceptIntro", { name: inviter.name, referrer: REWARDS.referrer, newHolder: REWARDS.newHolder })}</Text>
                <Pressable style={[styles.btn, busy && styles.off]} disabled={busy} onPress={accept}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{t("invite.accept")}</Text>}
                </Pressable>
              </>
            ) : (
              <Pressable style={styles.btn} onPress={() => router.back()}><Text style={styles.btnText}>{t("invite.done")}</Text></Pressable>
            )}
          </View>
        ) : null}
        {message ? <Text style={[styles.muted, styles.centerText]}>{message}</Text> : null}
      </ScrollView>
    </WorldScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  card: { borderRadius: 16, padding: 16, borderWidth: 1, gap: 12 },
  center: { alignItems: "center" },
  centerText: { textAlign: "center" },
  label: { fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted, letterSpacing: 1 },
  big: { fontFamily: FONTS.display, fontSize: 22, color: THEME.text, textAlign: "center" },
  muted: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textMuted, lineHeight: 20, textAlign: "center" },
  pfp: { width: 120, height: 120, borderRadius: 16, backgroundColor: THEME.surface },
  input: {
    fontFamily: FONTS.mono, fontSize: 20, letterSpacing: 4, color: THEME.text, borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14,
  },
  btn: { backgroundColor: THEME.accent, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, alignItems: "center", alignSelf: "stretch" },
  off: { opacity: 0.5 },
  btnText: { fontFamily: FONTS.bodySemi, fontSize: 15, color: "#fff" },
});
