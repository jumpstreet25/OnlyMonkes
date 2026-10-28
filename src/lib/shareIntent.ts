/**
 * "Share to OnlyMonkes" (3.1, OmShare — ShareModule.kt): text, links and images shared from other
 * apps open Main Chat, text in the composer and an image in photo review. Nothing sends by itself.
 * No-op on a binary without the module (3.4).
 */
import { DeviceEventEmitter, NativeModules, Platform } from "react-native";
import { create } from "zustand";

export type SharedItem = { type: "text"; text: string } | { type: "image"; uri: string; text?: string };

const Share: { getInitialShare(): Promise<{ type: string; text?: string; uri?: string } | null> } | undefined =
  Platform.OS === "android" ? NativeModules.OmShare : undefined;

/** The share waiting for Main Chat to pick it up. */
export const usePendingShare = create<{ item: SharedItem | null; set: (i: SharedItem | null) => void }>((set) => ({
  item: null,
  set: (item) => set({ item }),
}));

/** Pure: native payload → a share Main Chat can use (http(s)/content/file images only). */
export function toSharedItem(p: { type?: string; text?: string; uri?: string } | null | undefined): SharedItem | null {
  if (!p) return null;
  if (p.type === "image" && typeof p.uri === "string" && /^(content|file):\/\//.test(p.uri)) {
    return { type: "image", uri: p.uri, text: p.text?.trim() || undefined };
  }
  if (p.type === "text" && typeof p.text === "string" && p.text.trim()) return { type: "text", text: p.text.trim().slice(0, 4000) };
  return null;
}

/** From the root layout: collect the cold-start share and later ones, then open Main Chat. */
export function startShareIntent(open: () => void): () => void {
  if (!Share) return () => {};
  const collect = () => {
    Share.getInitialShare().then((p) => {
      const item = toSharedItem(p);
      if (!item) return;
      usePendingShare.getState().set(item);
      open();
    }).catch(() => {});
  };
  collect();
  const sub = DeviceEventEmitter.addListener("shareReceived", collect);
  return () => sub.remove();
}
