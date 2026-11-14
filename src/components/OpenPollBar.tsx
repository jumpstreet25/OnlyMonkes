/**
 * OpenPollBar — Main Chat bar for a running poll this phone hasn't voted in.
 * The poll pop-up shows once and POLL_OPEN: never appears as a chat message, so a
 * missed or closed pop-up used to leave no way to vote (Monke Live poll, 2026-11-13).
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/appStore";
import { THEME, FONTS } from "@/lib/constants";

export function OpenPollBar() {
  const { t } = useTranslation();
  const openPolls = useAppStore((s) => s.openPolls);
  const setActivePoll = useAppStore((s) => s.setActivePoll);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (openPolls.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [openPolls.length]);

  const running = openPolls.filter((p) => p.resolvesAt > now);
  if (running.length === 0) return null;
  const poll = running[running.length - 1];

  return (
    <Pressable style={styles.bar} onPress={() => setActivePoll(poll)} accessibilityRole="button">
      <Text style={styles.icon}>🗳️</Text>
      <View style={styles.body}>
        <Text style={styles.label}>
          {running.length > 1 ? t("pollBar.openMany", { count: running.length }) : t("pollBar.open")}
        </Text>
        <Text style={styles.question} numberOfLines={1}>{poll.question}</Text>
      </View>
      <Text style={styles.vote}>{t("pollBar.vote")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: THEME.surfaceHigh,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  icon: { fontSize: 14, marginRight: 8 },
  body: { flex: 1 },
  label: { color: THEME.accent, fontSize: 11, fontFamily: FONTS.mono, fontWeight: "700" },
  question: { color: THEME.text, fontSize: 13, marginTop: 1 },
  vote: {
    color: THEME.text,
    backgroundColor: THEME.accent,
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    overflow: "hidden",
    marginLeft: 8,
  },
});
