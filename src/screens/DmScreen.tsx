import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, Text, Pressable, ActivityIndicator, Keyboard } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { THEME, FONTS, BOT_INBOX_IDS, getWorldBarTint, getWorldAccent, surfaceToBarTint } from '@/lib/constants';
import { useThemeColor } from '@/lib/shopTheme';
import { getBlurProps } from '@/lib/glassTheme';
import { WorldLayer } from '@/components/worlds/WorldLayer';
import { BotCommandTicker } from '@/components/BotCommandTicker';
import { getCachedProfile, useProfileVersion } from '@/lib/userProfile';
import { useDm } from '@/hooks/useDm';
import { MessageBubble } from '@/components/MessageBubble';
import { MessageActionSheet } from '@/components/MessageActionSheet';
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
import { isMineInbox } from '@/lib/inboxLinking';

type FeedItem =
  | { kind: 'msg'; key: string; ts: number; msg: ChatMessage }
  | { kind: 'trade'; key: string; ts: number; trade: ClosedTrade }
  | { kind: 'open'; key: string; ts: number; openTrade: OpenTrade }
  | { kind: 'portfolio'; key: string; ts: number; card: PortfolioCard }
  | { kind: 'portfolio_response'; key: string; ts: number; response: PortfolioResponse };

export default function DmScreen({ peerInboxId }: { peerInboxId: string }) {
  const insets = useSafeAreaInsets();
  const { myInboxId, shopStyles } = useAppStore();
  const worldId = shopStyles?.worldId as string | undefined;
  const [retryKey, setRetryKey] = useState(0);
  const { messages, loading, error, sending, send, react, sendTyping, typingUsers } = useDm(peerInboxId);
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [activeTradeCard, setActiveTradeCard] = useState<ClosedTrade | null>(null);
  const [activeLiveCard, setActiveLiveCard] = useState<PortfolioCard | null>(null);
  const [actionSheetTarget, setActionSheetTarget] = useState<ChatMessage | null>(null);
  // windowSoftInputMode="adjustResize" doesn't reliably reposition content
  // under this app's edge-to-edge/immersive mode — same root cause already
  // found and fixed on Main Chat (ChatScreen.tsx), where the input bar
  // rendered fully hidden behind the IME. Tracking real keyboard height
  // directly and using it to push the input row up is the robust fix
  // regardless of what adjustResize does.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // 2026-07-30: measured height of the absolute-positioned input bar below,
  // fed back into the list's content padding — same pattern as ChatScreen's
  // bottomBarHeight/bottomInset.
  const [bottomBarHeight, setBottomBarHeight] = useState(0);
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
  const flatListRef = useRef<FlashListRef<FeedItem>>(null);
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
    // Inverted list — newest sits at the bottom of the screen, which is
    // offset 0 in the scroll coordinate space.
    setTimeout(() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }), 50);
  }, [inputText, send]);

  const handleReact = useCallback(async (emoji: ReactionEmoji, messageId: string) => {
    try {
      await react(emoji, messageId);
    } catch (err) {
      if (__DEV__) console.warn('[DmScreen] Reaction failed:', err);
    }
  }, [react]);

  const handleReply = useCallback((msg: ChatMessage) => {
    setReplyingTo(msg);
  }, []);

  // Find the ID of the last own message that was read by the peer
  const lastReadOwnId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (isMineInbox(m.senderAddress, myInboxId ?? '') && m.status === 'read') return m.id;
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

  // Inverted FlashList wants newest-first: index 0 renders at the bottom of
  // the screen (where the user lands), older items scroll up off-screen.
  const feedInverted = useMemo(() => feed.slice().reverse(), [feed]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }, worldId ? null : { backgroundColor: themeBg }]}>
      {/* 2026-08-06: equipped world behind DM chrome.
          2026-08-07: active=false — static plate only; pause waterfall/rain
          etc. while any DM is open (same for Menu/Shop). */}
      {worldId ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <WorldLayer active={false} />
        </View>
      ) : null}

      {/* Header — always-on MonkeGlass now (was blur-only when a world is
          equipped, flat opaque themeBg otherwise) — matches ChatHeader/
          BotChannelScreen/ChatInput, which all blur regardless of world so
          the header/input-bar chrome reads as one consistent family across
          every screen, not just world-equipped ones. */}
      <View style={styles.header}>
        <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: worldId ? getWorldBarTint(worldId) : surfaceToBarTint(themeSurface, 0.20), borderBottomWidth: worldId ? 0 : 1, borderBottomColor: themeBorder }]} pointerEvents="none" />
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={[styles.backArrow, worldId ? { color: getWorldAccent(worldId) } : null]}>←</Text>
        </Pressable>
        <Text style={styles.peerName}>{peerName}</Text>
      </View>

      {isBotDm && <BotCommandTicker variant="dm" />}

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
        <View style={StyleSheet.absoluteFill}>
        <FlashList
          ref={flatListRef}
          style={{ flex: 1 }}
          data={feedInverted}
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
                  isOwn={isMineInbox(m.senderAddress, myInboxId ?? '')}
                  onReact={handleReact}
                  onReply={handleReply}
                  onOpenActions={setActionSheetTarget}
                  onPressImage={setLightboxUrl}
                />
                {m.id === lastReadOwnId && (
                  <Text style={styles.seenLabel}>Seen</Text>
                )}
              </>
            );
          }}
          // Inverted FlashList rotates the whole content 180° — declared
          // paddingTop renders at the visual BOTTOM (nearest the input bar
          // overlay), paddingBottom at the visual top (nearest the header).
          contentContainerStyle={{ paddingTop: 8 + bottomBarHeight + keyboardHeight, paddingBottom: 8 }}
          inverted
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 }}>
              <Text style={{ color: THEME.textDim, fontFamily: FONTS.body, fontSize: 14 }}>
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
          isDmWithBot={isBotDm}
          onTyping={sendTyping}
          typingUsers={typingUsers}
        />
        <View style={{ height: keyboardHeight > 0 ? 0 : insets.bottom }} />
      </View>
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
      <MessageActionSheet
        target={actionSheetTarget}
        onClose={() => setActionSheetTarget(null)}
        myAddress={myInboxId ?? ''}
        isGroupAdmin={false}
        onReact={handleReact}
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
