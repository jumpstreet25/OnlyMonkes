import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Alert, Share, Dimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import { THEME, FONTS } from '@/lib/constants';
import { GlassBottomSheet } from '@/components/GlassBottomSheet';
import { ShareablePnLCard } from '@/components/ShareablePnLCard';
import type { ClosedTrade } from '@/lib/positions';
import { useXmtp } from '@/hooks/useXmtp';

const getViewShot = () => import('react-native-view-shot');
const getMediaLibrary = () => import('expo-media-library');
const getFileSystem = () => import('expo-file-system');
const getImageManipulator = () => import('expo-image-manipulator');

interface PnLCardModalProps {
  trade: ClosedTrade | null;
  visible: boolean;
  onClose: () => void;
}

function formatTradeSummary(trade: ClosedTrade): string {
  const sign = trade.pnlPct >= 0 ? '+' : '';
  const sec = Math.floor(trade.durationMs / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const dur = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  return `${sign}${trade.pnlPct.toFixed(2)}% on $${trade.token.toUpperCase()} · ${dur} · entry ${trade.entrySolAmount.toFixed(4)} SOL → exit ${trade.exitSolAmount.toFixed(4)} SOL`;
}

export function PnLCardModal({ trade, visible, onClose }: PnLCardModalProps) {
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState<null | 'save' | 'copy' | 'x' | 'chat' | 'both'>(null);
  const { send } = useXmtp();

  const screenW = Dimensions.get('window').width;
  const cardWidth = Math.min(screenW - 48, 360);

  const captureCard = useCallback(async (): Promise<string> => {
    const { captureRef } = await getViewShot();
    // 2026-05-09: PnLCard's Skia <Canvas> needs two-frame settle + PNG +
    // tmpfile + useRenderInContext on Android, otherwise capture returns a
    // black image (GPU-surface readback fail).
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    return await captureRef(cardRef as any, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
      useRenderInContext: true,
    });
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
    const payload = `IMAGE:data:image/jpeg;base64,${b64}`;

    // Optimistic local insert so the user sees their share immediately —
    // XMTP doesn't echo own sends back via stream. mergeMessage upgrades
    // opt-* IDs in place when the real message arrives.
    try {
      const { useAppStore } = await import('@/store/appStore');
      const { useChatStore } = await import('@/store/chatStore');
      const { REACTIONS } = await import('@/lib/constants');
      const myInboxId = useAppStore.getState().myInboxId;
      if (myInboxId) {
        const reactions = Object.fromEntries(
          REACTIONS.map((emoji) => [emoji, { emoji, count: 0, reactedByMe: false, reactors: [] }])
        ) as any;
        useChatStore.getState().addMessage({
          id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          senderAddress: myInboxId,
          senderUsername: useAppStore.getState().username ?? undefined,
          content: payload,
          sentAt: new Date(),
          reactions,
          status: 'sending',
        });
      }
    } catch { /* non-critical */ }

    await send(payload);
  }, [compressForShare, send]);

  const handleSave = useCallback(async () => {
    if (!trade || busy) return;
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
  }, [trade, busy, captureCard]);

  const handleCopy = useCallback(async () => {
    if (!trade || busy) return;
    setBusy('copy');
    try {
      await Clipboard.setStringAsync(formatTradeSummary(trade));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      toast.success('Summary copied');
    } catch (e: any) {
      toast.error(e?.message ?? 'Copy failed');
    } finally {
      setBusy(null);
    }
  }, [trade, busy]);

  const handleShareX = useCallback(async () => {
    if (!trade || busy) return;
    setBusy('x');
    try {
      const uri = await captureCard();
      const compressed = await compressForShare(uri);
      await Share.share({ url: compressed, message: formatTradeSummary(trade) });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e: any) {
      if (e?.message && !/dismiss/i.test(e.message)) toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }, [trade, busy, captureCard, compressForShare]);

  const handleShareMainChat = useCallback(async () => {
    if (!trade || busy) return;
    setBusy('chat');
    try {
      const uri = await captureCard();
      await sendToMainChat(uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // 2026-07-09: defer — sendToMainChat() pushes a large base64 IMAGE
      // message into chatStore, which can still be laying out behind this
      // Modal when the toast overlay mounts; firing both at once left a
      // stuck grey screen on Android (same race as the reaction toast fix).
      setTimeout(() => toast.success('Posted to Main Chat'), 350);
    } catch (e: any) {
      toast.error(e?.message ?? 'Post failed');
    } finally {
      setBusy(null);
    }
  }, [trade, busy, captureCard, sendToMainChat]);

  const handleShareBoth = useCallback(async () => {
    if (!trade || busy) return;
    setBusy('both');
    try {
      const uri = await captureCard();
      await sendToMainChat(uri);
      const compressed = await compressForShare(uri);
      await Share.share({ url: compressed, message: formatTradeSummary(trade) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => toast.success('Posted to Main Chat'), 350);
    } catch (e: any) {
      if (e?.message && !/dismiss/i.test(e.message)) toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }, [trade, busy, captureCard, compressForShare, sendToMainChat]);

  if (!trade) return null;

  return (
    <GlassBottomSheet visible={visible} onClose={onClose} snapPoints={['65%', '95%']}>
      <View style={styles.contentGap}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Trade Closed</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.closeIcon}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.cardWrap}>
          <ShareablePnLCard ref={cardRef} trade={trade} width={cardWidth} />
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
    </GlassBottomSheet>
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
  contentGap: { gap: 14 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: FONTS.display, fontSize: 16, color: THEME.text, letterSpacing: 0.5 },
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
