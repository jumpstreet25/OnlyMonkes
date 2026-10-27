/**
 * Picture-in-picture for Avatar / Video Rooms (3.1 native module OmPip — PipModule.kt).
 * No-op on a binary without it (3.4), so room screens can call it unconditionally.
 */
import { useEffect, useState } from "react";
import { DeviceEventEmitter, NativeModules, Platform } from "react-native";

const Pip: { setRoomActive(active: boolean): void; enter(): Promise<boolean> } | undefined =
  Platform.OS === "android" ? NativeModules.OmPip : undefined;

export function enterPictureInPicture(): Promise<boolean> {
  return Pip ? Pip.enter() : Promise.resolve(false);
}

/** While `active`, leaving the app floats the room instead of closing it. Returns whether we're in PiP now. */
export function usePictureInPicture(active: boolean): boolean {
  const [inPip, setInPip] = useState(false);
  useEffect(() => {
    if (!Pip) return;
    Pip.setRoomActive(active);
    return () => Pip.setRoomActive(false);
  }, [active]);
  useEffect(() => {
    if (!Pip) return;
    const sub = DeviceEventEmitter.addListener("pipModeChanged", (v: boolean) => setInPip(!!v));
    return () => sub.remove();
  }, []);
  return inPip;
}
