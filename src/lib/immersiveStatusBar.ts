import { TurboModuleRegistry } from "react-native";

type EdgeToEdgeSpec = {
  onColorSchemeChange(): void;
  setStatusBarStyle(style: string): void;
  setNavigationBarStyle(style: string): void;
  setStatusBarHidden(hidden: boolean): void;
  setNavigationBarHidden(hidden: boolean): void;
};

/**
 * Match the 3.4 Seeker immersive shell on the 3.3 Saga APK.
 *
 * The 3.3 native binary opted out of edge-to-edge at build time, but Expo
 * still autolinks `RNEdgeToEdge`. Loading that module runs applyEdgeToEdge
 * (setDecorFitsSystemWindows false). Do NOT import react-native-edge-to-edge
 * itself — its spec uses getEnforcing and would crash if the module is
 * missing. TurboModuleRegistry.get is null-safe.
 */
export function enableImmersiveShell(): boolean {
  try {
    const mod = TurboModuleRegistry.get<EdgeToEdgeSpec>("RNEdgeToEdge");
    if (!mod) return false;
    // onColorSchemeChange is the JS-visible hook that runs applyEdgeToEdge
    // (setDecorFitsSystemWindows false). First get() may miss onHostResume.
    mod.onColorSchemeChange();
    mod.setStatusBarStyle("light-content");
    mod.setNavigationBarStyle("light-content");
    mod.setStatusBarHidden(true);
    mod.setNavigationBarHidden(true);
    return true;
  } catch {
    return false;
  }
}
