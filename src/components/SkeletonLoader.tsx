/**
 * SkeletonLoader — Shimmer placeholder content for loading states.
 *
 * Replaces bare ActivityIndicator with banana-themed skeleton screens.
 * Uses Reanimated for smooth shimmer animation.
 */

import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Animated } from "react-native";
import { THEME } from "@/lib/constants";

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
}

function ShimmerBlock({ width = "100%", height = 16, borderRadius = 8, style }: SkeletonProps) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.block,
        { width: width as any, height, borderRadius },
        { opacity: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.6] }) },
        style,
      ]}
    />
  );
}

/** Chat message skeleton — mimics a message bubble */
export function ChatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.chatContainer}>
      {Array.from({ length: count }).map((_, i) => {
        const isOwn = i % 3 === 0;
        return (
          <View key={i} style={[styles.chatRow, isOwn && styles.chatRowOwn]}>
            <ShimmerBlock width={32} height={32} borderRadius={16} />
            <View style={[styles.chatBubbleSkeleton, isOwn && styles.chatBubbleSkeletonOwn]}>
              <ShimmerBlock width={80} height={10} borderRadius={5} />
              <ShimmerBlock width={isOwn ? 120 : 160} height={12} borderRadius={6} />
              {!isOwn && <ShimmerBlock width={100} height={12} borderRadius={6} />}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Globe marker skeleton — dots on a circle */
export function GlobeSkeleton() {
  return (
    <View style={styles.globeContainer}>
      <ShimmerBlock width={200} height={200} borderRadius={100} />
      <ShimmerBlock width={120} height={14} borderRadius={7} style={{ marginTop: 12 }} />
    </View>
  );
}

/** Community popup skeleton — grid of blocks */
export function CommunitySkeleton() {
  return (
    <View style={styles.communityContainer}>
      <ShimmerBlock width="100%" height={40} borderRadius={14} />
      <View style={styles.communityGrid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <ShimmerBlock key={i} width="30%" height={80} borderRadius={16} />
        ))}
      </View>
    </View>
  );
}

/** Generic inline skeleton line */
export function LineSkeleton({ width = 100, height = 12 }: { width?: number; height?: number }) {
  return <ShimmerBlock width={width} height={height} borderRadius={height / 2} />;
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: "rgba(108, 180, 238, 0.08)",
  },

  // Chat
  chatContainer: { gap: 12, padding: 16 },
  chatRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  chatRowOwn: { flexDirection: "row-reverse" },
  chatBubbleSkeleton: {
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderRadius: 18,
    padding: 14,
    maxWidth: "70%",
  },
  chatBubbleSkeletonOwn: {
    backgroundColor: "rgba(108, 180, 238, 0.03)",
  },

  // Globe
  globeContainer: { alignItems: "center", justifyContent: "center", padding: 24 },

  // Community
  communityContainer: { gap: 16, padding: 16 },
  communityGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
  },
});
