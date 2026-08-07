/**
 * ThreadScreen — displays a thread of replies to a specific message.
 * Opens from ChatScreen when user taps "N replies" on a message.
 *
 * Route: /thread?parentId=<id>&parentContent=<content>&parentSender=<sender>
 */
import React, { useState, useRef, useCallback } from 'react';
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
import { BlurView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import { THEME, FONTS, getWorldBarTint, getWorldAccent } from '@/lib/constants';
import { useAppStore } from '@/store/appStore';
import { useChatStore } from '@/store/chatStore';
import { getBlurProps, GLASS_CHROME_BG } from '@/lib/glassTheme';
import { WorldLayer } from '@/components/worlds/WorldLayer';
import { ChatInput } from '@/components/ChatInput';
import { MessageBubble } from '@/components/MessageBubble';
import { MessageActionSheet } from '@/components/MessageActionSheet';
import type { ChatMessage } from '@/types';
import { isMineInbox } from '@/lib/inboxLinking';
import { getThreadMeta, buildThreadMessage, trackThreadReply } from '@/lib/threads';
import { sendRawToGroup } from '@/hooks/useXmtp';

export default function ThreadScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    parentId: string;
    parentContent: string;
    parentSender: string;
  }>();
  const { parentId, parentContent, parentSender } = params;

  const myInboxId = useAppStore(s => s.myInboxId);
  const username = useAppStore(s => s.username) ?? 'Anon';
  const verifiedNft = useAppStore(s => s.verifiedNft);
  const worldId = useAppStore(s => s.shopStyles?.worldId) as string | undefined;

  // Thread replies from dedicated store (populated by useXmtp on THREAD: receipt)
  const threadReplies = useChatStore(s => s.threadMessages[parentId ?? ''] ?? []);
  const addThreadMessage = useChatStore(s => s.addThreadMessage);
  const meta = getThreadMeta(parentId ?? '');
  const flatListRef = useRef<FlatList>(null);

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [actionSheetTarget, setActionSheetTarget] = useState<ChatMessage | null>(null);

  const isOwn = useCallback(
    (msg: ChatMessage) => isMineInbox(msg.senderAddress, myInboxId ?? ''),
    [myInboxId],
  );

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || !parentId) return;
    setIsSending(true);
    try {
      const text = inputText.trim();
      const raw = buildThreadMessage(parentId, username, text);
      await sendRawToGroup(raw);

      // Optimistic local insert
      const optMsg: ChatMessage = {
        id: `opt-thread-${Date.now()}`,
        senderAddress: myInboxId ?? '',
        senderUsername: username,
        senderNft: verifiedNft ? { mint: verifiedNft.mint, name: verifiedNft.name, image: verifiedNft.image } : undefined,
        content: text,
        sentAt: new Date(),
        reactions: {},
        status: 'sent',
      };
      addThreadMessage(parentId, optMsg);
      trackThreadReply(parentId, myInboxId ?? '', parentContent, parentSender);

      setInputText('');
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (err) {
      console.warn('[Thread] Send failed:', err);
    } finally {
      setIsSending(false);
    }
  }, [inputText, parentId, username, myInboxId, verifiedNft, parentContent, parentSender, addThreadMessage]);

  const renderItem: ListRenderItem<ChatMessage> = useCallback(
    ({ item }) => (
      <MessageBubble
        message={item}
        isOwn={isOwn(item)}
        onReact={() => {}}
        onReply={() => {}}
        onOpenActions={setActionSheetTarget}
      />
    ),
    [isOwn],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, worldId ? { backgroundColor: 'transparent' } : null]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
    >
      {worldId ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <WorldLayer active={true} />
        </View>
      ) : null}

      {/* Header — always-on MonkeGlass (was blur-only when a world is
          equipped, fully transparent otherwise) — matches ChatHeader/
          BotChannelScreen/ChatInput/DmScreen/GroupDmScreen. */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }, worldId ? { borderBottomWidth: 0 } : null]}>
        <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: worldId ? getWorldBarTint(worldId) : GLASS_CHROME_BG }]} pointerEvents="none" />
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.backBtn, worldId ? { color: getWorldAccent(worldId) } : null]}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Thread</Text>
        <Text style={styles.headerCount}>
          {meta ? `${meta.replyCount} replies` : ''}
        </Text>
      </View>

      {/* Parent message */}
      <View style={[styles.parentWrap, worldId ? { backgroundColor: 'transparent' } : null]}>
        {worldId ? (
          <>
            <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} pointerEvents="none" />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: getWorldBarTint(worldId) }]} pointerEvents="none" />
          </>
        ) : null}
        <Text style={styles.parentSender}>{parentSender ?? 'Unknown'}</Text>
        <Text style={styles.parentContent} numberOfLines={5}>
          {parentContent}
        </Text>
        <View style={styles.divider} />
      </View>

      {/* Thread replies */}
      <FlatList
        ref={flatListRef}
        data={threadReplies}
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
      <MessageActionSheet
        target={actionSheetTarget}
        onClose={() => setActionSheetTarget(null)}
        myAddress={myInboxId ?? ''}
        isGroupAdmin={false}
        onReact={() => {}}
        onReply={() => {}}
      />
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
