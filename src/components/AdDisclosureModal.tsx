/**
 * AdDisclosureModal — shown exactly once, ever, before the very first
 * automatic App Open ad (see useAppOpenAdGate.ts). Full transparency on
 * why ads exist and what happens to the money, before anything actually
 * pops up on the user unprompted.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { MonkeGlass, MonkeGlassActionButton } from "@/components/MonkeGlass";
import { THEME, FONTS } from "@/lib/constants";

interface AdDisclosureModalProps {
  visible: boolean;
  onAcknowledge: () => void;
}

export function AdDisclosureModal({ visible, onAcknowledge }: AdDisclosureModalProps) {
  return (
    <MonkeGlass visible={visible} onClose={onAcknowledge} position="bottom" persistent>
      <Text style={styles.title}>🍌 About OnlyMonkes ads</Text>
      <Text style={styles.body}>
        Every once in a while (at most every couple hours, only when you reopen the app fresh),
        you'll see a short automatic ad — no tap required to start it.
      </Text>
      <Text style={styles.body}>
        Ad revenue gets swapped into $SKR, staked, and used to pay OnlyMonkes' server and API
        costs — the rest builds a standing $SKR Vault. Eventually that Vault also funds
        community giveaways and buying Saga Monkes to add to it. Never sold or used for
        anything else.
      </Text>
      <Text style={styles.body}>
        Genesis Token holders see a slightly longer ad than Saga Monke holders. You can always
        skip the automatic ad the moment it's closeable, same as any standard ad.
      </Text>
      <MonkeGlassActionButton label="Got it" onPress={onAcknowledge} />
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
