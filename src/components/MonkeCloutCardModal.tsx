import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions, Image } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { toast } from 'sonner-native';
import { THEME, FONTS } from '@/lib/constants';
import { GlassBottomSheet } from '@/components/GlassBottomSheet';
import { MonkeCloutCard } from '@/components/MonkeCloutCard';
import { shareImageToX } from '@/lib/shareToX';
import type { CloutProfile } from '@/lib/monkeClout';
import { useXmtp } from '@/hooks/useXmtp';

const getViewShot = () => import('react-native-view-shot');
const getMediaLibrary = () => import('expo-media-library');
const getFileSystem = () => import('expo-file-system');
const getImageManipulator = () => import('expo-image-manipulator');

interface MonkeCloutCardModalProps {
  profile: CloutProfile | null;
  visible: boolean;
  onClose: () => void;
}

const HANDLE = '@xOnlyMonkes';
const HASHTAGS = '#OnlyMonkes #SagaMonkes #SolanaMobile';

// Varied by standing — top-3 (flair) gets the cockiest lines, everyone else
// gets grind/come-up energy instead of a flat repeated caption.
const TOP3_LINES = [
  `Top 3 on the MonkeClout leaderboard. Come dethrone me if you can 🐒👑`,
  `Alpha Ape status confirmed. The jungle knows who's real 🐒🔥`,
  `Living at the top of MonkeClout. Rent-free 🐒👑`,
];
const MID_LINES = [
  `Grinding up the MonkeClout leaderboard, one banana at a time 🍌📈`,
  `Clout don't lie. Watch me climb 🐒📈`,
  `Building my Monke Clout — the come-up is real 🍌🐒`,
];
const NEW_LINES = [
  `Just started my MonkeClout journey. Watch this space 🐒🌱`,
  `New Monke, new grind. Clout incoming 🍌`,
];

function pickCaption(profile: CloutProfile): string {
  const pool = profile.flair ? TOP3_LINES : profile.rank <= 20 ? MID_LINES : NEW_LINES;
  const line = pool[Math.floor(Math.random() * pool.length)];
  return `${line}\n\nClout Score: ${profile.cloutScore} on ${HANDLE}\n\n${HASHTAGS}`;
}

export function MonkeCloutCardModal({ profile, visible, onClose }: MonkeCloutCardModalProps) {
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState<null | 'save' | 'copy' | 'x' | 'chat' | 'both'>(null);
  const { send } = useXmtp();

  const screenW = Dimensions.get('window').width;
  const cardWidth = Math.min(screenW - 48, 360);

  const captureCard = useCallback(async (): Promise<string> => {
    const { captureRef } = await getViewShot();
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
    const IM = await getImageManipulator();
    const resized = await IM.manipulateAsync(uri, [{ resize: { width: 540 } }], {
      compress: 0.7,
      format: IM.SaveFormat.JPEG,
    });
    const FS = await getFileSystem();
    const b64 = await FS.readAsStringAsync(resized.uri, { encoding: FS.EncodingType.Base64 });
    const payload = `IMAGE:data:image/jpeg;base64,${b64}`;

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
  }, [send]);

  const handleSave = useCallback(async () => {
    if (!profile || busy) return;
    setBusy('save');
    try {
      const ML = await getMediaLibrary();
      const { status } = await ML.requestPermissionsAsync();
      if (status !== 'granted') {
        toast.error('Allow gallery access to save the card.');
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
  }, [profile, busy, captureCard]);

  const handleCopy = useCallback(async () => {
    if (!profile || busy) return;
    setBusy('copy');
    try {
      await Clipboard.setStringAsync(pickCaption(profile));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      toast.success('Caption copied');
    } catch (e: any) {
      toast.error(e?.message ?? 'Copy failed');
    } finally {
      setBusy(null);
    }
  }, [profile, busy]);

  const handleShareX = useCallback(async () => {
    if (!profile || busy) return;
    setBusy('x');
    try {
      const uri = await captureCard();
      const compressed = await compressForShare(uri);
      const { saved } = await shareImageToX(compressed, pickCaption(profile));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (saved) toast.success('Image saved — tap the image icon in X to attach it 📸');
    } catch (e: any) {
      if (e?.message && !/dismiss/i.test(e.message)) toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }, [profile, busy, captureCard, compressForShare]);

  const handleShareMainChat = useCallback(async () => {
    if (!profile || busy) return;
    setBusy('chat');
    try {
      const uri = await captureCard();
      await sendToMainChat(uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => toast.success('Posted to Main Chat'), 350);
    } catch (e: any) {
      toast.error(e?.message ?? 'Post failed');
    } finally {
      setBusy(null);
    }
  }, [profile, busy, captureCard, sendToMainChat]);

  const handleShareBoth = useCallback(async () => {
    if (!profile || busy) return;
    setBusy('both');
    try {
      const uri = await captureCard();
      await sendToMainChat(uri);
      const compressed = await compressForShare(uri);
      const { saved } = await shareImageToX(compressed, pickCaption(profile));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => toast.success(saved ? 'Posted to Main Chat — image saved for X too 📸' : 'Posted to Main Chat'), 350);
    } catch (e: any) {
      if (e?.message && !/dismiss/i.test(e.message)) toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }, [profile, busy, captureCard, compressForShare, sendToMainChat]);

  if (!profile) return null;

  return (
    <GlassBottomSheet visible={visible} onClose={onClose} snapPoints={['65%', '95%']}>
      <View style={styles.contentGap}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Share Your Clout</Text>
          <View style={styles.headerRight}>
            <Image
              source={require('../../assets/watermark.png')}
              style={styles.watermark}
              resizeMode="contain"
            />
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Text style={styles.closeIcon}>✕</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.cardWrap}>
          <MonkeCloutCard ref={cardRef} profile={profile} width={cardWidth} />
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  watermark: { width: 38, height: 14, opacity: 0.7 },
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
