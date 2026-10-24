/**
 * MonkeRoomStage — every Avatar Room member as a 3D monke in ONE scene
 * (public/viewer/room.html): one WebGL context however many people join,
 * where separate 3D tiles slow phones down past 3–4. Phone: the WebView in
 * the 3.4 binary (OTA-safe); web: the iframe shim.
 *
 * Only talking members move (face numbers, or mouth on voice level); muted or
 * quiet members hold still and an idle room stops redrawing.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { Platform, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { THEME } from "@/lib/constants";
import type { BlendshapeParams } from "@/lib/faceTracking";
import type { StageMember } from "@/lib/roomStage";

const STAGE_URL = Platform.OS === "web" ? "/viewer/room" : "https://onlymonkes.app/viewer/room";
const SEND_EVERY_MS = 80;

export interface MonkeRoomStageHandle {
  /** The local user's own face (their tracker's output isn't in the room state). */
  sendFace(id: string, params: BlendshapeParams): void;
}

export const MonkeRoomStage = forwardRef<MonkeRoomStageHandle, { members: StageMember[] }>(function MonkeRoomStage({ members }, ref) {
  const web = useRef<any>(null);
  const latest = useRef(members);
  latest.current = members;
  const lastSent = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const post = useCallback((msg: object) => web.current?.postMessage(JSON.stringify(msg)), []);
  const sendRoom = useCallback(() => {
    lastSent.current = Date.now();
    post({ type: "room", members: latest.current });
  }, [post]);

  // State changes arrive with every audio level / face packet: send at most every 80 ms.
  useEffect(() => {
    if (timer.current) return;
    const wait = Math.max(0, lastSent.current + SEND_EVERY_MS - Date.now());
    timer.current = setTimeout(() => { timer.current = null; sendRoom(); }, wait);
  }, [members, sendRoom]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useImperativeHandle(ref, () => ({
    sendFace: (id, params) => post({ type: "face", id, values: params.values, headRotation: params.headRotation }),
  }), [post]);

  const onMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    try {
      if (JSON.parse(e.nativeEvent.data)?.type === "ready") sendRoom();
    } catch { /* not ours */ }
  }, [sendRoom]);

  return (
    <WebView
      ref={web}
      source={{ uri: STAGE_URL }}
      style={styles.stage}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(req) => req.url.split("?")[0] === STAGE_URL}
      javaScriptEnabled
      scrollEnabled={false}
      overScrollMode="never"
    />
  );
});

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: THEME.bg },
});
