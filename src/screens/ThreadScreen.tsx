/**
 * ThreadScreen — displays a thread of replies to a specific message.
 * Opens from ChatScreen when user taps "N replies" on a message.
 *
 * Route: /thread?parentId=<id>&parentContent=<content>&parentSender=<sender>
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  ListRenderItem,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { THEME, FONTS } from '@/lib/constants';
import { useAppStore } from '@/store/appStore';
import { useChatStore } from '@/store/chatStore';
import { ChatInput } from '@/components/ChatInput';
import { MessageBubble } from '@/components/MessageBubble';
import type { ChatMessage, ReactionEmoji } from '@/types';
import { getThreadMeta } from '@/lib/threads';

export default function ThreadScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    parentId: string;
    parentContent: string;
    parentSender: string;
  }>();
  const { parentId, parentContent, parentSender } = params;

  const myInboxId = useAppStore(s => s.myInboxId);
  const username = useAppStore(s => s.username);
  const messages = useChatStore(s => s.messages);

  // Filter thread messages: those whose content starts with THREAD:<parentId>
  // In practice, decoded thread messages have a `threadParentId` field
  // For now, filter by replyTo.id matching parentId
  const threadMessages = messages.filter(
    m => m.replyTo?.id === parentId || m.id === parentId
  );

  const parentMessage = messages.find(m => m.id === parentId);
  const meta = getThreadMeta(parentId ?? '');
  const flatListRef = useRef<FlatList>(null);

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);

  const isOwn = useCallback(
    (msg: ChatMessage) => msg.senderAddress === myInboxId,
    [myInboxId],
  );

  const handleSend = useCallback(async () => {
    if (!inputText.trim()) return;
    setIsSending(true);
    try {
      // Thread replies are sent as regular replies to the parent message
      // The useXmtp hook's `reply` function handles this
      const { reply } = require('@/hooks/useXmtp');
      if (parentMessage) {
        await reply(parentMessage, inputText.trim());
      }
      setInputText('');
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (err) {
      console.warn('[Thread] Send failed:', err);
    } finally {
      setIsSending(false);
    }
  }, [inputText, parentMessage]);

  const renderItem: ListRenderItem<ChatMessage> = useCallback(
    ({ item }) => (
      <MessageBubble
        message={item}
        isOwn={isOwn(item)}
        onReact={() => {}}
        onReply={() => {}}
      />
    ),
    [isOwn],
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backBtn}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Thread</Text>
        <Text style={styles.headerCount}>
          {meta ? `${meta.replyCount} replies` : ''}
        </Text>
      </View>

      {/* Parent message */}
      <View style={styles.parentWrap}>
        <Text style={styles.parentSender}>{parentSender ?? 'Unknown'}</Text>
        <Text style={styles.parentContent} numberOfLines={5}>
          {parentContent}
        </Text>
        <View style={styles.divider} />
      </View>

      {/* Thread replies */}
      <FlatList
        ref={flatListRef}
        data={threadMessages.filter(m => m.id !== parentId)}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            No replies yet. Start the conversation!
          </Text>
        }
      />

      {/* Input */}
      <View style={{ paddingBottom: insets.bottom }}>
        <ChatInput
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          isSending={isSending}
          replyingTo={null}
          onCancelReply={() => {}}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  backBtn: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    color: '#0096C7',
  },
  headerTitle: {
    fontFamily: FONTS.mono,
    fontSize: 16,
    fontWeight: '700',
    color: THEME.text,
    marginLeft: 12,
    flex: 1,
  },
  headerCount: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textMuted,
  },
  parentWrap: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: THEME.surface,
  },
  parentSender: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    fontWeight: '700',
    color: '#0096C7',
    marginBottom: 4,
  },
  parentContent: {
    fontFamily: FONTS.mono,
    fontSize: 13,
    color: THEME.text,
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: THEME.border,
    marginTop: 12,
  },
  list: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  emptyText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: THEME.textMuted,
    textAlign: 'center',
    paddingVertical: 40,
  },
});
