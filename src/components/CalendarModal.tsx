/**
 * CalendarModal
 *
 * Form to create a new community event.
 * Saves locally and broadcasts via XMTP EVENT: message.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { THEME, FONTS } from "@/lib/constants";
import { saveEvent, buildEventMessage } from "@/lib/calendar";
import { useAppStore, type CalendarEvent } from "@/store/appStore";

interface CalendarModalProps {
  visible: boolean;
  onClose: () => void;
  onBroadcast: (eventJson: string) => Promise<void>;
}

export function CalendarModal({ visible, onClose, onBroadcast }: CalendarModalProps) {
  const { myInboxId, username } = useAppStore();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [purpose, setPurpose] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave = title.trim().length >= 2 && date.trim().length >= 5 && !saving;

  const reset = () => {
    setTitle(""); setDate(""); setTime("");
    setLocation(""); setPurpose(""); setSaving(false);
  };

  const handleCreate = async () => {
    if (!canSave) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);

    const event: CalendarEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: title.trim(),
      date: date.trim(),
      time: time.trim(),
      location: location.trim(),
      purpose: purpose.trim(),
      creatorInboxId: myInboxId ?? "",
      creatorUsername: username ?? undefined,
    };

    try {
      await saveEvent(event);
      useAppStore.getState().addCalendarEvent(event);
      await onBroadcast(JSON.stringify(event));
      reset();
      onClose();
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Could not create event.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      onRequestClose={() => { reset(); onClose(); }}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <LinearGradient
          colors={["#7c5cfc12", "#0a0a1400"]}
          style={StyleSheet.absoluteFill}
        />

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>📅  Create Event</Text>
          <Pressable onPress={() => { reset(); onClose(); }} style={styles.closeBtn} hitSlop={8}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Field label="Event Title *" value={title} onChange={setTitle} placeholder="Monkes meetup…" />
          <Field label="Date  (MM/DD/YYYY) *" value={date} onChange={setDate} placeholder="12/25/2025" keyboardType="numeric" />
          <Field label="Time  (HH:MM)" value={time} onChange={setTime} placeholder="18:00" keyboardType="numeric" />
          <Field label="Location" value={location} onChange={setLocation} placeholder="Discord Stage, Twitter Space…" />
          <Field label="Purpose / Description" value={purpose} onChange={setPurpose} placeholder="What is this event about?" multiline />

          <Pressable
            style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
            onPress={handleCreate}
            disabled={!canSave}
          >
            <LinearGradient
              colors={canSave ? ["#9c7cff", "#7c5cfc"] : [THEME.surfaceHigh, THEME.surfaceHigh]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.saveGradient}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[styles.saveText, !canSave && { color: THEME.textFaint }]}>
                  Create & Broadcast
                </Text>
              )}
            </LinearGradient>
          </Pressable>

          <Text style={styles.hint}>
            Event will be shared with all chat members via XMTP.
          </Text>

          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label, value, onChange, placeholder, keyboardType, multiline,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; keyboardType?: any; multiline?: boolean;
}) {
  return (
    <View style={fieldStyles.group}>
      <Text style={fieldStyles.label}>{label}</Text>
      <View style={[fieldStyles.inputWrap, multiline && fieldStyles.multiWrap]}>
        <TextInput
          style={[fieldStyles.input, multiline && fieldStyles.multiInput]}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={THEME.textFaint}
          keyboardType={keyboardType ?? "default"}
          multiline={multiline}
          returnKeyType={multiline ? "default" : "next"}
          blurOnSubmit={!multiline}
        />
      </View>
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  group: { gap: 6 },
  label: {
    fontFamily: FONTS.bodyMed,
    fontSize: 11,
    color: THEME.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  inputWrap: {
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multiWrap: { minHeight: 80 },
  input: {
    fontFamily: FONTS.body,
    fontSize: 15,
    color: THEME.text,
    padding: 0,
    margin: 0,
  },
  multiInput: {
    minHeight: 56,
    textAlignVertical: "top",
  },
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  headerTitle: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: THEME.text,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: THEME.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: {
    fontSize: 14,
    color: THEME.textMuted,
  },
  content: {
    padding: 24,
    gap: 18,
  },
  saveBtn: {
    borderRadius: 14,
    overflow: "hidden",
    marginTop: 8,
    elevation: 8,
    shadowColor: THEME.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  saveBtnDisabled: { elevation: 0, shadowOpacity: 0 },
  saveGradient: {
    paddingVertical: 17,
    alignItems: "center",
  },
  saveText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 16,
    color: "#fff",
  },
  hint: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textFaint,
    textAlign: "center",
  },
});
