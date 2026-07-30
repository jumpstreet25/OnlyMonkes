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
  View, Text, Pressable, StyleSheet, Alert, Dimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import { THEME, FONTS } from '@/lib/constants';
import { GlassBottomSheet } from '@/components/GlassBottomSheet';
import { ShareablePnLCard } from '@/components/ShareablePnLCard';
import { shareImageToX } from '@/lib/shareToX';
import type { ClosedTrade } from '@/lib/positions';
import type { PortfolioCard } from '@/store/tradesStore';
import { useXmtp } from '@/hooks/useXmtp';

const getViewShot = () => import('react-native-view-shot');
const getMediaLibrary = () => import('expo-media-library');
const getFileSystem = () => import('expo-file-system/legacy');
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
  const [busy, setBusy] = useState<null | 'save' | 'copy' | 'x' | 'chat' | 'both' | 'close'>(null);
  const { send } = useXmtp();

  const screenW = Dimensions.get('window').width;
  const cardWidth = Math.min(screenW - 48, 360);

  const synthetic = useMemo(() => (card ? liveCardAsClosedTrade(card) : null), [card]);

  const captureCard = useCallback(async (): Promise<string> => {
    const { captureRef } = await getViewShot();
    // 2026-05-09: PnLCard uses a Skia <Canvas> for the glassy background.
    // captureRef on Android can't read GPU-backed Skia surfaces with the
    // default settings — result is a black/brown frame. Two fixes here:
    //   1. Wait two frames so Skia commits its first paint (was the
    //      "doesn't load until app reopen" symptom)
    //   2. Use PNG + tmpfile + useRenderInContext (the known workaround
    //      that forces software rasterization for hardware layers)
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
    // Chat bubbles render this at a fraction of the 1080px compressForShare()
    // targets for external sharing — that width produced an unnecessarily
    // large base64 string embedded directly in message content, adding real
    // weight to every re-render this message appears in AND to the local
    // message cache (see messageCache.ts MAX_PRESERVABLE — these never
    // expired, so every share made every future cold start slower).
    const IM = await getImageManipulator();
    const resized = await IM.manipulateAsync(uri, [{ resize: { width: 540 } }], {
      compress: 0.7,
      format: IM.SaveFormat.JPEG,
    });
    const FS = await getFileSystem();
    const b64 = await FS.readAsStringAsync(resized.uri, { encoding: FS.EncodingType.Base64 });
    const payload = `IMAGE:data:image/jpeg;base64,${b64}`;

    // Optimistic local insert — XMTP doesn't echo own sends back via stream,
    // so the user wouldn't see their share until the next foreground sync
    // (which is why "needs app reopen" was the symptom). chatStore.mergeMessage
    // upgrades opt-* IDs to the real ID within a 3s window, so duplicates
    // collapse cleanly when the real message lands.
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
      // 2026-07-30: defer — same race as handleShareMainChat below (grey
      // screen when the toast overlay mounts in the same tick as this
      // Modal's Android Dialog window still settling from the save).
      setTimeout(() => toast.success('Saved to gallery'), 350);
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
      const { saved } = await shareImageToX(compressed, formatLiveSummary(card));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (saved) {
        toast.success('Image saved — tap the image icon in X to attach it 📸');
      }
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
      // 2026-07-09: defer — see matching comment in PnLCardModal.handleShareMainChat.
      setTimeout(() => toast.success('Posted to Main Chat'), 350);
    } catch (e: any) {
      toast.error(e?.message ?? 'Post failed');
    } finally {
      setBusy(null);
    }
  }, [card, busy, captureCard, sendToMainChat]);

  // Close-position confirmation state. First tap arms (3s window), second tap fires.
  const [closeArmed, setCloseArmed] = useState(false);
  const closeArmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClosePosition = useCallback(async () => {
    if (!card || busy) return;
    if (!closeArmed) {
      setCloseArmed(true);
      if (closeArmTimeoutRef.current) clearTimeout(closeArmTimeoutRef.current);
      closeArmTimeoutRef.current = setTimeout(() => setCloseArmed(false), 3000);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    }
    if (closeArmTimeoutRef.current) clearTimeout(closeArmTimeoutRef.current);
    setCloseArmed(false);
    setBusy('close');
    try {
      // Send `/autonomonke close $TOKEN` directly to the bot DM. Engine looks
      // up the open position by symbol, executes the on-chain sell, marks the
      // position closed, and emits TRADE_CLOSED: which lands as a closed PnL
      // card in the bot DM thread.
      const { getXmtpClient } = await import('@/hooks/useXmtp');
      const { openOrCreateDm, sendDmMessage } = await import('@/lib/xmtp');
      const { BOT_INBOX_IDS } = await import('@/lib/constants');
      const { useAppStore } = await import('@/store/appStore');
      const client = getXmtpClient();
      if (!client) throw new Error('Not connected');
      const dm = await openOrCreateDm(client, BOT_INBOX_IDS[0]);
      const username = useAppStore.getState().username ?? undefined;
      await sendDmMessage(dm, `/autonomonke close $${card.token}`, username);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.success(`Closing $${card.token}…`);
      // 2026-07-09: defer the Modal close so it doesn't tear down its Android
      // Dialog window in the same tick as the toast overlay mounting — see
      // matching comment in PnLCardModal.handleShareMainChat.
      setTimeout(() => onClose(), 350);
    } catch (e: any) {
      toast.error(e?.message ?? 'Close failed');
    } finally {
      setBusy(null);
    }
  }, [card, busy, closeArmed, onClose]);

  const handleShareBoth = useCallback(async () => {
    if (!card || busy) return;
    setBusy('both');
    try {
      const uri = await captureCard();
      await sendToMainChat(uri);
      const compressed = await compressForShare(uri);
      const { saved } = await shareImageToX(compressed, formatLiveSummary(card));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => toast.success(saved ? 'Posted to Main Chat — image saved for X too 📸' : 'Posted to Main Chat'), 350);
    } catch (e: any) {
      if (e?.message && !/dismiss/i.test(e.message)) toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }, [card, busy, captureCard, compressForShare, sendToMainChat]);

  if (!card || !synthetic) return null;

  return (
    <GlassBottomSheet visible={visible} onClose={onClose} snapPoints={['75%', '95%']}>
      <View style={styles.contentGap}>
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
          <ShareablePnLCard ref={cardRef} trade={synthetic} width={cardWidth} isLive />
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

        <Pressable
          onPress={handleClosePosition}
          disabled={!!busy && busy !== 'close'}
          style={({ pressed }) => [
            styles.closePosBtn,
            closeArmed && styles.closePosBtnArmed,
            pressed && !busy && { opacity: 0.7 },
          ]}
        >
          <Text style={[styles.closePosText, closeArmed && styles.closePosTextArmed]}>
            {busy === 'close'
              ? 'Closing…'
              : closeArmed
                ? `Tap again to confirm — close $${card.token}`
                : `🔻 Close Position`}
          </Text>
        </Pressable>
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

  closePosBtn: {
    marginTop: 4,
    paddingVertical: 12, borderRadius: 14, alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: THEME.error + '55',
  },
  closePosBtnArmed: {
    backgroundColor: THEME.error,
    borderColor: THEME.error,
  },
  closePosText: {
    fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.error, letterSpacing: 0.4,
  },
  closePosTextArmed: {
    color: '#fff',
  },
});
