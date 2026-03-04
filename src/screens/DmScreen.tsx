import React, { useRef, useCallback, useState } from 'react';
import { View, FlatList, StyleSheet, Text, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { THEME, FONTS } from '@/lib/constants';
import { getCachedProfile } from '@/lib/userProfile';
import { useDm } from '@/hooks/useDm';
import { MessageBubble } from '@/components/MessageBubble';
import { ChatInput } from '@/components/ChatInput';
import { useAppStore } from '@/store/appStore';
import type { ChatMessage, ReactionEmoji } from '@/types';

export default function DmScreen({ peerInboxId }: { peerInboxId: string }) {
  const insets = useSafeAreaInsets();
  const { myInboxId } = useAppStore();
  const { messages, loading, sending, send } = useDm(peerInboxId);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const peerProfile = getCachedProfile(peerInboxId);
  const peerName = peerProfile?.username ?? peerInboxId.slice(0, 8) + '…';

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    await send(text);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
  }, [inputText, send]);

  const noop = useCallback(async (_: ReactionEmoji, __: string) => {}, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.peerName}>{peerName}</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={THEME.accent} />
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
              onReply={() => {}}
            />
          )}
          contentContainerStyle={{ paddingVertical: 8, flexGrow: 1, justifyContent: 'flex-end' }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      <ChatInput
        value={inputText}
        onChangeText={setInputText}
        onSend={handleSend}
        replyingTo={null}
        onCancelReply={() => {}}
        isSending={sending}
      />
      <View style={{ height: insets.bottom }} />
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
  peerName: { fontFamily: FONTS.displayMed, fontSize: 17, color: THEME.text },
});
