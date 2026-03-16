/**
 * OnlineDot — small green dot overlaid on avatars to indicate
 * a user is currently online (heartbeat < 2 min ago).
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';

interface OnlineDotProps {
  online: boolean;
  size?: number;
}

export function OnlineDot({ online, size = 10 }: OnlineDotProps) {
  if (!online) return null;
  return (
    <View
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: size > 8 ? 2 : 1,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#22c55e',
    borderColor: '#0A0A0F',
  },
});
