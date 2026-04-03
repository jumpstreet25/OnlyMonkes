/**
 * sounds.ts — Premium audio feedback for OnlyMonkes.
 *
 * Uses expo-av Audio.Sound with bundled assets.
 * Sounds are lazy-loaded on first play, then cached.
 *
 * To add custom sounds: place .mp3 files in assets/sounds/
 * and update the SOUND_FILES map below.
 *
 * For now: uses Haptics as the primary feedback (sounds disabled
 * until .mp3 assets are added). The infrastructure is ready.
 */

import { Audio } from "expo-av";
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

const _cache = new Map<SoundName, Audio.Sound>();
let _enabled = true;
let _audioConfigured = false;

async function ensureAudioConfigured() {
  if (_audioConfigured) return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: false,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
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
  //   let sound = _cache.get(name);
  //   if (!sound) {
  //     const { sound: s } = await Audio.Sound.createAsync(file, { shouldPlay: false });
  //     sound = s;
  //     _cache.set(name, sound);
  //   }
  //
  //   await sound.setPositionAsync(0);
  //   await sound.playAsync();
  // } catch { /* non-critical */ }
}

/** Enable/disable all sound effects. */
export function setSoundsEnabled(enabled: boolean) {
  _enabled = enabled;
}

/** Cleanup — call on app unmount. */
export async function unloadSounds() {
  for (const sound of _cache.values()) {
    await sound.unloadAsync().catch(() => {});
  }
  _cache.clear();
}
