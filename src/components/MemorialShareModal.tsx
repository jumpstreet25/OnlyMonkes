/**
 * MemorialShareModal — preview + "Share to X" for the whole Memorial list, captured as one
 * image via MemorialShareCard. Same capture/compress/share plumbing as PnLCardModal /
 * MonkeCloutCardModal (react-native-view-shot -> expo-image-manipulator -> shareImageToX),
 * simplified to X-only per the feature request (no Main Chat / Save / Copy options here).
 */
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import { THEME, FONTS } from '@/lib/constants';
import { GlassBottomSheet } from '@/components/GlassBottomSheet';
import { MemorialShareCard } from '@/components/MemorialShareCard';
import { shareImageToX } from '@/lib/shareToX';
import type { BurntMonke } from '@/lib/nftVerification';

const getViewShot = () => import('react-native-view-shot');
const getImageManipulator = () => import('expo-image-manipulator');

interface MemorialShareModalProps {
  monkes: BurntMonke[];
  visible: boolean;
  onClose: () => void;
}

export function MemorialShareModal({ monkes, visible, onClose }: MemorialShareModalProps) {
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);

  const screenW = Dimensions.get('window').width;
  const cardWidth = Math.min(screenW - 48, 400);

  const handleShareX = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { captureRef } = await getViewShot();
      // Same two-frame settle as every other share card in this app — Android needs a beat
      // for the just-mounted view to actually paint before captureRef reads it back.
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const uri = await captureRef(cardRef as any, {
        format: 'png', quality: 1, result: 'tmpfile', useRenderInContext: true,
      });
      const IM = await getImageManipulator();
      const compressed = await IM.manipulateAsync(uri, [{ resize: { width: 1080 } }], {
        compress: 0.85, format: IM.SaveFormat.JPEG,
      });
      // Exact caption template as specified — no hashtags appended, matching the given spec.
      const message = `MonkeMemorial via @xOnlyMonkes, ${monkes.length} Gone but never forgotten 🪦 RIP`;
      const { saved } = await shareImageToX(compressed.uri, message);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (saved) toast.success('Image saved — tap the image icon in X to attach it 📸');
    } catch (e: any) {
      if (e?.message && !/dismiss/i.test(e.message)) toast.error(e.message ?? 'Share failed');
    } finally {
      setBusy(false);
    }
  }, [busy, monkes.length]);

  return (
    <GlassBottomSheet visible={visible} onClose={onClose} snapPoints={['70%', '95%']}>
      <View style={styles.contentGap}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Share Memorial</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.closeIcon}>✕</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.previewScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.cardWrap}>
            <MemorialShareCard ref={cardRef} monkes={monkes} width={cardWidth} />
          </View>
        </ScrollView>

        <Pressable
          onPress={handleShareX}
          disabled={busy}
          style={({ pressed }) => [styles.shareBtn, busy && styles.btnDisabled, pressed && !busy && { opacity: 0.8 }]}
        >
          <Text style={styles.shareBtnText}>{busy ? 'Preparing…' : '𝕏  Share to X'}</Text>
        </Pressable>
      </View>
    </GlassBottomSheet>
  );
}

const styles = StyleSheet.create({
  contentGap: { gap: 14, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20, flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: FONTS.displayMed, fontSize: 17, color: THEME.text },
  closeBtn: { padding: 4 },
  closeIcon: { fontSize: 18, color: THEME.textMuted },
  previewScroll: { flex: 1 },
  cardWrap: { alignItems: 'center', paddingVertical: 8 },
  shareBtn: {
    backgroundColor: THEME.accent, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  shareBtnText: { fontFamily: FONTS.bodySemi, fontSize: 15, color: '#fff' },
  btnDisabled: { opacity: 0.5 },
});
