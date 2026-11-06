/**
 * Monke3DSnap — renders a monke in Monke3D (public/viewer/snap.html) in a
 * hidden WebView (phone; iframe on the web) and hands back one PNG as a
 * data: URI. MonkeMeme feeds that picture to the generator, so every meme
 * starts from the holder's own 3D monke. The page is the same model as the
 * Avatar Rooms and Monke 3D (monkeModel.js), loaded from onlymonkes.app, so
 * model fixes reach phones with a web deploy. OTA-safe: the WebView is in
 * the 3.4 binary.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { Platform, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

const SNAP_URL = Platform.OS === "web" ? "/viewer/snap" : "https://onlymonkes.app/viewer/snap";
const TIMEOUT_MS = 25_000;
const PNG_PREFIX = "data:image/png;base64,";

export function Monke3DSnap({ number, onSnap, onFail }: {
  number: number;
  onSnap: (png: string) => void;
  onFail: (reason: string) => void;
}) {
  const done = useRef(false);
  const cbs = useRef({ onSnap, onFail });
  cbs.current = { onSnap, onFail };
  const finish = useCallback((png: string | null, reason = "") => {
    if (done.current) return;
    done.current = true;
    if (png) cbs.current.onSnap(png);
    else cbs.current.onFail(reason);
  }, []);

  useEffect(() => {
    done.current = false;
    const id = setTimeout(() => finish(null, "timeout"), TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [number, finish]);

  const onMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    try {
      const d = JSON.parse(e.nativeEvent.data);
      if (d?.type === "snap" && d.n === number && typeof d.png === "string" && d.png.startsWith(PNG_PREFIX)) finish(d.png);
      else if (d?.type === "error") finish(null, String(d.message ?? "error").slice(0, 200));
    } catch { /* not ours */ }
  }, [number, finish]);

  const uri = `${SNAP_URL}?n=${number}`;
  return (
    <WebView
      key={number}
      source={{ uri }}
      style={styles.hidden}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(req: { url: string }) => req.url.split("?")[0] === SNAP_URL}
      onError={() => finish(null, "load error")}
      onHttpError={(ev: { nativeEvent?: { statusCode?: number } }) => finish(null, `http ${ev.nativeEvent?.statusCode ?? "?"}`)}
      javaScriptEnabled
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  // Tiny and invisible but laid out: the page renders to its own 512px canvas.
  hidden: { position: "absolute", top: 0, left: 0, width: 4, height: 4, opacity: 0 },
});
