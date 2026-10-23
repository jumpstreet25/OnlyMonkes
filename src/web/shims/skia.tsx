// Web stand-in for @shopify/react-native-skia: the real module, except that
// <Canvas> defaults to Skia's static web mode (draw, then release the WebGL
// context). On the web every Skia canvas otherwise holds its own WebGL
// context; menu icons + bubble styles + sparklines made 34 at login and
// Chrome keeps ~16, so contexts were lost and redrawn in a loop — the site
// froze on desktop login (owner, 2026-10-22). Every canvas the app draws on
// web is static (world backgrounds are paused there, see WorldLayer), so
// nothing needs a live context. Pass __destroyWebGLContextAfterRender={false}
// to keep one.
import React from "react";
import { Canvas as SkiaCanvas } from "@shopify/react-native-skia/lib/module/index";

export * from "@shopify/react-native-skia/lib/module/index";

type CanvasProps = React.ComponentProps<typeof SkiaCanvas> & { __destroyWebGLContextAfterRender?: boolean };

export const Canvas = React.forwardRef<unknown, CanvasProps>(function Canvas(props, ref) {
  return React.createElement(SkiaCanvas as React.ComponentType<any>, { __destroyWebGLContextAfterRender: true, ...props, ref });
});
