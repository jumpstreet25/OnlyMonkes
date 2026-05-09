/**
 * LivePnLCardModal — full-screen modal for a LIVE AutonoMonke position card.
 *
 * Mirrors PnLCardModal (closed trades) but for live PortfolioCard data:
 * shows the same Skia PnLCard visual, with Save / Copy / Share-X /
 * Share-MainChat / Share-Both buttons. Synthesizes a ClosedTrade-shape from
 * the live card data so PnLCard renders without modification.
 *
 * The "TRADE CLOSED" header in PnLCard is overridden via a "LIVE" overlay
 * badge in the modal title row instead of forking the card component.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, Pressable, StyleSheet, Alert, Share, Dimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import { THEME, FONTS } from '@/lib/constants';
import { PnLCard } from '@/components/PnLCard';
import type { ClosedTrade } from '@/lib/positions';
import type { PortfolioCard } from '@/store/tradesStore';
import { useXmtp } from '@/hooks/useXmtp';

const getViewShot = () => import('react-native-view-shot');
const getMediaLibrary = () => import('expo-media-library');
const getFileSystem = () => import('expo-file-system');
const getImageManipulator = () => import('expo-image-manipulator');

interface LivePnLCardModalProps {
  card: PortfolioCard | null;
  visible: boolean;
  onClose: () => void;
}

function formatLiveSummary(card: PortfolioCard): string {
  const sign = card.pnlPct >= 0 ? '+' : '';
  const sec = Math.floor(card.durationMs / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const dur = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  return `Live AutonoMonke: ${sign}${card.pnlPct.toFixed(2)}% on $${card.token.toUpperCase()} · ${dur} open · ${card.entrySolAmount.toFixed(4)} SOL in`;
}

/** Adapt PortfolioCard → ClosedTrade shape so existing PnLCard renders.
 *  exitSolAmount = currentSolValue, durationMs = age, reason = "live snapshot". */
function liveCardAsClosedTrade(card: PortfolioCard): ClosedTrade {
  return {
    id: card.positionId,
    source: card.source,
    token: card.token,
    mint: card.mint,
    entrySolAmount: card.entrySolAmount,
    exitSolAmount: card.currentSolValue,
    pnlSol: card.pnlSol,
    pnlPct: card.pnlPct,
    durationMs: card.durationMs,
    openedAt: card.openedAt,
    closedAt: card.ts,
    reason: 'live',
  };
}

export function LivePnLCardModal({ card, visible, onClose }: LivePnLCardModalProps) {
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState<null | 'save' | 'copy' | 'x' | 'chat' | 'both'>(null);
  const { send } = useXmtp();

  const screenW = Dimensions.get('window').width;
  const cardWidth = Math.min(screenW - 48, 360);

  const synthetic = useMemo(() => (card ? liveCardAsClosedTrade(card) : null), [card]);

  const captureCard = useCallback(async (): Promise<string> => {
    const { captureRef } = await getViewShot();
    return await captureRef(cardRef as any, { format: 'jpg', quality: 0.95 });
  }, []);

  const compressForShare = useCallback(async (uri: string): Promise<string> => {
    const IM = await getImageManipulator();
    const out = await IM.manipulateAsync(uri, [{ resize: { width: 1080 } }], {
      compress: 0.85,
      format: IM.SaveFormat.JPEG,
    });
    return out.uri;
  }, []);

  const sendToMainChat = useCallback(async (uri: string) => {
    const compressed = await compressForShare(uri);
    const FS = await getFileSystem();
    const b64 = await FS.readAsStringAsync(compressed, { encoding: FS.EncodingType.Base64 });
    await send(`IMAGE:data:image/jpeg;base64,${b64}`);
  }, [compressForShare, send]);

  const handleSave = useCallback(async () => {
    if (!card || busy) return;
    setBusy('save');
    try {
      const ML = await getMediaLibrary();
      const { status } = await ML.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow gallery access to save the card.');
        return;
      }
      const uri = await captureCard();
      await ML.saveToLibraryAsync(uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.success('Saved to gallery');
    } catch (e: any) {
      toast.error(e?.message ?? 'Save failed');
    } finally {
      setBusy(null);
    }
  }, [card, busy, captureCard]);

  const handleCopy = useCallback(async () => {
    if (!card || busy) return;
    setBusy('copy');
    try {
      await Clipboard.setStringAsync(formatLiveSummary(card));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      toast.success('Summary copied');
    } catch (e: any) {
      toast.error(e?.message ?? 'Copy failed');
    } finally {
      setBusy(null);
    }
  }, [card, busy]);

  const handleShareX = useCallback(async () => {
    if (!card || busy) return;
    setBusy('x');
    try {
      const uri = await captureCard();
      const compressed = await compressForShare(uri);
      await Share.share({ url: compressed, message: formatLiveSummary(card) });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e: any) {
      if (e?.message && !/dismiss/i.test(e.message)) toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }, [card, busy, captureCard, compressForShare]);

  const handleShareMainChat = useCallback(async () => {
    if (!card || busy) return;
    setBusy('chat');
    try {
      const uri = await captureCard();
      await sendToMainChat(uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.success('Posted to Main Chat');
    } catch (e: any) {
      toast.error(e?.message ?? 'Post failed');
    } finally {
      setBusy(null);
    }
  }, [card, busy, captureCard, sendToMainChat]);

  const handleShareBoth = useCallback(async () => {
    if (!card || busy) return;
    setBusy('both');
    try {
      const uri = await captureCard();
      await sendToMainChat(uri);
      const compressed = await compressForShare(uri);
      await Share.share({ url: compressed, message: formatLiveSummary(card) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.success('Posted to Main Chat');
    } catch (e: any) {
      if (e?.message && !/dismiss/i.test(e.message)) toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }, [card, busy, captureCard, compressForShare, sendToMainChat]);

  if (!card || !synthetic) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={styles.titleGroup}>
              <Text style={styles.title}>Live Position</Text>
              <View style={styles.liveBadge}>
                <Text style={styles.liveDot}>●</Text>
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Text style={styles.closeIcon}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.cardWrap}>
            <PnLCard ref={cardRef} trade={synthetic} width={cardWidth} />
          </View>

          <View style={styles.shareRow}>
            <ActionBtn label="𝕏" sub="Tweet" onPress={handleShareX} loading={busy === 'x'} disabled={!!busy && busy !== 'x'} />
            <ActionBtn label="💬" sub="Main Chat" onPress={handleShareMainChat} loading={busy === 'chat'} disabled={!!busy && busy !== 'chat'} />
            <ActionBtn label="🚀" sub="Both" onPress={handleShareBoth} loading={busy === 'both'} disabled={!!busy && busy !== 'both'} primary />
          </View>

          <View style={styles.utilRow}>
            <ActionBtn label="💾" sub="Save" onPress={handleSave} loading={busy === 'save'} disabled={!!busy && busy !== 'save'} flat />
            <ActionBtn label="📋" sub="Copy" onPress={handleCopy} loading={busy === 'copy'} disabled={!!busy && busy !== 'copy'} flat />
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface ActionBtnProps {
  label: string;
  sub: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  primary?: boolean;
  flat?: boolean;
}

function ActionBtn({ label, sub, onPress, loading, disabled, primary, flat }: ActionBtnProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        primary && styles.btnPrimary,
        flat && styles.btnFlat,
        (disabled || loading) && styles.btnDisabled,
        pressed && !disabled && { opacity: 0.7 },
      ]}
    >
      <Text style={styles.btnLabel}>{loading ? '…' : label}</Text>
      <Text style={[styles.btnSub, primary && { color: THEME.bg }]}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  sheet: {
    width: '92%', maxWidth: 420, borderRadius: 24, padding: 16,
    backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border,
    gap: 14,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: FONTS.display, fontSize: 16, color: THEME.text, letterSpacing: 0.5 },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
    backgroundColor: THEME.error + '22', borderWidth: 1, borderColor: THEME.error + '55',
  },
  liveDot: { color: THEME.error, fontSize: 8 },
  liveText: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.error, letterSpacing: 1 },
  closeBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  closeIcon: { color: THEME.textMuted, fontSize: 16 },
  cardWrap: { alignItems: 'center' },
  shareRow: { flexDirection: 'row', gap: 8 },
  utilRow: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: 'center', gap: 4,
    backgroundColor: THEME.surfaceHigh, borderWidth: 1, borderColor: THEME.border,
  },
  btnPrimary: { backgroundColor: THEME.gold, borderColor: THEME.gold },
  btnFlat: { paddingVertical: 10 },
  btnDisabled: { opacity: 0.5 },
  btnLabel: { fontSize: 18, color: THEME.text },
  btnSub: { fontFamily: FONTS.bodyMed, fontSize: 11, color: THEME.textMuted, letterSpacing: 0.4 },
});
