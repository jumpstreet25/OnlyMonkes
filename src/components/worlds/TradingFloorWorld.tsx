/**
 * TradingFloorWorld — stationary jungle plate + waterfall only.
 *
 * Motion: heavy waterfall on the far candle (4 legs + soft sheen + splash).
 * The painted stream is left as plate art — no live creek flow overlay.
 *
 * Scope: world BACKGROUND only.
 */

import React, { useEffect, useMemo } from "react";
import { View, StyleSheet, Dimensions, Image as RNImage } from "react-native";
import {
  Canvas,
  Circle,
  Line,
  vec,
  Group,
  BlurMask,
  LinearGradient,
  Rect,
} from "@shopify/react-native-skia";
import {
  useSharedValue,
  useDerivedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
  type SharedValue,
} from "react-native-reanimated";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

const PLATE_ASPECT = 9 / 16;
const JUNGLE_PLATE = require("../../../assets/trading-floor-jungle.jpg");

const SHEEN = "rgba(220, 248, 255, 0.55)";
const FOAM = "rgba(245, 252, 255, 0.32)";
const FALL_WHITE = "rgba(220, 250, 255, 0.42)";
const FALL_SOFT = "rgba(160, 220, 230, 0.30)";

interface TradingFloorWorldProps {
  active?: boolean;
}

type Layout = { w: number; h: number; left: number; top: number };

function plateLayout(): Layout {
  let w = SCREEN_W;
  let h = w / PLATE_ASPECT;
  if (h < SCREEN_H) {
    h = SCREEN_H;
    w = h * PLATE_ASPECT;
  }
  return { w, h, left: (SCREEN_W - w) / 2, top: 0 };
}

// 4 painted curtain legs under the far candle (left → right)
const FALL_LEGS = [
  { u: 0.720, phase: 0.0, w: 6.5 },
  { u: 0.752, phase: 0.22, w: 7.5 },
  { u: 0.782, phase: 0.45, w: 7.0 },
  { u: 0.812, phase: 0.68, w: 6.0 },
];
const FALL_V0 = 0.185;
const FALL_V1 = 0.375;

export function TradingFloorWorld({ active = true }: TradingFloorWorldProps) {
  const layout = useMemo(() => plateLayout(), []);
  const { left, top, w, h } = layout;

  const flow = useSharedValue(0);
  const shimmer = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(flow);
      cancelAnimation(shimmer);
      flow.value = 0;
      shimmer.value = 0;
      return;
    }
    flow.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.linear }),
      -1,
      false,
    );
    shimmer.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(flow);
      cancelAnimation(shimmer);
    };
  }, [active, flow, shimmer]);

  const fallTop = top + FALL_V0 * h;
  const fallPx = (FALL_V1 - FALL_V0) * h;
  const fallLeft = left + 0.705 * w;
  const fallWidth = 0.135 * w;

  const fallSheenY = useDerivedValue(() => fallTop + (flow.value % 1) * fallPx);
  const fallSheenOp = useDerivedValue(() => {
    const t = flow.value % 1;
    if (t < 0.08) return t / 0.08;
    if (t > 0.8) return (1 - t) / 0.2;
    return 0.5 + 0.2 * Math.sin(t * Math.PI * 2);
  });

  return (
    <View style={styles.root} pointerEvents="none">
      <RNImage
        source={JUNGLE_PLATE}
        style={{
          position: "absolute",
          left,
          top,
          width: w,
          height: h,
        }}
        resizeMode="stretch"
      />

      <Canvas style={StyleSheet.absoluteFill}>
        {FALL_LEGS.map((leg, i) => (
          <FallLeg
            key={`leg-${i}`}
            leg={leg}
            left={left}
            top={top}
            pw={w}
            ph={h}
            flow={flow}
            shimmer={shimmer}
          />
        ))}

        <Group opacity={fallSheenOp}>
          <Rect x={fallLeft} y={fallSheenY} width={fallWidth} height={fallPx * 0.12}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(0, fallPx * 0.12)}
              colors={[
                "rgba(230, 250, 255, 0)",
                "rgba(230, 250, 255, 0.5)",
                "rgba(230, 250, 255, 0)",
              ]}
            />
            <BlurMask blur={7} style="normal" />
          </Rect>
        </Group>

        <SplashPulse left={left} top={top} pw={w} ph={h} shimmer={shimmer} />
      </Canvas>
    </View>
  );
}

function FallLeg({
  leg,
  left,
  top,
  pw,
  ph,
  flow,
  shimmer,
}: {
  leg: { u: number; phase: number; w: number };
  left: number;
  top: number;
  pw: number;
  ph: number;
  flow: SharedValue<number>;
  shimmer: SharedValue<number>;
}) {
  const x = left + leg.u * pw;
  const y0 = top + FALL_V0 * ph;
  const fallPx = (FALL_V1 - FALL_V0) * ph;

  const yA = useDerivedValue(() => {
    const t = (flow.value * 1.15 + leg.phase) % 1;
    return y0 + t * fallPx;
  });
  const yB = useDerivedValue(() => {
    const t = (flow.value * 1.15 + leg.phase + 0.38) % 1;
    return y0 + t * fallPx;
  });
  const opacity = useDerivedValue(() => {
    const wave = 0.5 + 0.5 * Math.sin((shimmer.value + leg.phase) * Math.PI * 2);
    return 0.4 + 0.35 * wave;
  });

  const streakA1 = useDerivedValue(() => Math.max(y0, yA.value - 10));
  const streakA2 = useDerivedValue(() => Math.min(y0 + fallPx, yA.value + 10));
  const streakB1 = useDerivedValue(() => Math.max(y0, yB.value - 8));
  const streakB2 = useDerivedValue(() => Math.min(y0 + fallPx, yB.value + 8));
  const pA1 = useDerivedValue(() => vec(x, streakA1.value));
  const pA2 = useDerivedValue(() => vec(x + 0.3, streakA2.value));
  const pB1 = useDerivedValue(() => vec(x - 0.8, streakB1.value));
  const pB2 = useDerivedValue(() => vec(x - 0.4, streakB2.value));

  return (
    <Group opacity={opacity}>
      <Line
        p1={vec(x, y0)}
        p2={vec(x + 0.4, y0 + fallPx)}
        color={FALL_SOFT}
        strokeWidth={leg.w}
        style="stroke"
      >
        <BlurMask blur={2.5} style="normal" />
      </Line>
      <Line
        p1={vec(x - 1, y0 + 2)}
        p2={vec(x - 0.4, y0 + fallPx * 0.97)}
        color={FALL_WHITE}
        strokeWidth={leg.w * 0.4}
        style="stroke"
        opacity={0.65}
      >
        <BlurMask blur={1.2} style="normal" />
      </Line>
      <Line p1={pA1} p2={pA2} color={FALL_WHITE} strokeWidth={leg.w * 0.55} style="stroke" opacity={0.75}>
        <BlurMask blur={2} style="normal" />
      </Line>
      <Line p1={pB1} p2={pB2} color={SHEEN} strokeWidth={leg.w * 0.35} style="stroke" opacity={0.55}>
        <BlurMask blur={1.5} style="normal" />
      </Line>
    </Group>
  );
}

function SplashPulse({
  left,
  top,
  pw,
  ph,
  shimmer,
}: {
  left: number;
  top: number;
  pw: number;
  ph: number;
  shimmer: SharedValue<number>;
}) {
  const cx = left + 0.785 * pw;
  const cy = top + 0.375 * ph;
  const r = useDerivedValue(() => 12 + shimmer.value * 5);
  const opacity = useDerivedValue(() => 0.12 + shimmer.value * 0.14);
  return (
    <Circle cx={cx} cy={cy} r={r} color={FOAM} opacity={opacity}>
      <BlurMask blur={9} style="normal" />
    </Circle>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject },
});
