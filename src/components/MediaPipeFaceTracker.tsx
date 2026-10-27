/**
 * MediaPipe face tracking for the Avatar Room (3.1) — the same FaceLandmarker the web viewer
 * runs (web-app public/viewer/phonecam.js startFaceTracking): real blendshape scores + head
 * rotation instead of ML Kit's contour estimate (FaceTracker.tsx). Runs in a hidden WebView
 * with an https origin (secure context for getUserMedia); the WebView is granted the camera
 * the app already holds. Same props as FaceTracker; onFail lets the room fall back to it.
 * Open source end to end (Apache-2.0 MediaPipe, served from jsDelivr / Google's model bucket).
 */
import React, { useCallback, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useCameraPermission } from "react-native-vision-camera";
import { BLENDSHAPE_IDLE, BLENDSHAPE_NAMES, type BlendshapeParams } from "@/lib/faceTracking";

const TASKS = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
/** No first face in this long → the room falls back to ML Kit. */
const FIRST_FACE_TIMEOUT_MS = 20_000;

const HTML = `<!doctype html><html><body style="margin:0;background:#000">
<video id="v" playsinline muted style="width:1px;height:1px"></video>
<script type="module">
const post = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
try {
  const vision = await import("${TASKS}/vision_bundle.mjs");
  const files = await vision.FilesetResolver.forVisionTasks("${TASKS}/wasm");
  const make = (delegate) => vision.FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: "${MODEL}", delegate },
    runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
  });
  let lm;
  try { lm = await make("GPU"); } catch { lm = await make("CPU"); }
  const video = document.getElementById("v");
  video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 320, height: 240 }, audio: false });
  await video.play();
  const DEG = 180 / Math.PI;
  let last = 0;
  const tick = (now) => {
    requestAnimationFrame(tick);
    if (now - last < 66 || video.readyState < 2) return;
    last = now;
    const res = lm.detectForVideo(video, now);
    const cats = res?.faceBlendshapes?.[0]?.categories;
    if (!cats) return;
    const v = {};
    for (const c of cats) v[c.categoryName] = Math.round(c.score * 1000) / 1000;
    const m = res.facialTransformationMatrixes?.[0]?.data;
    const r = (row, col) => m[col * 4 + row];
    const rot = m ? { x: Math.atan2(r(2, 1), r(2, 2)) * DEG, y: Math.asin(Math.max(-1, Math.min(1, -r(2, 0)))) * DEG, z: Math.atan2(r(1, 0), r(0, 0)) * DEG } : null;
    post({ t: "face", v, r: rot });
  };
  requestAnimationFrame(tick);
  post({ t: "ready" });
} catch (e) {
  post({ t: "error", m: String(e && (e.name || e.message) || e) });
}
</script></body></html>`;

interface Props {
  enabled: boolean;
  onBlendshapes: (params: BlendshapeParams) => void;
  /** MediaPipe couldn't start (no WebGL/WASM, camera refused, offline, no face in 20 s). */
  onFail: (reason: string) => void;
}

export const MediaPipeFaceTracker = React.memo(function MediaPipeFaceTracker({ enabled, onBlendshapes, onFail }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const gotFace = useRef(false);
  const failed = useRef(false);

  const fail = useCallback((why: string) => {
    if (failed.current) return;
    failed.current = true;
    onFail(why);
  }, [onFail]);

  useEffect(() => {
    if (enabled && !hasPermission) requestPermission();
  }, [enabled, hasPermission, requestPermission]);

  useEffect(() => {
    if (!enabled || !hasPermission) return;
    gotFace.current = false;
    const t = setTimeout(() => { if (!gotFace.current) fail("no face from MediaPipe in 20s"); }, FIRST_FACE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [enabled, hasPermission, fail]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let m: { t?: string; v?: Record<string, number>; r?: { x: number; y: number; z: number } | null; m?: string };
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.t === "error") return fail(m.m ?? "MediaPipe failed");
    if (m.t !== "face" || !m.v) return;
    gotFace.current = true;
    const values = { ...BLENDSHAPE_IDLE.values };
    for (const name of BLENDSHAPE_NAMES) {
      const x = m.v[name];
      if (typeof x === "number" && Number.isFinite(x)) values[name] = Math.min(1, Math.max(0, x));
    }
    onBlendshapes({ values, headRotation: m.r ?? BLENDSHAPE_IDLE.headRotation });
  }, [fail, onBlendshapes]);

  if (!enabled || !hasPermission) return null;
  return (
    <View style={styles.hidden} pointerEvents="none">
      {/* react-native-webview 14 types default P to undefined (props & undefined = never) */}
      <WebView<{}>
        source={{ html: HTML, baseUrl: "https://onlymonkes.app/" }}
        originWhitelist={["https://*"]}
        javaScriptEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        mediaCapturePermissionGrantType="grant"
        onMessage={onMessage}
        onError={() => fail("tracker page failed to load")}
        style={styles.web}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  hidden: { position: "absolute", width: 2, height: 2, opacity: 0.01, top: 0, left: 0, overflow: "hidden" },
  web: { width: 2, height: 2, backgroundColor: "transparent" },
});
