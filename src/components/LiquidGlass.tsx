/**
 * LiquidGlass — drop-in replacement for native BlurView across the whole
 * app (2026-08-23).
 *
 * Both blur libraries this app used — expo-blur's Android path AND
 * @sbaiahmed1/react-native-blur — wrap the same lineage of native code
 * (`eightbitlab.com.blurview.PreDrawBlurController`, aka Dimezis/BlurView;
 * @sbaiahmed1 pulls it in under a fork, `com.github.qmdeve:qmblurview`,
 * that kept the same package name). That controller manually re-invokes
 * `draw()` on its target view from a `ViewTreeObserver.OnPreDrawListener`
 * to snapshot it — and if the target's child list is mutated mid-draw
 * (exactly what a react-native-screens Fragment transition does while a
 * screen pushes/pops), `ViewGroup.dispatchDraw`'s cached "preordered
 * children" index array goes stale and throws
 * `IndexOutOfBoundsException`, taking the whole app down. Confirmed via
 * live crash trace 2026-08-23 (DM → back to Main Chat) after THREE prior
 * "defer the mount by N ms" attempts (2026-08-19, 2026-08-22 x2) still
 * didn't close it — timing-based guards can't fully rule out a race with
 * a native Fragment transition. No config flag or algorithm swap
 * (RenderEffectBlur vs RenderScriptBlur) avoids this — the crash is in
 * the shared controller, not the blur backend.
 *
 * This sidesteps the entire crash class by never touching that native
 * code path: a translucent gradient scrim standing in for the "frost"
 * BlurView used to provide. Each call site's own tint View/World-color
 * wash/highlight/border (already layered on top of BlurView everywhere
 * it's used) is untouched — only the risky sampling layer is replaced.
 * Real per-pixel blur is gone; the layered color system built around it
 * is not.
 */
import React from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle, type ViewProps } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

interface LiquidGlassProps {
  style?: StyleProp<ViewStyle>;
  pointerEvents?: ViewProps["pointerEvents"];
  // Old BlurView call sites spread getBlurProps()/getPanelBlurProps()
  // (intensity/tint/experimentalBlurMethod) onto this component — accepted
  // and ignored rather than requiring every call site to be edited.
  [key: string]: unknown;
}

export function LiquidGlass({ style, pointerEvents = "none", ...rest }: LiquidGlassProps) {
  void rest;
  return (
    <View style={[style, styles.clip]} pointerEvents={pointerEvents}>
      <LinearGradient
        colors={["rgba(8, 10, 18, 0.60)", "rgba(8, 10, 18, 0.42)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Respects border-radius overrides callers pass in `style` (several
  // panels round their BlurView's corners) by clipping the gradient to it.
  clip: { overflow: "hidden" },
});
