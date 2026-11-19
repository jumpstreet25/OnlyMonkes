/**
 * OnboardingChecklist — Shown after first login.
 * Tracks profile setup progress and guides users to explore features.
 * Dismissable and auto-hides once all tasks complete.
 */

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { THEME, FONTS } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";

const AK_ONBOARDING = "om_onboarding_v1";

interface OnboardingState {
  dismissed: boolean;
  sentMessage: boolean;
  reactedToMessage: boolean;
  openedGlobe: boolean;
}

const DEFAULT: OnboardingState = {
  dismissed: false,
  sentMessage: false,
  reactedToMessage: false,
  openedGlobe: false,
};

let _state: OnboardingState = { ...DEFAULT };
let _loaded: Promise<OnboardingState> | null = null;
const _listeners = new Set<(s: OnboardingState) => void>();

export function loadOnboarding(): Promise<OnboardingState> {
  if (!_loaded) {
    _loaded = (async () => {
      try {
        const raw = await AsyncStorage.getItem(AK_ONBOARDING);
        if (raw) _state = { ...DEFAULT, ...JSON.parse(raw) };
      } catch { /* ignore */ }
      return _state;
    })();
  }
  return _loaded;
}

function notify() {
  const snap = { ..._state };
  _listeners.forEach(l => l(snap));
}

async function save() {
  try {
    await AsyncStorage.setItem(AK_ONBOARDING, JSON.stringify(_state));
  } catch { /* ignore */ }
}

export async function markOnboardingStep(step: keyof Omit<OnboardingState, "dismissed">) {
  await loadOnboarding(); // a step marked before the load finished would be overwritten by it
  if (_state[step]) return; // already done
  _state[step] = true;
  notify();
  await save();
}

/** Hide the checklist for good — e.g. a returning holder whose profile the bot restored. */
export async function dismissOnboarding() {
  await loadOnboarding();
  if (_state.dismissed) return;
  _state.dismissed = true;
  notify();
  await save();
}

export function OnboardingChecklist() {
  const username = useAppStore(s => s.username);
  const bio = useAppStore(s => s.bio);
  const location = useAppStore(s => s.location);
  const [state, setState] = useState<OnboardingState>(_state);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Steps are marked from other screens while this card is mounted — follow them live.
    const onChange = (s: OnboardingState) => { setState(s); setVisible(!s.dismissed); };
    _listeners.add(onChange);
    loadOnboarding().then(s => onChange({ ...s }));
    return () => { _listeners.delete(onChange); };
  }, []);

  if (!visible) return null;

  const tasks = [
    { label: "Set username", done: !!username && username.length >= 2 },
    { label: "Add a bio", done: !!bio && bio.length > 0 },
    { label: "Set your location", done: !!location && location.length > 0 },
    { label: "Send a message", done: state.sentMessage },
    { label: "React to a message", done: state.reactedToMessage },
    { label: "Open the Globe", done: state.openedGlobe },
  ];

  const completed = tasks.filter(t => t.done).length;
  const total = tasks.length;

  // Auto-hide when all done
  if (completed === total) return null;

  const handleDismiss = () => { void dismissOnboarding(); };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Welcome to OnlyMonkes</Text>
        <Pressable onPress={handleDismiss} hitSlop={8}>
          <Text style={styles.dismiss}>Dismiss</Text>
        </Pressable>
      </View>
      <Text style={styles.progress}>{completed}/{total} completed</Text>

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${(completed / total) * 100}%` }]} />
      </View>

      <View style={styles.taskList}>
        {tasks.map(t => (
          <View key={t.label} style={styles.taskRow}>
            <Text style={[styles.taskCheck, t.done && styles.taskCheckDone]}>
              {t.done ? "✓" : "○"}
            </Text>
            <Text style={[styles.taskLabel, t.done && styles.taskLabelDone]}>
              {t.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12, marginTop: 8, marginBottom: 4,
    backgroundColor: "rgba(124,58,237,0.08)", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "rgba(124,58,237,0.15)",
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontFamily: FONTS.display, fontSize: 15, color: THEME.text },
  dismiss: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted },
  progress: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted, marginTop: 4 },
  progressBar: {
    height: 4, borderRadius: 2, backgroundColor: THEME.border, marginTop: 8, marginBottom: 10,
  },
  progressFill: {
    height: 4, borderRadius: 2, backgroundColor: "#7C3AED",
  },
  taskList: { gap: 6 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  taskCheck: { fontFamily: FONTS.mono, fontSize: 14, color: THEME.textMuted, width: 18 },
  taskCheckDone: { color: THEME.success },
  taskLabel: { fontFamily: FONTS.body, fontSize: 13, color: THEME.text },
  taskLabelDone: { color: THEME.textMuted, textDecorationLine: "line-through" },
});
