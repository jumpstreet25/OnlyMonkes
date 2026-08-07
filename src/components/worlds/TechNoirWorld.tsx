/**
 * TechNoirWorld — street-level immersive post-rain night city (Main Chat plate).
 *
 * Photoreal plate (assets/tech-noir-street.jpg):
 *   - Eye-level looking down a wet avenue
 *   - Skyscrapers left/right, vanishing-point center tower
 *   - Large glowing Saga Monke billboard on the center skyscraper (upper third
 *     so it clears the densest chat bubble stack on Main Chat)
 *   - Wet asphalt with neon light glare (rain has stopped)
 *
 * Framing is top-pinned cover so the monke logo stays under the chat header
 * and the wet road fills the lower half behind messages / input chrome.
 */

import React, { useEffect, useMemo } from "react";
import { View, StyleSheet, Dimensions, Image as RNImage } from "react-native";
import {
  Canvas,
  Rect,
  LinearGradient,
  RadialGradient,
  vec,
  Group,
  BlurMask,
} from "@shopify/react-native-skia";
import {
  useSharedValue,
  useDerivedValue,
  withRepeat,
  withTiming,
  withSequence,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// Plate is 9:16 (720×1280) — top-pin cover framing (see plateLayout).
const PLATE_ASPECT = 720 / 1280; // w/h
const STREET_PLATE = require("../../../assets/tech-noir-street.jpg");

interface TechNoirWorldProps {
  active?: boolean;
}

/** Top-pinned cover: scale to fill the screen, pin the TOP of the plate so
 *  the monke billboard (upper third of the art) sits under the chat header
 *  instead of being center-cropped away or buried mid-list. */
function plateLayout() {
  // Width-first scale, then grow if still short of screen height
  let w = SCREEN_W;
  let h = w / PLATE_ASPECT;
  if (h < SCREEN_H) {
    h = SCREEN_H;
    w = h * PLATE_ASPECT;
  }
  // Center horizontally if wider than screen; always pin top
  const left = (SCREEN_W - w) / 2;
  const top = 0;
  return { w, h, left, top };
}

export function TechNoirWorld({ active = true }: TechNoirWorldProps) {
  const layout = useMemo(() => plateLayout(), []);

  const pulse = useSharedValue(0.55);
  const sheen = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(pulse);
      cancelAnimation(sheen);
      pulse.value = 0.55;
      sheen.value = 0;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.5, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    sheen.value = withRepeat(
      withTiming(1, { duration: 10000, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(pulse);
      cancelAnimation(sheen);
    };
  }, [active, pulse, sheen]);

  // Wet road is the lower ~55% of the plate — sheen glides across that band
  const streetTop = SCREEN_H * 0.42;
  const streetH = SCREEN_H - streetTop;
  const sheenW = SCREEN_W * 0.5;
  const sheenTransform = useDerivedValue(
    () => [{ translateX: sheen.value * (SCREEN_W + sheenW) - sheenW }],
    [sheen],
  );

  return (
    <View style={styles.root} pointerEvents="none">
      <RNImage
        source={STREET_PLATE}
        style={{
          position: "absolute",
          width: layout.w,
          height: layout.h,
          left: layout.left,
          top: layout.top,
        }}
        resizeMode="stretch"
      />

      <Canvas style={StyleSheet.absoluteFill}>
        {/* Light top fade under header only — keep monke logo readable */}
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H * 0.12}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, SCREEN_H * 0.12)}
            colors={["rgba(0,0,0,0.35)", "rgba(0,0,0,0)"]}
          />
        </Rect>

        {/* Soft side tunnel vignette */}
        <Rect x={0} y={0} width={SCREEN_W * 0.10} height={SCREEN_H}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(SCREEN_W * 0.10, 0)}
            colors={["rgba(0,0,0,0.4)", "rgba(0,0,0,0)"]}
          />
        </Rect>
        <Rect x={SCREEN_W * 0.90} y={0} width={SCREEN_W * 0.10} height={SCREEN_H}>
          <LinearGradient
            start={vec(SCREEN_W, 0)}
            end={vec(SCREEN_W * 0.90, 0)}
            colors={["rgba(0,0,0,0.4)", "rgba(0,0,0,0)"]}
          />
        </Rect>

        {/* Billboard glow pulse — monke sits ~12–28% down the frame */}
        <Group opacity={pulse}>
          <Rect x={SCREEN_W * 0.22} y={SCREEN_H * 0.06} width={SCREEN_W * 0.56} height={SCREEN_H * 0.28}>
            <RadialGradient
              c={vec(SCREEN_W * 0.5, SCREEN_H * 0.16)}
              r={SCREEN_W * 0.32}
              colors={[
                "rgba(79, 216, 255, 0.28)",
                "rgba(79, 216, 255, 0.08)",
                "rgba(79, 216, 255, 0)",
              ]}
            />
          </Rect>
          <Rect
            x={SCREEN_W * 0.30}
            y={SCREEN_H * 0.08}
            width={SCREEN_W * 0.40}
            height={SCREEN_H * 0.18}
            color="rgba(79, 216, 255, 0.10)"
          >
            <BlurMask blur={32} style="normal" />
          </Rect>
        </Group>

        {/* Wet-street specular sheen */}
        <Group transform={sheenTransform} opacity={0.22}>
          <Rect x={0} y={streetTop} width={sheenW} height={streetH}>
            <LinearGradient
              start={vec(0, streetTop)}
              end={vec(sheenW, streetTop)}
              colors={[
                "rgba(79, 216, 255, 0)",
                "rgba(200, 240, 255, 0.75)",
                "rgba(79, 216, 255, 0)",
              ]}
            />
          </Rect>
        </Group>

        {/* Bottom contact under input bar */}
        <Rect x={0} y={SCREEN_H * 0.86} width={SCREEN_W} height={SCREEN_H * 0.14}>
          <LinearGradient
            start={vec(0, SCREEN_H * 0.86)}
            end={vec(0, SCREEN_H)}
            colors={["rgba(0,0,0,0)", "rgba(1,4,12,0.5)"]}
          />
        </Rect>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#010206",
    overflow: "hidden",
  },
});
