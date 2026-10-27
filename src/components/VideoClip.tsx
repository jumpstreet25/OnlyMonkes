/**
 * VideoClip — native video (expo-video / ExoPlayer) for chat videos and the recording preview.
 *
 * 3.1: back from the WebView workaround (WebVideo, 2026-10-24) now that one media3 version is
 * pinned (android/app/build.gradle, 1.9.1). The 3.4 binary mixed 1.8.0 and 1.9.0 and crashed
 * in VideoPlayerLoadControl.getAllocator (Sentry 7698677171). Same props as WebVideo.
 */
import React from "react";
import { StyleProp, ViewStyle } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

interface Props {
  uri: string;
  style?: StyleProp<ViewStyle>;
  controls?: boolean;
  loop?: boolean;
  fit?: "contain" | "cover";
}

/** Only real media sources: remote https or a local file/content URI. */
function safeUri(uri: string): string | null {
  return /^(https:\/\/|file:\/\/|content:\/\/)/i.test(uri) ? uri : null;
}

export default function VideoClip({ uri, style, controls = true, loop = false, fit = "contain" }: Props) {
  const player = useVideoPlayer(safeUri(uri), (p) => {
    p.loop = loop;
    p.play();
  });
  return <VideoView player={player} style={style} nativeControls={controls} contentFit={fit} />;
}
