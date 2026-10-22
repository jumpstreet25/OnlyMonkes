// Web stand-in for react-native-webview: an iframe. Supports `source.uri` /
// `source.html`, onLoadStart/onLoadEnd/onLoad and onMessage (window.postMessage
// from the frame). injectJavaScript posts the script text to the frame, which
// only same-origin pages that opt in can act on.
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type WebViewMessageEvent = { nativeEvent: { data: string } };

type Props = {
  source?: { uri?: string; html?: string };
  style?: any;
  onLoadStart?: () => void;
  onLoadEnd?: () => void;
  onLoad?: () => void;
  onMessage?: (e: WebViewMessageEvent) => void;
  onNavigationStateChange?: (s: { url: string; canGoBack: boolean; canGoForward: boolean; loading: boolean; title: string }) => void;
};

function flatten(style: any): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return typeof style === "object" ? style : {};
}

export const WebView = forwardRef(function WebView(props: Props & Record<string, unknown>, ref: React.Ref<unknown>) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const { source, style, onLoadStart, onLoadEnd, onLoad, onMessage, onNavigationStateChange } = props;

  useImperativeHandle(ref, () => ({
    injectJavaScript: (js: string) => frame.current?.contentWindow?.postMessage({ __omInject: js }, "*"),
    postMessage: (data: string) => frame.current?.contentWindow?.postMessage(data, "*"),
    reload: () => { if (frame.current) frame.current.src = frame.current.src; },
    goBack: () => {},
    goForward: () => {},
    stopLoading: () => {},
  }), []);

  useEffect(() => {
    if (!onMessage) return;
    const handler = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      onMessage({ nativeEvent: { data: typeof e.data === "string" ? e.data : JSON.stringify(e.data) } });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onMessage]);

  useEffect(() => { onLoadStart?.(); }, [source?.uri, source?.html]);

  return React.createElement("iframe", {
    ref: frame,
    src: source?.uri,
    srcDoc: source?.html,
    sandbox: "allow-scripts allow-same-origin allow-popups allow-forms",
    // Same-site pages (the 3D viewer's face tracking) may ask for the camera.
    allow: source?.uri?.startsWith("/") ? "camera" : undefined,
    referrerPolicy: "no-referrer",
    style: { border: 0, width: "100%", height: "100%", ...flatten(style) },
    onLoad: () => {
      onLoad?.();
      onLoadEnd?.();
      onNavigationStateChange?.({ url: source?.uri ?? "about:srcdoc", canGoBack: false, canGoForward: false, loading: false, title: "" });
    },
  });
});

export default WebView;
