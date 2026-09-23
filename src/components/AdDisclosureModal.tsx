/**
 * AdDisclosureModal — shown exactly once, ever, before the very first
 * automatic App Open ad (see useAppOpenAdGate.ts). Full transparency on
 * why ads exist and what happens to the money, before anything actually
 * pops up on the user unprompted.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { MonkeGlass, MonkeGlassActionButton } from "@/components/MonkeGlass";
import { THEME, FONTS } from "@/lib/constants";

interface AdDisclosureModalProps {
  visible: boolean;
  onAcknowledge: () => void;
}

export function AdDisclosureModal({ visible, onAcknowledge }: AdDisclosureModalProps) {
  const { t } = useTranslation();
  return (
    <MonkeGlass visible={visible} onClose={onAcknowledge} position="bottom" persistent>
      <Text style={styles.title}>{t("adDisclosure.title")}</Text>
      <Text style={styles.body}>{t("adDisclosure.body1")}</Text>
      <Text style={styles.body}>{t("adDisclosure.body2")}</Text>
      <Text style={styles.body}>{t("adDisclosure.body3")}</Text>
      <MonkeGlassActionButton label={t("adDisclosure.gotIt")} onPress={onAcknowledge} />
    </MonkeGlass>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: FONTS.displayMed,
    fontSize: 18,
    color: THEME.text,
    marginBottom: 12,
  },
  body: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
    lineHeight: 20,
    marginBottom: 12,
  },
});
