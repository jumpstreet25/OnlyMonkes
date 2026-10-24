/**
 * invite-friends.tsx — your referral invite (src/lib/referrals.ts): the card
 * (your PFP art, name and a QR, drawn by the actions worker), share / copy /
 * post on X, how many joined, Recruiter badges. Collects any bananas owed.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Image, Share, Linking } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { toast } from "sonner-native";
import { THEME, FONTS } from "@/lib/constants";
import { WorldScreenShell, useWorldGlassCardStyle } from "@/components/worlds/WorldScreenShell";
import { collectReferralBananas, getMyReferral, isReferralError, type MyReferral } from "@/lib/referrals";

const BADGE_STEPS = [1, 5, 25];

export default function InviteFriendsScreen() {
  const { t } = useTranslation();
  const cardStyle = useWorldGlassCardStyle();
  const [me, setMe] = useState<MyReferral | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await getMyReferral();
    if (isReferralError(r)) { setError(r.error); return; }
    setMe(r);
    const got = await collectReferralBananas(true);
    if (got.bananas > 0) toast(t("invite.toastReferrer", { bananas: got.bananas, count: got.referrals }));
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const shareText = me ? `${t("invite.shareText", { newHolder: me.rewards.newHolder })} ${me.url}` : "";
  const onShare = () => { if (me) Share.share({ message: shareText, url: me.url }).catch(() => {}); };
  const onCopy = async () => { if (!me) return; await Clipboard.setStringAsync(me.url); toast(t("invite.copied")); };
  const onX = () => {
    if (!me) return;
    const text = t("invite.shareText", { newHolder: me.rewards.newHolder });
    Linking.openURL(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(me.url)}`).catch(() => {});
  };

  return (
    <WorldScreenShell title={t("invite.title")} onBack={() => router.back()}>
      <ScrollView contentContainerStyle={styles.content}>
        {error ? (
          <View style={[styles.card, cardStyle]}>
            <Text style={styles.body}>{error}</Text>
            <Pressable style={styles.btn} onPress={load}><Text style={styles.btnText}>↻</Text></Pressable>
          </View>
        ) : !me ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={THEME.accent} />
            <Text style={styles.muted}>{t("invite.loading")}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.intro}>{t("invite.intro", { referrer: me.rewards.referrer, newHolder: me.rewards.newHolder })}</Text>
            <Image source={{ uri: me.card }} style={styles.cardImg} resizeMode="contain" />
            <View style={[styles.card, cardStyle]}>
              <Text style={styles.label}>{t("invite.yourLink")}</Text>
              <Text selectable style={styles.link}>{me.url}</Text>
              <View style={styles.row}>
                <Pressable style={styles.btn} onPress={onShare}><Text style={styles.btnText}>{t("invite.share")}</Text></Pressable>
                <Pressable style={[styles.btn, styles.ghost]} onPress={onCopy}><Text style={styles.btnText}>{t("invite.copy")}</Text></Pressable>
                <Pressable style={[styles.btn, styles.ghost]} onPress={onX}><Text style={styles.btnText}>{t("invite.postOnX")}</Text></Pressable>
              </View>
            </View>
            <View style={[styles.card, cardStyle]}>
              <Text style={styles.big}>{t("invite.stats", { count: me.referred })}</Text>
              <Text style={styles.label}>{t("invite.badges")}</Text>
              <View style={styles.row}>
                {BADGE_STEPS.map((n) => (
                  <View key={n} style={[styles.badge, me.badges.includes(n) ? styles.badgeOn : null]}>
                    <Text style={styles.badgeText}>🎖️ {n}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.muted}>{me.nextBadge ? t("invite.nextBadge", { n: me.nextBadge }) : t("invite.allBadges")}</Text>
              <Text style={styles.muted}>{me.season ? t("invite.seasonOn", { id: me.season.id, count: me.season.count }) : t("invite.seasonOff")}</Text>
            </View>
            <Pressable onPress={() => router.push("/invite" as any)}>
              <Text style={styles.linkBtn}>{t("invite.haveCode")}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </WorldScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  loading: { alignItems: "center", paddingTop: 80, gap: 12 },
  intro: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted, lineHeight: 19 },
  cardImg: { width: "100%", aspectRatio: 1200 / 630, borderRadius: 14, backgroundColor: THEME.surface },
  card: { borderRadius: 16, padding: 16, borderWidth: 1, gap: 10 },
  label: { fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted, letterSpacing: 1 },
  link: { fontFamily: FONTS.mono, fontSize: 14, color: THEME.text },
  big: { fontFamily: FONTS.display, fontSize: 20, color: THEME.text },
  body: { fontFamily: FONTS.body, fontSize: 14, color: THEME.text, lineHeight: 20 },
  muted: { fontFamily: FONTS.body, fontSize: 13, color: THEME.textMuted },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btn: { backgroundColor: THEME.accent, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16 },
  ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  btnText: { fontFamily: FONTS.bodySemi, fontSize: 14, color: "#fff" },
  badge: { borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", opacity: 0.45 },
  badgeOn: { opacity: 1, borderColor: THEME.gold },
  badgeText: { fontFamily: FONTS.bodySemi, fontSize: 13, color: THEME.text },
  linkBtn: { fontFamily: FONTS.bodyMed, fontSize: 14, color: THEME.accent, textAlign: "center", paddingVertical: 8 },
});
