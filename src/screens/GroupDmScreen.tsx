import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { View, FlatList, StyleSheet, Text, Pressable, ActivityIndicator, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { THEME, FONTS } from '@/lib/constants';
import { useThemeColor } from '@/lib/shopTheme';
import { getCachedProfile, useProfileVersion } from '@/lib/userProfile';
import { useGroupDm } from '@/hooks/useGroupDm';
import { MessageBubble } from '@/components/MessageBubble';
import { MessageActionSheet } from '@/components/MessageActionSheet';
import { ChatInput } from '@/components/ChatInput';
import ImageLightbox from '@/components/ImageLightbox';
import { useAppStore } from '@/store/appStore';
import type { ChatMessage, ReactionEmoji } from '@/types';

export default function GroupDmScreen({ groupId }: { groupId: string }) {
  const insets = useSafeAreaInsets();
  const { myInboxId } = useAppStore();
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
  const flatListRef = useRef<FlatList>(null);
  useProfileVersion();
  const themeBg = useThemeColor('bg');
  const themeBorder = useThemeColor('border');

  // Derive group name from members
  const groupName = useMemo(() => {
    const senders = new Set<string>();
    for (const m of messages) {
      if (m.senderAddress !== myInboxId && m.senderUsername) {
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
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: themeBg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: themeBorder }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.peerName} numberOfLines={1}>{groupName}</Text>
      </View>

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
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              isOwn={item.senderAddress === myInboxId}
              onReact={noop}
              onReply={handleReply}
              onOpenActions={setActionSheetTarget}
              onPressImage={setLightboxUrl}
            />
          )}
          contentContainerStyle={{ paddingVertical: 8, flexGrow: 1, justifyContent: 'flex-end' }}
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
      )}

      <View style={{ marginBottom: keyboardHeight }}>
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
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  backBtn: { padding: 4 },
  backArrow: { fontSize: 22, color: THEME.text },
  peerName: { fontFamily: FONTS.displayMed, fontSize: 17, color: THEME.text, flex: 1 },
});
