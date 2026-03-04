import React, { useEffect, useRef } from 'react';
import { StyleSheet, Dimensions, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const COLORS = [
  '#7C3AED', '#FFD700', '#FF6B00', '#00E5FF',
  '#FF4081', '#00E676', '#FFAB00', '#E040FB',
  '#00B0FF', '#FF6E40',
];

const PARTICLE_COUNT = 40;
const DURATION = 3000;

interface ParticleProps {
  index: number;
  onDone?: () => void;
  isLast: boolean;
}

function Particle({ index, onDone, isLast }: ParticleProps) {
  const startX = Math.random() * SCREEN_W;
  const color = COLORS[index % COLORS.length];
  const delay = Math.random() * 600;
  const endY = SCREEN_H + 40;
  const width = 6 + Math.random() * 8;
  const height = 10 + Math.random() * 8;
  const endX = startX + (Math.random() - 0.5) * 160;

  const translateY = useSharedValue(-20);
  const translateX = useSharedValue(startX);
  const opacity = useSharedValue(0);
  const rotate = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 100 }));
    translateY.value = withDelay(delay, withTiming(endY, { duration: DURATION, easing: Easing.in(Easing.ease) }));
    translateX.value = withDelay(delay, withTiming(endX, { duration: DURATION }));
    rotate.value = withDelay(delay, withTiming(720 + Math.random() * 360, { duration: DURATION }));
    if (isLast && onDone) {
      opacity.value = withDelay(
        delay + DURATION,
        withTiming(0, { duration: 200 }, () => {
          if (onDone) runOnJS(onDone)();
        })
      );
    }
  }, []);

  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    top: 0,
    left: 0,
    width,
    height,
    backgroundColor: color,
    borderRadius: 2,
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value - startX },
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  return <Animated.View style={style} />;
}

interface ConfettiViewProps {
  onDone: () => void;
}

export function ConfettiView({ onDone }: ConfettiViewProps) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: PARTICLE_COUNT }).map((_, i) => (
        <Particle
          key={i}
          index={i}
          isLast={i === PARTICLE_COUNT - 1}
          onDone={i === PARTICLE_COUNT - 1 ? onDone : undefined}
        />
      ))}
    </View>
  );
}
