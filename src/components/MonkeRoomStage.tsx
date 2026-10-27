/**
 * MonkeRoomStage — every Avatar Room member as a 3D monke in ONE scene
 * (public/viewer/room.html): one WebGL context however many people join,
 * where separate 3D tiles slow phones down past 3–4. Phone: the page is bundled
 * in the app (3.1, roomStageHtml.ts), hosted page as fallback; web: the iframe shim.
 *
 * Only talking members move (face numbers, or mouth on voice level); muted or
 * quiet members hold still and an idle room stops redrawing.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Platform, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { THEME } from "@/lib/constants";
import { bundledRoomStageHtml } from "@/lib/roomStageHtml";
import type { BlendshapeParams } from "@/lib/faceTracking";
import type { StageMember } from "@/lib/roomStage";

const STAGE_URL = Platform.OS === "web" ? "/viewer/room" : "https://onlymonkes.app/viewer/room";
/** Origin for the bundled page — resolves its "/viewer/monkeModel.js" import-map key; nothing loads from it. */
const BUNDLED_BASE = "https://onlymonkes.app/viewer/room";
const SEND_EVERY_MS = 80;
/** No "ready" from the page by then → the stage failed (no WebGL, page blocked, offline…). */
const READY_TIMEOUT_MS = 12_000;

export interface MonkeRoomStageHandle {
  /** The local user's own face (their tracker's output isn't in the room state). */
  sendFace(id: string, params: BlendshapeParams): void;
}

export const MonkeRoomStage = forwardRef<MonkeRoomStageHandle, { members: StageMember[]; onFail?: (reason: string) => void }>(function MonkeRoomStage({ members, onFail }, ref) {
  const web = useRef<any>(null);
  const latest = useRef(members);
  latest.current = members;
  const lastSent = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ready = useRef(false);
  const failed = useRef(false);
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;
  const fail = useCallback((reason: string) => {
    if (failed.current) return;
    failed.current = true;
    onFailRef.current?.(reason);
  }, []);
  useEffect(() => {
    const id = setTimeout(() => { if (!ready.current) fail("timeout: the 3D page never started"); }, READY_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [fail]);

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
      const d = JSON.parse(e.nativeEvent.data);
      if (d?.type === "ready") {
        ready.current = true;
        sendRoom();
      } else if (d?.type === "error") {
        // Page errors (a CDN script that didn't load, no WebGL…): fatal only before the page is ready.
        const reason = `page: ${String(d.message ?? "").slice(0, 300)}`;
        if (ready.current) console.warn("[MonkeRoomStage]", reason);
        else fail(reason);
      }
    } catch { /* not ours */ }
  }, [sendRoom, fail]);

  // 3.1: the stage ships inside the app (roomStageHtml.ts); the hosted page is the fallback.
  const [html, setHtml] = useState<string | null>(null);
  const [useHosted, setUseHosted] = useState(Platform.OS === "web");
  useEffect(() => {
    if (Platform.OS === "web") return;
    let live = true;
    bundledRoomStageHtml()
      .then((h) => { if (live) setHtml(h); })
      .catch((e) => { console.warn("[MonkeRoomStage] bundled stage failed, using hosted:", (e as Error)?.message); if (live) setUseHosted(true); });
    return () => { live = false; };
  }, []);
  if (!useHosted && !html) return null;

  return (
    <WebView
      ref={web}
      source={useHosted ? { uri: STAGE_URL } : { html: html!, baseUrl: BUNDLED_BASE }}
      style={styles.stage}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(req) => {
        const url = req.url.split("?")[0];
        return url === STAGE_URL || url === BUNDLED_BASE || url.startsWith("blob:") || url === "about:blank";
      }}
      onError={(e: any) => fail(`load: ${e?.nativeEvent?.description ?? "error"} (${e?.nativeEvent?.code ?? ""})`)}
      onHttpError={(e: any) => fail(`http ${e?.nativeEvent?.statusCode ?? "?"}`)}
      javaScriptEnabled
      scrollEnabled={false}
      overScrollMode="never"
    />
  );
});

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: THEME.bg },
});
