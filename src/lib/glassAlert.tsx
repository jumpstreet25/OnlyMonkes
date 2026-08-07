/**
 * glassAlert.tsx — MonkeGlass-styled drop-in replacement for RN's Alert.alert.
 *
 * 2026-08-06: native Alert.alert renders the OS's own plain gray dialog,
 * which clashes hard against every other popup in the app (all built on
 * GlassModal's frosted-glass treatment) — most visible right after a
 * Banana Shop purchase. Same call signature as Alert.alert(title, message,
 * buttons) so call sites are a straight swap; only the render target
 * (GlassModal instead of the native dialog) differs. Imperative API (a
 * module-level subscriber, not a hook) since Alert.alert is called from
 * anywhere, including outside React render — mirroring how Alert.alert
 * itself works.
 *
 * Usage: showGlassAlert("Purchased!", "Frost Grove is now equipped.")
 * Mount <GlassAlertRoot /> once, near the app root (app/_layout.tsx).
 */

import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { GlassModal } from "@/components/GlassModal";
import { THEME, FONTS } from "@/lib/constants";

export interface GlassAlertButton {
  text: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
}

interface GlassAlertState {
  visible: boolean;
  title: string;
  message?: string;
  buttons: GlassAlertButton[];
}

const EMPTY_STATE: GlassAlertState = { visible: false, title: "", buttons: [] };

let _setState: ((s: GlassAlertState) => void) | null = null;

export function showGlassAlert(title: string, message?: string, buttons?: GlassAlertButton[]): void {
  const resolvedButtons = buttons && buttons.length > 0 ? buttons : [{ text: "OK" }];
  _setState?.({ visible: true, title, message, buttons: resolvedButtons });
}

export function GlassAlertRoot() {
  const [state, setState] = useState<GlassAlertState>(EMPTY_STATE);

  useEffect(() => {
    _setState = setState;
    return () => { _setState = null; };
  }, []);

  const close = () => setState(s => ({ ...s, visible: false }));

  return (
    <GlassModal visible={state.visible} onClose={close} position="center">
      <Text style={styles.title}>{state.title}</Text>
      {state.message ? <Text style={styles.message}>{state.message}</Text> : null}
      <View style={styles.buttonCol}>
        {state.buttons.map((btn, i) => (
          <Pressable
            key={i}
            style={({ pressed }) => [
              styles.button,
              btn.style === "cancel" && styles.buttonCancel,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => { close(); btn.onPress?.(); }}
          >
            <Text
              style={[
                styles.buttonText,
                btn.style === "destructive" && styles.buttonTextDestructive,
                btn.style === "cancel" && styles.buttonTextCancel,
              ]}
            >
              {btn.text}
            </Text>
          </Pressable>
        ))}
      </View>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: FONTS.display,
    fontSize: 18,
    color: THEME.text,
    marginBottom: 8,
  },
  message: {
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 20,
    color: THEME.textMuted,
    marginBottom: 20,
  },
  buttonCol: {
    gap: 10,
  },
  button: {
    backgroundColor: "rgba(108, 180, 238, 0.14)",
    borderRadius: 12,
    borderWidth: 0.75,
    borderColor: "rgba(108, 180, 238, 0.28)",
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonCancel: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: "rgba(255, 255, 255, 0.10)",
  },
  buttonText: {
    fontFamily: FONTS.displayMed,
    fontSize: 15,
    color: THEME.accent,
  },
  buttonTextCancel: {
    color: THEME.textMuted,
  },
  buttonTextDestructive: {
    color: "#FF6B6B",
  },
});
