/**
 * DeepSpaceWorld — NFT-style deep space plate with 3D OnlyMonkes logo planet.
 *
 * Plate (assets/deep-space-plate.jpg):
 *   - Near-black indigo void + violet nebulae
 *   - Hero: 3D monke-logo planet (Solana light-blue oceans, light-purple land)
 *   - Planet sits upper third so it clears dense chat bubbles
 *
 * Light Skia overlays only (match Tech Noir / Trading Floor craft):
 *   - Top/bottom vignettes for chrome readability
 *   - Soft pulse on the planet glow
 *   - Rare shooting star
 */

import React, { useEffect, useMemo } from "react";
import { View, StyleSheet, Dimensions, Image as RNImage } from "react-native";
import {
  Canvas,
  Rect,
  LinearGradient,
  RadialGradient,
  vec,
  Path,
  Group,
  BlurMask,
  Circle,
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

// Plate is 9:16 (720×1280) — top-pin cover framing (same as Tech Noir).
const PLATE_ASPECT = 720 / 1280;
const SPACE_PLATE = require("../../../assets/deep-space-plate.jpg");

interface DeepSpaceWorldProps {
  active?: boolean;
}

function plateLayout() {
  let w = SCREEN_W;
  let h = w / PLATE_ASPECT;
  if (h < SCREEN_H) {
    h = SCREEN_H;
    w = h * PLATE_ASPECT;
  }
  const left = (SCREEN_W - w) / 2;
  const top = 0;
  return { w, h, left, top };
}

function buildShotPath(len: number): string {
  const angle = 0.28;
  const ex = Math.cos(angle) * len;
  const ey = Math.sin(angle) * len;
  return `M0 0 L${ex} ${ey}`;
}

function ShootingStar({ active }: { active: boolean }) {
  const alpha = useSharedValue(0);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const shotPath = useMemo(() => buildShotPath(140), []);

  useEffect(() => {
    if (!active) {
      cancelAnimation(alpha);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      return;
    }

    let alive = true;
    const fire = () => {
      if (!alive) return;
      const delay = 22_000 + Math.random() * 18_000;
      setTimeout(() => {
        if (!alive) return;
        const startX = Math.random() * SCREEN_W * 0.55;
        const startY = Math.random() * SCREEN_H * 0.22;
        const travelX = 90 + Math.random() * 110;
        const travelY = 28 + Math.random() * 45;
        const dur = 550 + Math.random() * 280;

        translateX.value = startX;
        translateY.value = startY;
        alpha.value = withSequence(
          withTiming(1, { duration: 50 }),
          withTiming(0, { duration: dur }),
        );
        translateX.value = withTiming(startX + travelX, {
          duration: dur + 50,
          easing: Easing.out(Easing.quad),
        });
        translateY.value = withTiming(startY + travelY, {
          duration: dur + 50,
          easing: Easing.out(Easing.quad),
        });
        setTimeout(fire, dur + 200);
      }, delay);
    };
    fire();
    return () => {
      alive = false;
      cancelAnimation(alpha);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
    };
  }, [active, alpha, translateX, translateY]);

  const transform = useDerivedValue(
    () => [{ translateX: translateX.value }, { translateY: translateY.value }],
    [translateX, translateY],
  );

  return (
    <Group opacity={alpha} transform={transform}>
      <Circle cx={0} cy={0} r={2.2} color="#FFFFFF">
        <BlurMask blur={4} style="normal" />
      </Circle>
      <Path path={shotPath} style="stroke" strokeWidth={1.4} color="#C8DEFF">
        <LinearGradient
          start={vec(0, 0)}
          end={vec(140, 40)}
          colors={["rgba(255,255,255,0.85)", "rgba(155,112,255,0)"]}
        />
      </Path>
    </Group>
  );
}

export function DeepSpaceWorld({ active = true }: DeepSpaceWorldProps) {
  const layout = useMemo(() => plateLayout(), []);

  const pulse = useSharedValue(0.5);

  useEffect(() => {
    if (!active) {
      cancelAnimation(pulse);
      pulse.value = 0.5;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.45, { duration: 3600, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [active, pulse]);

  // Offset upper-right so monke stays visible when Main Chat images sit center
  const planetCx = SCREEN_W * 0.62;
  const planetCy = SCREEN_H * 0.26;
  const planetR = SCREEN_W * 0.34;

  return (
    <View style={styles.root} pointerEvents="none">
      <RNImage
        source={SPACE_PLATE}
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
        {/* Soft top fade under header */}
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H * 0.10}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, SCREEN_H * 0.10)}
            colors={["rgba(0,0,0,0.40)", "rgba(0,0,0,0)"]}
          />
        </Rect>

        {/* Side vignettes */}
        <Rect x={0} y={0} width={SCREEN_W * 0.08} height={SCREEN_H}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(SCREEN_W * 0.08, 0)}
            colors={["rgba(0,0,0,0.35)", "rgba(0,0,0,0)"]}
          />
        </Rect>
        <Rect x={SCREEN_W * 0.92} y={0} width={SCREEN_W * 0.08} height={SCREEN_H}>
          <LinearGradient
            start={vec(SCREEN_W, 0)}
            end={vec(SCREEN_W * 0.92, 0)}
            colors={["rgba(0,0,0,0.35)", "rgba(0,0,0,0)"]}
          />
        </Rect>

        {/* Planet aura pulse — reads under monke globe without washing it out */}
        <Group opacity={pulse}>
          <Circle cx={planetCx} cy={planetCy} r={planetR}>
            <RadialGradient
              c={vec(planetCx, planetCy)}
              r={planetR}
              colors={[
                "rgba(155, 112, 255, 0.22)",
                "rgba(125, 211, 252, 0.08)",
                "rgba(155, 112, 255, 0)",
              ]}
            />
          </Circle>
          <Circle
            cx={planetCx}
            cy={planetCy}
            r={planetR * 0.55}
            color="rgba(155, 112, 255, 0.10)"
          >
            <BlurMask blur={28} style="normal" />
          </Circle>
        </Group>

        {/* Rare shooting star */}
        <ShootingStar active={active} />

        {/* Bottom contact under input — darker for bubble contrast */}
        <Rect x={0} y={SCREEN_H * 0.78} width={SCREEN_W} height={SCREEN_H * 0.22}>
          <LinearGradient
            start={vec(0, SCREEN_H * 0.78)}
            end={vec(0, SCREEN_H)}
            colors={["rgba(0,0,0,0)", "rgba(2,1,10,0.55)"]}
          />
        </Rect>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#010108",
  },
});
