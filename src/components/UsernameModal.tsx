/**
 * UsernameModal
 *
 * Full-screen modal shown on first entry to the chat.
 * Collects a username (required) and a short bio (optional).
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { THEME, FONTS } from "@/lib/constants";
import { saveUserProfile } from "@/lib/userProfile";
import { useAppStore } from "@/store/appStore";

interface UsernameModalProps {
  visible: boolean;
  onDone: () => void;
}

const MAX_USERNAME = 20;
const MAX_BIO = 100;

export function UsernameModal({ visible, onDone }: UsernameModalProps) {
  const { setUsername, setBio } = useAppStore();
  const [name, setName] = useState("");
  const [bio, setBioLocal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const trimmedName = name.trim();
  const canSave = trimmedName.length >= 2 && !saving;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    if (/[^a-zA-Z0-9_\-. ]/.test(trimmedName)) {
      setError("Username can only contain letters, numbers, spaces, _ - .");
      return;
    }

    setSaving(true);
    setError("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await saveUserProfile(trimmedName, bio.trim());
      setUsername(trimmedName);
      setBio(bio.trim());
      onDone();
    } catch {
      setError("Failed to save — please try again.");
    } finally {
      setSaving(false);
    }
  }, [canSave, trimmedName, bio, setUsername, setBio, onDone]);

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <LinearGradient
          colors={["#7c5cfc18", "#0a0a1400", "#7c5cfc0a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.content}>
          {/* Icon */}
          <View style={styles.iconWrap}>
            <View style={styles.iconInner}>
              <Text style={styles.iconGlyph}>🐒</Text>
            </View>
          </View>

          <Text style={styles.title}>Create your profile</Text>
          <Text style={styles.subtitle}>
            Choose a name that other holders will see in the chat.
          </Text>

          {/* Username */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Username *</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  setError("");
                }}
                placeholder="e.g. CryptoMonke"
                placeholderTextColor={THEME.textFaint}
                maxLength={MAX_USERNAME}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
              <Text style={styles.counter}>
                {trimmedName.length}/{MAX_USERNAME}
              </Text>
            </View>
          </View>

          {/* Bio */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Short bio  (optional)</Text>
            <View style={[styles.inputWrap, styles.bioWrap]}>
              <TextInput
                style={[styles.input, styles.bioInput]}
                value={bio}
                onChangeText={setBioLocal}
                placeholder="Tell the other monkes something about yourself…"
                placeholderTextColor={THEME.textFaint}
                maxLength={MAX_BIO}
                multiline
                returnKeyType="done"
                blurOnSubmit
              />
              <Text style={styles.counter}>
                {bio.trim().length}/{MAX_BIO}
              </Text>
            </View>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {/* Save button */}
          <Pressable
            style={({ pressed }) => [
              styles.saveBtn,
              pressed && styles.saveBtnPressed,
              !canSave && styles.saveBtnDisabled,
            ]}
            onPress={handleSave}
            disabled={!canSave}
          >
            <LinearGradient
              colors={
                canSave ? ["#9c7cff", "#7c5cfc"] : [THEME.surfaceHigh, THEME.surfaceHigh]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.saveGradient}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[styles.saveBtnText, !canSave && styles.saveBtnTextDisabled]}>
                  Enter the chat
                </Text>
              )}
            </LinearGradient>
          </Pressable>

          <Text style={styles.hint}>
            Minimum 2 characters · Max {MAX_USERNAME} characters
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 80,
    paddingBottom: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: THEME.accentSoft,
    borderWidth: 1,
    borderColor: THEME.accent + "66",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  iconInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlyph: { fontSize: 36 },
  title: {
    fontFamily: FONTS.display,
    fontSize: 28,
    color: THEME.text,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },

  fieldGroup: {
    alignSelf: "stretch",
    gap: 6,
  },
  label: {
    fontFamily: FONTS.bodyMed,
    fontSize: 12,
    color: THEME.textMuted,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  inputWrap: {
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bioWrap: {
    minHeight: 80,
  },
  input: {
    fontFamily: FONTS.body,
    fontSize: 15,
    color: THEME.text,
    padding: 0,
    margin: 0,
  },
  bioInput: {
    minHeight: 52,
    textAlignVertical: "top",
  },
  counter: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    alignSelf: "flex-end",
    marginTop: 4,
  },
  errorText: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.error,
    textAlign: "center",
  },

  saveBtn: {
    alignSelf: "stretch",
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: THEME.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
    marginTop: 4,
  },
  saveBtnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  saveBtnDisabled: { shadowOpacity: 0, elevation: 0 },
  saveGradient: {
    paddingVertical: 18,
    alignItems: "center",
  },
  saveBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 17,
    color: "#fff",
    letterSpacing: 0.3,
  },
  saveBtnTextDisabled: {
    color: THEME.textFaint,
  },

  hint: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textFaint,
    textAlign: "center",
  },
});
