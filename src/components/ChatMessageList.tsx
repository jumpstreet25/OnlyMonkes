import React, { useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  type ScrollView as ScrollViewType,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
// 2026-05-23 DIAGNOSTIC: swapped to plain ScrollView + .map(). Both FlashList
// v2 and FlatList showed identical flash-on-swipe-toward-older-messages on
// v2.38 APK. ScrollView has zero virtualization — every cell is mounted at
// all times. If the flash persists with this, the list isn't the cause at
// all and we look at Reanimated cell wrappers or Skia surfaces.
// Type alias kept so callers passing list-typed refs don't break.
type FlashListRef<T> = ScrollViewType;
import { Swipeable } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { THEME, FONTS } from "@/lib/constants";
import { MessageBubble } from "@/components/MessageBubble";
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { ProfileTarget } from "@/components/UserProfileModal";

/** Swipe-to-reply wrapper — swipe right reveals reply arrow, triggers onReply */
function SwipeReplyAction() {
  return (
    <View style={{ width: 50, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ fontSize: 18, color: THEME.textDim ?? "#888" }}>↩</Text>
    </View>
  );
}

export interface ChatMessageListProps {
  messages: ChatMessage[];
  /**
   * Bumped every time applyReactionUpdate fires (emoji react / sticker react /
   * edit). Passed to FlashList as `extraData` so the recycler invalidates
   * visible cells and re-runs renderItem. React.memo on MessageBubble still
   * bails per cell on message-ref equality, so unaffected cells are cheap
   * no-ops; only the cell whose message actually changed re-paints.
   */
  reactionVersion: number;
  myAddress: string;
  isGroupAdmin: boolean;
  isLoadingHistory: boolean;
  refreshingChat: boolean;
  initialMsgIdsRef: React.MutableRefObject<Set<string>>;
  flatListRef: React.RefObject<FlashListRef<ChatMessage> | null>;

  // Callbacks
  handleReact: (emoji: ReactionEmoji, messageId: string) => void;
  setReplyingTo: (msg: ChatMessage | null) => void;
  handlePressUser: (target: ProfileTarget) => void;
  handleTip: (msg: ChatMessage) => void;
  handleStickerReact: (url: string, messageId: string) => void;
  setLightboxUrl: (url: string | null) => void;
  setVideoLightboxUrl: (url: string | null) => void;
  setChartSymbol: (symbol: string | null) => void;
  handleEditMessage: (msg: ChatMessage) => void;
  handleDelete: (msg: ChatMessage) => void;
  handlePin: ((msg: ChatMessage) => void) | undefined;
  handleThread: (msg: ChatMessage) => void;
  handleRefreshChat: () => void;
  loadOlderMessages: () => void;

  // Scroll state
  setShowScrollFab: (v: boolean) => void;
  setUnreadWhileScrolled: (v: number) => void;
  isNearBottomRef: React.MutableRefObject<boolean>;
}

const SCROLL_THRESHOLD = 270; // ~3 message heights

/**
 * Bucket each message into a coarse content type so FlashList only recycles
 * cells of the same shape. Without this, the recycler reuses a tall video
 * cell for a one-line text message (or vice-versa) and items can render at
 * the wrong position or get skipped — which is what was making other users'
 * messages "go missing" on FlashList specifically.
 */
function getMessageType(item: ChatMessage): string {
  const c = item.content;
  if (c.startsWith("LIVE_PILL:")) return "pill";
  if (c.startsWith("VIDEO:")) return "video";
  if (c.startsWith("IMAGE:")) return "image";
  if (c.startsWith("GIF:")) return "gif";
  if (c.startsWith("STICKER:")) return "sticker";
  if (c.startsWith("ATTACHMENT:")) return "attachment";
  if (c.startsWith("TIPLINK:")) return "tiplink";
  if (c.startsWith("NFT_LIST:")) return "nftlist";
  return "text";
}

const ChatMessageListInner = React.forwardRef<FlashListRef<ChatMessage>, ChatMessageListProps>(function ChatMessageListInner(props, _ref) {
  const {
    messages,
    reactionVersion,
    myAddress,
    isGroupAdmin,
    isLoadingHistory,
    refreshingChat,
    initialMsgIdsRef,
    flatListRef,
    handleReact,
    setReplyingTo,
    handlePressUser,
    handleTip,
    handleStickerReact,
    setLightboxUrl,
    setVideoLightboxUrl,
    setChartSymbol,
    handleEditMessage,
    handleDelete,
    handlePin,
    handleThread,
    handleRefreshChat,
    loadOlderMessages,
    setShowScrollFab,
    setUnreadWhileScrolled,
    isNearBottomRef,
  } = props;

  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  // Shim: callers use FlashList/FlatList imperative API (scrollToOffset,
  // scrollToIndex). ScrollView only has scrollTo. We expose the same methods
  // on the passed-in ref so consumers (ChatScreen + others) keep working.
  // offset=0 in inverted-FlatList meant "scroll to newest". In our oldest-
  // first ScrollView, newest is at the bottom (content size), so map
  // offset=0 → scroll to content end.
  const scrollViewRef = useRef<ScrollViewType | null>(null);
  const contentHeightRef = useRef(0);
  React.useEffect(() => {
    const ref = flatListRef as any;
    if (!ref) return;
    ref.current = {
      scrollToOffset: ({ offset, animated }: { offset: number; animated?: boolean }) => {
        if (offset === 0) {
          scrollViewRef.current?.scrollTo({ y: contentHeightRef.current, animated: !!animated });
        } else {
          scrollViewRef.current?.scrollTo({ y: contentHeightRef.current - offset, animated: !!animated });
        }
      },
      scrollToIndex: ({ index, animated }: { index: number; animated?: boolean }) => {
        // Approximate: each row ~80px. Index counts from newest. Convert.
        const fromBottom = index * 80;
        scrollViewRef.current?.scrollTo({ y: contentHeightRef.current - fromBottom, animated: !!animated });
      },
      scrollToEnd: ({ animated }: { animated?: boolean } = {}) => {
        scrollViewRef.current?.scrollTo({ y: contentHeightRef.current, animated: !!animated });
      },
    } as any;
  }, [flatListRef]);

  const renderMessage = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      // A message is "new" only on its very first render in this session
      // — i.e. before the initialMsgIdsRef set has it. The set is pre-
      // seeded after history loads, so historical messages are never
      // flagged new. Used by MessageBubble to drive the float-in entry.
      const isNew = !initialMsgIdsRef.current.has(item.id);
      if (isNew) initialMsgIdsRef.current.add(item.id);
      // FlashList is `inverted` with newest-first data, so index === 0 is the
      // bottommost (newest) message visually. Banana Grove world reads the
      // latest bubble's measured height to decide when its growing pile
      // should reset (so the pile never visually overlaps this message).
      const isLatest = index === 0;
      return (
        <Swipeable
          ref={(ref) => {
            if (ref) swipeableRefs.current.set(item.id, ref);
            else swipeableRefs.current.delete(item.id);
          }}
          renderLeftActions={() => <SwipeReplyAction />}
          onSwipeableOpen={(direction) => {
            if (direction === "left") {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setReplyingTo(item);
            }
            const ref = swipeableRefs.current.get(item.id);
            ref?.close();
          }}
          overshootLeft={false}
          leftThreshold={40}
          friction={2}
          containerStyle={{ overflow: "visible" }}
        >
          <View>
            <MessageBubble
              message={item}
              isOwn={item.senderAddress === myAddress}
              isLatest={isLatest}
              isNew={isNew}
              onReact={handleReact}
              onReply={setReplyingTo}
              onPressUser={handlePressUser}
              onTip={handleTip}
              onStickerReact={handleStickerReact}
              onPressImage={setLightboxUrl}
              onPressVideo={setVideoLightboxUrl}
              onTokenPress={setChartSymbol}
              onEdit={handleEditMessage}
              onDelete={handleDelete}
              onPin={isGroupAdmin ? handlePin : undefined}
              onThread={handleThread}
              isGroupAdmin={isGroupAdmin}
            />
          </View>
        </Swipeable>
      );
    },
    [myAddress, isGroupAdmin, handleReact, setReplyingTo, handlePressUser, handleTip, handleStickerReact, setVideoLightboxUrl, handleEditMessage, handleDelete, handlePin, handleThread, initialMsgIdsRef, setLightboxUrl, setChartSymbol]
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);
  const getItemType = useCallback((item: ChatMessage) => getMessageType(item), []);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      // ScrollView (non-inverted): newest is at the visual BOTTOM. Distance
      // from bottom = contentSize.height - contentOffset.y - layoutHeight.
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distFromBottom = Math.max(0, contentSize.height - contentOffset.y - layoutMeasurement.height);
      const nearBottom = distFromBottom <= SCROLL_THRESHOLD;
      isNearBottomRef.current = nearBottom;
      setShowScrollFab(!nearBottom);
      if (nearBottom) setUnreadWhileScrolled(0);
    },
    [isNearBottomRef, setShowScrollFab, setUnreadWhileScrolled]
  );

  // 2026-05-23 DIAGNOSTIC: render every message as a plain mounted child of
  // a ScrollView. No virtualization, no recycling, no FlashList/FlatList
  // window. Data is sorted newest-first, so we render in reverse (oldest
  // first → newest at the bottom of the scroll content) and SKIP `inverted`.
  // That avoids the scaleY(-1) transform that Fabric has known issues with.
  // If the flash persists with THIS, the list is not the cause at all.
  const renderedRows = React.useMemo(() => {
    const ordered = [...messages].reverse();
    return ordered.map((item, idx) => {
      // index 0 in the (newest-first) data array = newest. After reverse,
      // newest is at last index. Recompute isLatest from original ordering.
      const originalIndex = messages.length - 1 - idx;
      return (
        <View key={item.id}>
          {renderMessage({ item, index: originalIndex } as any)}
        </View>
      );
    });
  }, [messages, reactionVersion, renderMessage]);

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView
        ref={scrollViewRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshingChat} onRefresh={handleRefreshChat} />
        }
        onScroll={handleScroll}
        scrollEventThrottle={200}
        removeClippedSubviews={false}
        onContentSizeChange={(_w, h) => {
          contentHeightRef.current = h;
          // Auto-scroll to bottom (newest) when content grows AND user is
          // parked near the bottom (i.e. reading newest, not scrolled up
          // into history). Skip if scrolled up so we don't yank them.
          if (isNearBottomRef.current) {
            scrollViewRef.current?.scrollTo({ y: h, animated: false });
          }
        }}
      >
        {isLoadingHistory ? (
          <View style={{ paddingVertical: 16, alignItems: 'center' }}>
            <ActivityIndicator color={THEME.accent} size="small" />
            <Text style={{ fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint, marginTop: 4 }}>Loading older messages…</Text>
          </View>
        ) : null}
        {renderedRows}
      </ScrollView>
    </View>
  );
});

export const ChatMessageList = React.memo(ChatMessageListInner);

const styles = StyleSheet.create({
  listContent: {
    paddingVertical: 8,
  },
});
