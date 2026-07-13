/**
 * GlassBottomSheet — Gesture-driven bottom sheet with GlassModal aesthetics.
 *
 * Wraps @gorhom/bottom-sheet to provide drag-to-dismiss, snap points, and the
 * same dark glassmorphism look used by GlassModal (position="bottom").
 *
 * Usage:
 *   <GlassBottomSheet visible={showProfile} onClose={close} snapPoints={['60%', '90%']}>
 *     <ProfileContent />
 *   </GlassBottomSheet>
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View, type AppStateStatus } from 'react-native';
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { LinearGradient } from 'expo-linear-gradient';

const GLASS_BG = 'rgba(12, 12, 22, 0.95)';
const GLASS_BORDER = 'rgba(248, 248, 255, 0.10)';
const HIGHLIGHT = 'rgba(255, 255, 255, 0.12)';

interface GlassBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Snap points — default ['50%', '90%'] */
  snapPoints?: string[];
  /** Override background color */
  glassBg?: string;
  /** Index into snapPoints to open at — default 0 (the smallest point) */
  initialIndex?: number;
}

export function GlassBottomSheet({
  visible,
  onClose,
  children,
  snapPoints: snapPointsProp,
  glassBg,
  initialIndex = 0,
}: GlassBottomSheetProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => snapPointsProp ?? ['50%', '90%'], [snapPointsProp]);
  // 2026-07-09: raw <BottomSheet> (what this wraps — deliberately, not
  // <BottomSheetModal>, to stay in the same Android window and avoid the
  // grey-screen race) stays fully mounted — gesture detector + Reanimated
  // shared values live — even at index=-1. Every screen now renders several
  // of these unconditionally (ChartModal, UserProfileModal, share sheet,
  // MessageActionSheet, ...), so they were all paying that cost from the
  // moment the screen opened, before the user ever touched one — general
  // touch/scroll jank, not a specific broken feature. Defer actually
  // mounting the sheet until it's opened for the first time; once opened,
  // keep it mounted (same behavior as before for the rest of the session).
  const [hasOpenedOnce, setHasOpenedOnce] = useState(visible);

  useEffect(() => {
    if (visible) {
      setHasOpenedOnce(true);
      sheetRef.current?.snapToIndex(initialIndex);
    } else {
      sheetRef.current?.close();
    }
  }, [visible, initialIndex]);

  // 2026-07-14: backgrounding the app (e.g. switching to another app right
  // after tapping Copy, before the sheet's ~300ms Reanimated close animation
  // finishes) can leave that animation suspended mid-flight on Android —
  // resuming into a half-closed sheet/backdrop has manifested as the same
  // stuck-grey-screen class of bug documented throughout this codebase, just
  // triggered by OS-level backgrounding instead of an in-app Modal race.
  // Force the sheet fully closed the instant the app leaves 'active' so
  // there's never an animated transition left in flight to resume into.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') sheetRef.current?.close();
    });
    return () => sub.remove();
  }, []);

  // Hooks below must stay ABOVE the early return (Rules of Hooks — this
  // component must call the same hooks on every render, whether or not
  // hasOpenedOnce is true yet).
  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.6}
        pressBehavior="close"
      />
    ),
    [],
  );

  if (!hasOpenedOnce) return null;

  return (
    <BottomSheet
      ref={sheetRef}
      index={visible ? initialIndex : -1}
      snapPoints={snapPoints}
      onChange={handleSheetChange}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      backgroundStyle={[
        styles.background,
        glassBg ? { backgroundColor: glassBg } : undefined,
      ]}
      handleIndicatorStyle={styles.handle}
      style={styles.sheet}
    >
      {/* Inner gradient — matches GlassModal */}
      <LinearGradient
        colors={['rgba(248, 248, 255, 0.06)', 'rgba(0, 0, 0, 0.12)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderTopLeftRadius: 16, borderTopRightRadius: 16 }]}
        pointerEvents="none"
      />
      {/* Top-edge highlight */}
      <View style={styles.highlight} pointerEvents="none" />

      <BottomSheetScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {children}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: GLASS_BORDER,
    overflow: 'hidden',
    zIndex: 9999,
    elevation: 9999,
  },
  background: {
    backgroundColor: GLASS_BG,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    height: 1.5,
    backgroundColor: HIGHLIGHT,
    borderRadius: 1,
    zIndex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
});
