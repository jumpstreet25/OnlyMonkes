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

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
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
}

export function GlassBottomSheet({
  visible,
  onClose,
  children,
  snapPoints: snapPointsProp,
  glassBg,
}: GlassBottomSheetProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => snapPointsProp ?? ['50%', '90%'], [snapPointsProp]);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

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

  return (
    <BottomSheet
      ref={sheetRef}
      index={visible ? 0 : -1}
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
