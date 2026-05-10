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
import { OpenTradeCardMessage } from '@/components/OpenTradeCardMessage';
import { PortfolioMiniCard } from '@/components/PortfolioMiniCard';
import { PortfolioResponseBubble } from '@/components/PortfolioResponseBubble';
import { LivePnLCardModal } from '@/components/LivePnLCardModal';
import type { ClosedTrade, OpenTrade } from '@/lib/positions';
import type { PortfolioCard, PortfolioResponse } from '@/store/tradesStore';
import type { ChatMessage, ReactionEmoji } from '@/types';

type FeedItem =
  | { kind: 'msg'; key: string; ts: number; msg: ChatMessage }
  | { kind: 'trade'; key: string; ts: number; trade: ClosedTrade }
  | { kind: 'open'; key: string; ts: number; openTrade: OpenTrade }
  | { kind: 'portfolio'; key: string; ts: number; card: PortfolioCard }
  | { kind: 'portfolio_response'; key: string; ts: number; response: PortfolioResponse };

export default function DmScreen({ peerInboxId }: { peerInboxId: string }) {
  const insets = useSafeAreaInsets();
  const { myInboxId } = useAppStore();
  const [retryKey, setRetryKey] = useState(0);
  const { messages, loading, error, sending, send, sendTyping, typingUsers } = useDm(peerInboxId);
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [activeTradeCard, setActiveTradeCard] = useState<ClosedTrade | null>(null);
  const [activeLiveCard, setActiveLiveCard] = useState<PortfolioCard | null>(null);
  const flatListRef = useRef<FlatList<FeedItem>>(null);
  useProfileVersion();
  const peerProfile = getCachedProfile(peerInboxId);
  const peerName = peerProfile?.username ?? 'Monke';
  const isBotDm = BOT_INBOX_IDS.includes(peerInboxId);
  const closedTrades = useTradesStore(s => s.closedTrades);
  const openTrades = useTradesStore(s => s.openTrades);
  const portfolioCards = useTradesStore(s => s.portfolioCards);
  const portfolioResponse = useTradesStore(s => s.portfolioResponse);
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

  // Merged feed: regular messages + synthetic PnL trade cards (closed) and
  // OpenTrade cards (active AutonoMonke positions). Both card types only
  // appear in the bot DM thread. Open cards self-prune from the store when
  // their matching TRADE_CLOSED arrives, so a position naturally transitions
  // open card → closed PnL card without overlap.
  const feed: FeedItem[] = useMemo(() => {
    const msgItems: FeedItem[] = messages.map(m => ({
      kind: 'msg', key: m.id, ts: m.sentAt.getTime(), msg: m,
    }));
    if (!isBotDm) return msgItems;
    const closedItems: FeedItem[] = closedTrades.map(t => ({
      kind: 'trade', key: `trade-${t.id}`, ts: t.closedAt, trade: t,
    }));
    const openItems: FeedItem[] = openTrades.map(o => ({
      kind: 'open', key: `open-${o.id}`, ts: o.openedAt, openTrade: o,
    }));
    const portfolioItems: FeedItem[] = portfolioCards.map(c => ({
      kind: 'portfolio', key: `pf-${c.positionId}`, ts: c.ts, card: c,
    }));
    // The composite portfolio response — only one at a time, latest from /portfolio.
    // Renders as a single rich bubble (header + positions with sparklines).
    const portfolioResponseItems: FeedItem[] = portfolioResponse
      ? [{ kind: 'portfolio_response', key: `pr-${portfolioResponse.ts}`, ts: portfolioResponse.ts, response: portfolioResponse }]
      : [];
    return [...msgItems, ...closedItems, ...openItems, ...portfolioItems, ...portfolioResponseItems].sort((a, b) => a.ts - b.ts);
  }, [messages, closedTrades, openTrades, portfolioCards, portfolioResponse, isBotDm]);

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
            if (item.kind === 'open') {
              return <OpenTradeCardMessage trade={item.openTrade} />;
            }
            if (item.kind === 'portfolio') {
              return <PortfolioMiniCard card={item.card} onPress={setActiveLiveCard} />;
            }
            if (item.kind === 'portfolio_response') {
              return (
                <PortfolioResponseBubble
                  response={item.response}
                  onPressPosition={setActiveLiveCard}
                  onPressClosedTrade={setActiveTradeCard}
                />
              );
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
      <LivePnLCardModal
        card={activeLiveCard}
        visible={!!activeLiveCard}
        onClose={() => setActiveLiveCard(null)}
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
