import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { View, FlatList, StyleSheet, Text, Pressable, ActivityIndicator, Keyboard } from 'react-native';
import { LiquidGlass as BlurView } from '@/components/LiquidGlass';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { THEME, FONTS, getWorldBarTint, getWorldAccent, surfaceToBarTint, resolveBarTint } from '@/lib/constants';
import { useThemeColor } from '@/lib/shopTheme';
import { getBlurProps } from '@/lib/glassTheme';
import { WorldLayer } from '@/components/worlds/WorldLayer';
import { getCachedProfile, useProfileVersion } from '@/lib/userProfile';
import { useGroupDm } from '@/hooks/useGroupDm';
import { MessageBubble } from '@/components/MessageBubble';
import { MessageActionSheet } from '@/components/MessageActionSheet';
import { ChatInput } from '@/components/ChatInput';
import ImageLightbox from '@/components/ImageLightbox';
import { useAppStore } from '@/store/appStore';
import type { ChatMessage, ReactionEmoji } from '@/types';
import { isMineInbox } from '@/lib/inboxLinking';

export default function GroupDmScreen({ groupId }: { groupId: string }) {
  const insets = useSafeAreaInsets();
  const { myInboxId, shopStyles, themeOverrides } = useAppStore();
  const worldId = shopStyles?.worldId as string | undefined;
  const hasThemeOverride = !!themeOverrides;
  const { messages, loading, error, sending, send, sendTyping, typingUsers } = useGroupDm(groupId);
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [actionSheetTarget, setActionSheetTarget] = useState<ChatMessage | null>(null);
  // Same fix as DmScreen/ChatScreen — windowSoftInputMode="adjustResize"
  // doesn't reliably reposition content under this app's edge-to-edge
  // mode, leaving the input bar hidden behind the IME. Track real keyboard
  // height and push the input row up by it directly.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  // 2026-07-30: measured height of the absolute-positioned input bar below,
  // fed into the list's bottom content padding — same pattern as ChatScreen.
  const [bottomBarHeight, setBottomBarHeight] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  useProfileVersion();
  const themeBg = useThemeColor('bg');
  const themeSurface = useThemeColor('surface');
  const themeBorder = useThemeColor('border');

  // Derive group name from members
  const groupName = useMemo(() => {
    const senders = new Set<string>();
    for (const m of messages) {
      if (!isMineInbox(m.senderAddress, myInboxId ?? '') && m.senderUsername) {
        senders.add(m.senderUsername);
      }
    }
    if (senders.size === 0) return 'Group';
    return Array.from(senders).slice(0, 3).join(', ') + (senders.size > 3 ? '...' : '');
  }, [messages, myInboxId]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    setReplyingTo(null);
    await send(text);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
  }, [inputText, send]);

  const noop = useCallback(async (_: ReactionEmoji, __: string) => {}, []);

  const handleReply = useCallback((msg: ChatMessage) => {
    setReplyingTo(msg);
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }, worldId ? null : { backgroundColor: themeBg }]}>
      {/* 2026-08-07: static world only while Group DM is open */}
      {worldId ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <WorldLayer active={false} />
        </View>
      ) : null}

      {/* Header — always-on MonkeGlass (see DmScreen's matching fix) so
          this reads as the same chrome family as ChatHeader/BotChannelScreen/
          ChatInput instead of only blurring when a world is equipped. */}
      <View style={styles.header}>
        <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: resolveBarTint(worldId, hasThemeOverride, themeSurface, 0.20), borderBottomWidth: worldId ? 0 : 1, borderBottomColor: themeBorder }]} pointerEvents="none" />
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={[styles.backArrow, worldId ? { color: getWorldAccent(worldId) } : null]}>←</Text>
        </Pressable>
        <Text style={styles.peerName} numberOfLines={1}>{groupName}</Text>
      </View>

      {/* 2026-07-30: flex:1 region wrapping the list — the input bar below
          is now an absolute overlay (was a normal flex sibling using
          marginBottom to dodge the keyboard), which on Android left the
          layout engine unable to reflow this list, snapping the whole
          input row — camera button included — up near the header the
          instant the keyboard opened. Mirrors ChatScreen's fix. */}
      <View style={{ flex: 1 }}>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator color={THEME.accent} size="large" />
          <Text style={{ color: THEME.textMuted, fontFamily: FONTS.body, fontSize: 13 }}>
            Opening group conversation...
          </Text>
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 }}>
          <Text style={{ color: THEME.textMuted, fontFamily: FONTS.body, textAlign: 'center', fontSize: 14 }}>
            {error}
          </Text>
          <Pressable
            onPress={() => setRetryKey(k => k + 1)}
            style={{ backgroundColor: THEME.accent, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 }}
          >
            <Text style={{ color: '#fff', fontFamily: FONTS.displayMed, fontSize: 14 }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <View style={StyleSheet.absoluteFill}>
        <FlatList
          ref={flatListRef}
          style={{ flex: 1 }}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              isOwn={isMineInbox(item.senderAddress, myInboxId ?? '')}
              onReact={noop}
              onReply={handleReply}
              onOpenActions={setActionSheetTarget}
              onPressImage={setLightboxUrl}
            />
          )}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 + bottomBarHeight + keyboardHeight, flexGrow: 1, justifyContent: 'flex-end' }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          removeClippedSubviews
          maxToRenderPerBatch={15}
          windowSize={7}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 }}>
              <Text style={{ color: THEME.textMuted, fontFamily: FONTS.body, fontSize: 14 }}>
                No messages yet — say hi!
              </Text>
            </View>
          }
        />
        </View>
      )}
      </View>

      <View
        style={{ position: 'absolute', left: 0, right: 0, bottom: keyboardHeight, zIndex: 100, elevation: 100 }}
        onLayout={(e) => setBottomBarHeight(e.nativeEvent.layout.height)}
      >
        <ChatInput
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          isSending={sending}
          onTyping={sendTyping}
          typingUsers={typingUsers}
        />
        <View style={{ height: keyboardHeight > 0 ? 0 : insets.bottom }} />
      </View>
      <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      <MessageActionSheet
        target={actionSheetTarget}
        onClose={() => setActionSheetTarget(null)}
        myAddress={myInboxId ?? ''}
        isGroupAdmin={false}
        onReact={noop}
        onReply={handleReply}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    overflow: 'hidden',
  },
  backBtn: { padding: 4 },
  backArrow: { fontSize: 22, color: THEME.text },
  peerName: { fontFamily: FONTS.displayMed, fontSize: 17, color: THEME.text, flex: 1 },
});
