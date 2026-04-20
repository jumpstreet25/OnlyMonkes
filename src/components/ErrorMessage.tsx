/**
 * ErrorMessage — Standardized error state with optional retry button.
 * Use across screens to replace raw error text with a consistent UI.
 */

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { THEME, FONTS } from "@/lib/constants";

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorMessage({ message, onRetry, retryLabel = "Retry" }: ErrorMessageProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>!</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} style={styles.retryBtn}>
          <Text style={styles.retryText}>{retryLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(239,68,68,0.15)",
    color: THEME.error,
    fontSize: 18,
    fontFamily: FONTS.display,
    textAlign: "center",
    lineHeight: 36,
    overflow: "hidden",
  },
  message: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    backgroundColor: "rgba(124,58,237,0.15)",
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.25)",
  },
  retryText: {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: THEME.accent,
  },
});
