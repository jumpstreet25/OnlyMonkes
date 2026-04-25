import React, { useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Swipeable } from "react-native-gesture-handler";
import Animated, { FadeInDown } from "react-native-reanimated";
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
  reactionVersion: number;
  myAddress: string;
  isGroupAdmin: boolean;
  isLoadingHistory: boolean;
  refreshingChat: boolean;
  initialMsgIdsRef: React.MutableRefObject<Set<string>>;
  flatListRef: React.RefObject<FlatList | null>;

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

const ChatMessageListInner = React.forwardRef<FlatList, ChatMessageListProps>(function ChatMessageListInner(props, _ref) {
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

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isNew = !initialMsgIdsRef.current.has(item.id);
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

  const handleContentSizeChange = useCallback(() => {
    if (isNearBottomRef.current) {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [flatListRef, isNearBottomRef]);

  return (
    <FlatList
      ref={flatListRef as any}
      data={messages}
      extraData={reactionVersion}
      renderItem={renderMessage as any}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.listContent}
      inverted
      windowSize={5}
      maxToRenderPerBatch={10}
      removeClippedSubviews={false}
      onContentSizeChange={handleContentSizeChange}
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
      onScroll={({ nativeEvent }: any) => {
        // Inverted list: offset 0 = newest messages (bottom of chat)
        const nearBottom = nativeEvent.contentOffset.y <= SCROLL_THRESHOLD;
        isNearBottomRef.current = nearBottom;
        setShowScrollFab(!nearBottom);
        if (nearBottom) setUnreadWhileScrolled(0);
      }}
      scrollEventThrottle={200}
    />
  );
});

export const ChatMessageList = React.memo(ChatMessageListInner);

const styles = StyleSheet.create({
  listContent: {
    paddingVertical: 8,
  },
});
