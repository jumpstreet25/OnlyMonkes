/**
 * Warns when a token has an active Token-2022 transfer hook (e.g. a Hooked
 * launch) — the rule can stop a sell. Renders nothing for plain tokens,
 * graduated Hooked tokens (hook removed), or while the check is in flight.
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { FONTS } from "@/lib/constants";
import { fetchTransferHook, hookExitSeverity, HOOK_EXIT_TEXT, type TransferHookInfo } from "@/lib/transferHook";

const COLORS = {
  info: { fg: "#60A5FA", border: "rgba(96,165,250,0.35)", bg: "rgba(96,165,250,0.08)" },
  warn: { fg: "#F59E0B", border: "rgba(245,158,11,0.4)", bg: "rgba(245,158,11,0.10)" },
  danger: { fg: "#EF4444", border: "rgba(239,68,68,0.45)", bg: "rgba(239,68,68,0.12)" },
};

export function TransferHookNotice({ mint, style }: { mint: string | null | undefined; style?: StyleProp<ViewStyle> }) {
  const [info, setInfo] = useState<TransferHookInfo | null>(null);

  useEffect(() => {
    setInfo(null);
    if (!mint) return;
    let alive = true;
    fetchTransferHook(mint).then((r) => { if (alive) setInfo(r); }).catch(() => {});
    return () => { alive = false; };
  }, [mint]);

  if (!info) return null;
  const c = COLORS[hookExitSeverity(info.exit)];
  return (
    <View style={[s.box, { borderColor: c.border, backgroundColor: c.bg }, style]}>
      <Text style={[s.title, { color: c.fg }]}>
        🪝 {info.hooked ? "Hooked rule" : "Transfer rule"}: {info.rule}
      </Text>
      <Text style={[s.body, { color: c.fg }]}>{HOOK_EXIT_TEXT[info.exit]}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 10,
  },
  title: {
    fontFamily: FONTS.bodySemi,
    fontSize: 12,
  },
  body: {
    fontFamily: FONTS.body,
    fontSize: 11,
    marginTop: 2,
  },
});
