import React, { useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
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
  onOpenActions: (msg: ChatMessage) => void;
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
  if (c.startsWith("BANANA_BET_PILL:")) return "bananabet";
  if (c.startsWith("BANANA_BET_SETTLED_PILL:")) return "bananabetsettled";
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
    onOpenActions,
    handleRefreshChat,
    loadOlderMessages,
    setShowScrollFab,
    setUnreadWhileScrolled,
    isNearBottomRef,
  } = props;

  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

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
              onOpenActions={onOpenActions}
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
    [myAddress, isGroupAdmin, handleReact, setReplyingTo, onOpenActions, handlePressUser, handleTip, handleStickerReact, setVideoLightboxUrl, handleEditMessage, handleDelete, handlePin, handleThread, initialMsgIdsRef, setLightboxUrl, setChartSymbol]
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);
  const getItemType = useCallback((item: ChatMessage) => getMessageType(item), []);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      // Inverted: contentOffset.y === 0 means parked at the visual bottom
      // (newest messages). Distance from bottom is just contentOffset.y.
      const nearBottom = e.nativeEvent.contentOffset.y <= SCROLL_THRESHOLD;
      isNearBottomRef.current = nearBottom;
      setShowScrollFab(!nearBottom);
      if (nearBottom) setUnreadWhileScrolled(0);
    },
    [isNearBottomRef, setShowScrollFab, setUnreadWhileScrolled]
  );

  return (
    // flex:1 + minHeight:0 give FlashList v2 a constrained parent to
    // virtualize against — without it the list collapses to ~0 height.
    <View style={{ flex: 1, minHeight: 0 }}>
      <FlashList
        ref={flatListRef}
        data={messages}
        extraData={reactionVersion}
        renderItem={renderMessage as any}
        keyExtractor={keyExtractor}
        getItemType={getItemType as any}
        contentContainerStyle={styles.listContent}
        inverted
        refreshing={refreshingChat}
        onRefresh={handleRefreshChat}
        onEndReached={loadOlderMessages}
        onEndReachedThreshold={0.3}
        ListFooterComponent={isLoadingHistory ? (
          <View style={{ paddingVertical: 16, alignItems: 'center' }}>
            <ActivityIndicator color={THEME.accent} size="small" />
            <Text style={{ fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint, marginTop: 4 }}>Loading older messages…</Text>
          </View>
        ) : null}
        onScroll={handleScroll}
        scrollEventThrottle={200}
      />
    </View>
  );
});

export const ChatMessageList = React.memo(ChatMessageListInner);

const styles = StyleSheet.create({
  listContent: {
    paddingVertical: 8,
  },
});
