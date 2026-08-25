/**
 * UpdateAvailableModal — shown when useUpdatePrompt detects a downloaded,
 * ready-to-launch OTA update. Lets the user apply it with a tap instead of
 * needing to force-close and reopen the app.
 */
import React from "react";
import { Text, StyleSheet } from "react-native";
import { MonkeGlass, MonkeGlassActionButton } from "@/components/MonkeGlass";
import { THEME, FONTS } from "@/lib/constants";

interface UpdateAvailableModalProps {
  visible: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}

export function UpdateAvailableModal({ visible, onUpdate, onDismiss }: UpdateAvailableModalProps) {
  return (
    <MonkeGlass visible={visible} onClose={onDismiss} position="bottom">
      <Text style={styles.title}>🐒 Update ready</Text>
      <Text style={styles.body}>
        A new version of OnlyMonkes finished downloading in the background. Restart to use it —
        takes a couple seconds, nothing to reinstall.
      </Text>
      <MonkeGlassActionButton label="Update Now" onPress={onUpdate} />
      <MonkeGlassActionButton label="Later" onPress={onDismiss} variant="cancel" />
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
    marginBottom: 16,
  },
});
