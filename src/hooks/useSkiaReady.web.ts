import { useEffect, useState } from "react";
import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

// Web: Skia runs on CanvasKit (wasm), which must be loaded before any screen
// touches Skia — the chat screen builds RuntimeEffects at module load and
// crashed to a blank page without it (owner on a Seeker, 2026-10-21).
// canvaskit.wasm is copied into the site by scripts/web/deploy-site.sh.
let _ready = false;
// The wasm is served under a versioned name (canvaskit-<version>.wasm, copied
// by deploy-site.sh) so the site router can let browsers cache it for good.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CANVASKIT_VERSION: string = require("canvaskit-wasm/package.json").version;
const _load = LoadSkiaWeb({
  locateFile: (file: string) => (file === "canvaskit.wasm" ? `/canvaskit-${CANVASKIT_VERSION}.wasm` : `/${file}`),
})
  .then(() => { _ready = true; })
  .catch((e) => { console.error("[Skia] CanvasKit failed to load:", (e as Error)?.message); });

export function useSkiaReady(): boolean {
  const [ready, setReady] = useState(_ready);
  useEffect(() => {
    if (!ready) void _load.then(() => setReady(true));
  }, [ready]);
  return ready;
}
