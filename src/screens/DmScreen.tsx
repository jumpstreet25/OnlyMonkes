import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { View, FlatList, StyleSheet, Text, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { THEME, FONTS, BOT_INBOX_IDS } from '@/lib/constants';
import { useThemeColor } from '@/lib/shopTheme';
import { BotCommandTicker } from '@/components/BotCommandTicker';
import { getCachedProfile, useProfileVersion } from '@/lib/userProfile';
import { useDm } from '@/hooks/useDm';
import { MessageBubble } from '@/components/MessageBubble';
import { ChatInput } from '@/components/ChatInput';
import ImageLightbox from '@/components/ImageLightbox';
import { useAppStore } from '@/store/appStore';
import { useTradesStore } from '@/store/tradesStore';
import { PnLCardMessage } from '@/components/PnLCardMessage';
import { PnLCardModal } from '@/components/PnLCardModal';
import type { ClosedTrade } from '@/lib/positions';
import type { ChatMessage, ReactionEmoji } from '@/types';

type FeedItem =
  | { kind: 'msg'; key: string; ts: number; msg: ChatMessage }
  | { kind: 'trade'; key: string; ts: number; trade: ClosedTrade };

export default function DmScreen({ peerInboxId }: { peerInboxId: string }) {
  const insets = useSafeAreaInsets();
  const { myInboxId } = useAppStore();
  const [retryKey, setRetryKey] = useState(0);
  const { messages, loading, error, sending, send, sendTyping, typingUsers } = useDm(peerInboxId);
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [activeTradeCard, setActiveTradeCard] = useState<ClosedTrade | null>(null);
  const flatListRef = useRef<FlatList<FeedItem>>(null);
  useProfileVersion();
  const peerProfile = getCachedProfile(peerInboxId);
  const peerName = peerProfile?.username ?? 'Monke';
  const isBotDm = BOT_INBOX_IDS.includes(peerInboxId);
  const closedTrades = useTradesStore(s => s.closedTrades);
  const themeBg = useThemeColor('bg');
  const themeSurface = useThemeColor('surface');
  const themeBorder = useThemeColor('border');

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

  // Find the ID of the last own message that was read by the peer
  const lastReadOwnId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.senderAddress === myInboxId && m.status === 'read') return m.id;
    }
    return null;
  }, [messages, myInboxId]);

  // Merged feed: regular messages + synthetic PnL trade cards (bot DM only).
  const feed: FeedItem[] = useMemo(() => {
    const msgItems: FeedItem[] = messages.map(m => ({
      kind: 'msg', key: m.id, ts: m.sentAt.getTime(), msg: m,
    }));
    if (!isBotDm) return msgItems;
    const tradeItems: FeedItem[] = closedTrades.map(t => ({
      kind: 'trade', key: `trade-${t.id}`, ts: t.closedAt, trade: t,
    }));
    return [...msgItems, ...tradeItems].sort((a, b) => a.ts - b.ts);
  }, [messages, closedTrades, isBotDm]);

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: themeBg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: themeBorder }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.peerName}>{peerName}</Text>
      </View>

      {isBotDm && <BotCommandTicker variant="dm" />}

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator color={THEME.accent} size="large" />
          <Text style={{ color: THEME.textDim, fontFamily: FONTS.body, fontSize: 13 }}>
            Opening conversation…
          </Text>
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 }}>
          <Text style={{ color: THEME.textDim, fontFamily: FONTS.body, textAlign: 'center', fontSize: 14 }}>
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
          data={feed}
          keyExtractor={item => item.key}
          renderItem={({ item }) => {
            if (item.kind === 'trade') {
              return <PnLCardMessage trade={item.trade} onPress={setActiveTradeCard} />;
            }
            const m = item.msg;
            return (
              <>
                <MessageBubble
                  message={m}
                  isOwn={m.senderAddress === myInboxId}
                  onReact={noop}
                  onReply={handleReply}
                  onPressImage={setLightboxUrl}
                />
                {m.id === lastReadOwnId && (
                  <Text style={styles.seenLabel}>Seen</Text>
                )}
              </>
            );
          }}
          contentContainerStyle={{ paddingVertical: 8, flexGrow: 1, justifyContent: 'flex-end' }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          removeClippedSubviews
          maxToRenderPerBatch={15}
          windowSize={7}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 }}>
              <Text style={{ color: THEME.textDim, fontFamily: FONTS.body, fontSize: 14 }}>
                No messages yet — say hi!
              </Text>
            </View>
          }
        />
      )}

      <ChatInput
        value={inputText}
        onChangeText={setInputText}
        onSend={handleSend}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        isSending={sending}
        isDmWithBot={isBotDm}
        onTyping={sendTyping}
        typingUsers={typingUsers}
      />
      <View style={{ height: insets.bottom }} />
      <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      <PnLCardModal
        trade={activeTradeCard}
        visible={!!activeTradeCard}
        onClose={() => setActiveTradeCard(null)}
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
  peerName: { fontFamily: FONTS.displayMed, fontSize: 17, color: THEME.text },
  seenLabel: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textDim,
    textAlign: 'right',
    paddingRight: 16,
    marginTop: -2,
    marginBottom: 4,
  },
});
