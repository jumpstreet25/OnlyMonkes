/**
 * WebVideo — plays a video inside a WebView (Chromium's own media stack).
 *
 * 2026-10-24: replaces expo-video on the published 3.4 binary. That APK links
 * media3 1.8.0 (expo-video) and 1.9.0 side by side, and expo-video's
 * VideoPlayerLoadControl crashes the app with AbstractMethodError
 * (LoadControl.getAllocator(PlayerId)) the moment ExoPlayer starts loading.
 * Native fix (one media3 version) belongs in the next APK; until then video
 * never touches ExoPlayer.
 */
import React, { useMemo } from "react";
import { StyleProp, ViewStyle } from "react-native";
import { WebView } from "react-native-webview";

interface Props {
  uri: string;
  style?: StyleProp<ViewStyle>;
  controls?: boolean;
  loop?: boolean;
  /** CSS object-fit: "contain" (default) or "cover". */
  fit?: "contain" | "cover";
}

/** Only real media sources: remote https or a local file/content URI. */
function safeUri(uri: string): string | null {
  return /^(https:\/\/|file:\/\/|content:\/\/)/i.test(uri) ? uri : null;
}

export default function WebVideo({ uri, style, controls = true, loop = false, fit = "contain" }: Props) {
  const src = safeUri(uri);
  const html = useMemo(() => {
    if (!src) return "";
    const attrs = ["autoplay", "playsinline", controls ? "controls" : "", loop ? "loop" : ""].filter(Boolean).join(" ");
    // src goes in via JSON.stringify + a DOM property, never into the markup.
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000}video{width:100%;height:100%;object-fit:${fit};background:#000}</style>
</head><body><video id="v" ${attrs}></video><script>
var v=document.getElementById("v");v.src=${JSON.stringify(src)};
var p=v.play();if(p&&p.catch)p.catch(function(){v.muted=true;v.play().catch(function(){});});
</script></body></html>`;
  }, [src, controls, loop, fit]);

  if (!src) return null;
  const local = !/^https:/i.test(src);
  return (
    <WebView
      style={[{ flex: 1, backgroundColor: "#000" }, style]}
      source={{ html, baseUrl: local ? "file:///" : "https://onlymonkes.app/" }}
      originWhitelist={["*"]}
      javaScriptEnabled
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      allowsFullscreenVideo
      allowFileAccess={local}
      allowFileAccessFromFileURLs={local}
      allowUniversalAccessFromFileURLs={local}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(req) => req.url === "about:blank" || req.url.startsWith("file:///") || req.url.startsWith("https://onlymonkes.app/") || req.url === src}
    />
  );
}
