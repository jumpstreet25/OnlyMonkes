/**
 * sounds.ts — Premium audio feedback for OnlyMonkes.
 *
 * Uses expo-audio (expo-av is removed in SDK 55 — migrated 2026-07-22, see
 * OnlyMonkes 3.0 native stack plan) with bundled assets. Sounds are
 * lazy-loaded on first play, then cached.
 *
 * To add custom sounds: place .mp3 files in assets/sounds/
 * and update the SOUND_FILES map below.
 *
 * For now: uses Haptics as the primary feedback (sounds disabled
 * until .mp3 assets are added). The infrastructure is ready.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";

// Sound file mapping — uncomment and add paths when .mp3 files are available
// const SOUND_FILES = {
//   send: require("../../assets/sounds/send.mp3"),
//   receive: require("../../assets/sounds/receive.mp3"),
//   reaction: require("../../assets/sounds/reaction.mp3"),
//   purchase: require("../../assets/sounds/purchase.mp3"),
//   banana: require("../../assets/sounds/banana.mp3"),
// } as const;

type SoundName = "send" | "receive" | "reaction" | "purchase" | "banana" | "error";

const _cache = new Map<SoundName, AudioPlayer>();
let _enabled = true;
let _audioConfigured = false;

async function ensureAudioConfigured() {
  if (_audioConfigured) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: false,
      interruptionMode: "duckOthers",
      shouldPlayInBackground: false,
    });
    _audioConfigured = true;
  } catch { /* non-critical */ }
}

/**
 * Play a sound effect with haptic feedback.
 * Falls back to haptics-only when sound files aren't available.
 */
export async function playSound(name: SoundName): Promise<void> {
  if (!_enabled) return;

  // Haptic feedback (always fires, even without sound files)
  switch (name) {
    case "send":
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case "receive":
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
    case "reaction":
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
    case "purchase":
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case "banana":
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case "error":
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      break;
  }

  // Sound playback — enabled when .mp3 files are added to assets/sounds/
  // Uncomment below when SOUND_FILES are available:
  //
  // try {
  //   await ensureAudioConfigured();
  //   const file = SOUND_FILES[name as keyof typeof SOUND_FILES];
  //   if (!file) return;
  //
  //   let player = _cache.get(name);
  //   if (!player) {
  //     player = createAudioPlayer(file);
  //     _cache.set(name, player);
  //   }
  //
  //   await player.seekTo(0);
  //   player.play();
  // } catch { /* non-critical */ }
}

/** Enable/disable all sound effects. */
export function setSoundsEnabled(enabled: boolean) {
  _enabled = enabled;
}

/** Cleanup — call on app unmount. */
export async function unloadSounds() {
  for (const player of _cache.values()) {
    try { player.remove(); } catch { /* non-critical */ }
  }
  _cache.clear();
}
