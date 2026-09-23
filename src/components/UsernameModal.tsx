/**
 * UsernameModal
 *
 * Shown on first entry OR when user taps their own PFP to edit profile.
 * Collects username (required), bio (optional), X account (optional).
 */

import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Keyboard,
  ActivityIndicator,
  ScrollView,
  Dimensions,
} from "react-native";
import { showGlassAlert } from "@/lib/glassAlert";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { toast } from "sonner-native";
import { useTranslation } from "react-i18next";
import { GlassModal } from "@/components/GlassModal";
import { THEME, FONTS } from "@/lib/constants";
import { saveUserProfile } from "@/lib/userProfile";
import { useAppStore } from "@/store/appStore";
import { shortenAddress } from "@/lib/nftVerification";

interface UsernameModalProps {
  visible: boolean;
  onDone: () => void;
  // Edit mode — pre-populate fields with current values
  initialUsername?: string;
  initialBio?: string;
  initialXAccount?: string;
  initialTipWallet?: string;
  initialLocation?: string;
  editMode?: boolean;
}

const MAX_USERNAME = 20;
const MAX_BIO = 100;
const MAX_X = 30;
const MAX_WALLET = 48;
const MAX_LOCATION = 50;

export function UsernameModal({
  visible,
  onDone,
  initialUsername = "",
  initialBio = "",
  initialXAccount = "",
  initialTipWallet = "",
  initialLocation = "",
  editMode = false,
}: UsernameModalProps) {
  const { t } = useTranslation();
  const { setUsername, setBio, setXAccount, setTipWallet, setLocation } = useAppStore();
  const [name, setName] = useState(initialUsername);
  const [bio, setBioLocal] = useState(initialBio);
  const [xAccount, setXAccountLocal] = useState(initialXAccount);
  const [tipWallet, setTipWalletLocal] = useState(initialTipWallet);
  const [location, setLocationLocal] = useState(initialLocation);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // windowSoftInputMode="adjustResize" doesn't reliably reposition content
  // under this app's edge-to-edge/immersive mode — same root cause already
  // found and fixed on Main Chat (ChatScreen.tsx) and DM (DmScreen.tsx),
  // where content rendered fully hidden behind the IME. KeyboardAvoidingView
  // relies on that same unreliable resize signal, so it doesn't help here
  // either — tracking real keyboard height directly and shrinking this
  // modal's card by it is the robust fix regardless of what adjustResize
  // does.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Re-populate when opened in edit mode
  useEffect(() => {
    if (visible) {
      setName(initialUsername);
      setBioLocal(initialBio);
      setXAccountLocal(initialXAccount);
      setTipWalletLocal(initialTipWallet);
      setLocationLocal(initialLocation);
      setError("");
    }
  }, [visible, initialUsername, initialBio, initialXAccount, initialTipWallet, initialLocation]);

  const trimmedName = name.trim();
  const canSave = trimmedName.length >= 2 && !saving;

  // Track if user has unsaved changes
  const isDirty = editMode && (
    name !== initialUsername ||
    bio !== initialBio ||
    xAccount !== initialXAccount ||
    tipWallet !== initialTipWallet ||
    location !== initialLocation
  );

  const handleClose = useCallback(() => {
    if (isDirty) {
      showGlassAlert(
        t("usernameModal.unsavedChangesTitle"),
        t("usernameModal.unsavedChangesBody"),
        [
          { text: t("usernameModal.keepEditing"), style: "cancel" },
          { text: t("usernameModal.discard"), style: "destructive", onPress: onDone },
        ]
      );
    } else {
      onDone();
    }
  }, [isDirty, onDone, t]);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    if (/[^a-zA-Z0-9_\-. ]/.test(trimmedName)) {
      setError(t("usernameModal.usernameCharsError"));
      return;
    }

    setSaving(true);
    setError("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const cleanX   = xAccount.trim().replace(/^@/, ""); // strip leading @
    const cleanTip = tipWallet.trim();
    const cleanLoc = location.trim();

    try {
      await saveUserProfile(trimmedName, bio.trim(), cleanX, cleanTip, cleanLoc);
      setUsername(trimmedName);
      setBio(bio.trim());
      setXAccount(cleanX);
      setTipWallet(cleanTip);
      setLocation(cleanLoc);
      // 2026-07-20: closing the Modal in the same tick as the toast mounting
      // races the Android Dialog window teardown — grey-screen freeze, same
      // bug class as BananaBetPopup.handlePlaceBet. Close first, let the
      // Modal's own dismissal clear, then toast.
      onDone();
      setTimeout(() => toast.success(t("usernameModal.profileUpdated")), 350);
    } catch {
      setError(t("usernameModal.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [canSave, trimmedName, bio, xAccount, tipWallet, location, setUsername, setBio, setXAccount, setTipWallet, setLocation, onDone, t]);

  return (
    <GlassModal visible={visible} onClose={handleClose} position="bottom" animationType="slide" cardStyle={{ height: Dimensions.get("window").height * 0.7 - keyboardHeight }}>
      <View style={styles.root}>
        <LinearGradient
          colors={["#7c5cfc18", "#0a0a1400", "#7c5cfc0a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Icon */}
          <View style={styles.iconWrap}>
            <View style={styles.iconInner}>
              <Text style={styles.iconGlyph}>🐒</Text>
            </View>
          </View>

          <Text style={styles.title}>
            {editMode ? t("usernameModal.editTitle") : t("usernameModal.createTitle")}
          </Text>
          <Text style={styles.subtitle}>
            {editMode
              ? t("usernameModal.editSubtitle")
              : t("usernameModal.createSubtitle")}
          </Text>

          {/* Username */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t("usernameModal.usernameLabel")}</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={(v) => { setName(v); setError(""); }}
                placeholder={t("usernameModal.usernamePlaceholder")}
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
            <Text style={styles.label}>{t("usernameModal.bioLabel")}</Text>
            <View style={[styles.inputWrap, styles.bioWrap]}>
              <TextInput
                style={[styles.input, styles.bioInput]}
                value={bio}
                onChangeText={setBioLocal}
                placeholder={t("usernameModal.bioPlaceholder")}
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

          {/* X account */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t("usernameModal.xAccountLabel")}</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={xAccount}
                onChangeText={setXAccountLocal}
                placeholder="@username"
                placeholderTextColor={THEME.textFaint}
                maxLength={MAX_X}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Tipping wallet */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t("usernameModal.tipWalletLabel")}</Text>
            <Text style={styles.fieldHint}>
              {t("usernameModal.tipWalletHint")}
            </Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={tipWallet}
                onChangeText={setTipWalletLocal}
                placeholder={t("usernameModal.tipWalletPlaceholder")}
                placeholderTextColor={THEME.textFaint}
                maxLength={MAX_WALLET}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
              {tipWallet.trim().length > 0 && (
                <Text style={styles.counter}>
                  {shortenAddress(tipWallet.trim())}
                </Text>
              )}
            </View>
          </View>

          {/* Location */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t("usernameModal.locationLabel")}</Text>
            <Text style={styles.fieldHint}>
              {t("usernameModal.locationHint")}
            </Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={location}
                onChangeText={setLocationLocal}
                placeholder={t("usernameModal.locationPlaceholder")}
                placeholderTextColor={THEME.textFaint}
                maxLength={MAX_LOCATION}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
              />
              {location.trim().length > 0 && (
                <Text style={styles.counter}>
                  {location.trim().length}/{MAX_LOCATION}
                </Text>
              )}
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
                  {editMode ? t("usernameModal.saveChanges") : t("usernameModal.enterChat")}
                </Text>
              )}
            </LinearGradient>
          </Pressable>

          {editMode && (
            <Pressable onPress={onDone} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>{t("usernameModal.cancel")}</Text>
            </Pressable>
          )}

          <Text style={styles.hint}>
            {t("usernameModal.hint", { max: MAX_USERNAME })}
          </Text>
        </ScrollView>
      </View>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 80,
    paddingBottom: 48,
    alignItems: "center",
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

  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  cancelBtnText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
  },

  hint: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textFaint,
    textAlign: "center",
  },
  fieldHint: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textFaint,
    marginBottom: 4,
  },
});
