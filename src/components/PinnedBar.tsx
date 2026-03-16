/**
 * PinnedBar — sticky bar at top of chat showing the latest pinned message.
 * Tap to scroll to the pinned message. Long-press to see all pinned messages.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  FlatList,
} from 'react-native';
import { THEME, FONTS } from '@/lib/constants';
import type { PinnedMessage } from '@/lib/pinnedMessages';

interface PinnedBarProps {
  pinnedMessages: PinnedMessage[];
  onScrollToMessage: (messageId: string) => void;
  onUnpin?: (messageId: string) => void;
  isAdmin?: boolean;
}

export function PinnedBar({ pinnedMessages, onScrollToMessage, onUnpin, isAdmin }: PinnedBarProps) {
  const [expanded, setExpanded] = useState(false);

  if (pinnedMessages.length === 0) return null;

  const latest = pinnedMessages[pinnedMessages.length - 1];

  return (
    <>
      <Pressable
        style={styles.bar}
        onPress={() => onScrollToMessage(latest.messageId)}
        onLongPress={() => setExpanded(true)}
      >
        <Text style={styles.pinIcon}>📌</Text>
        <View style={styles.barContent}>
          {latest.senderUsername && (
            <Text style={styles.barSender}>{latest.senderUsername}</Text>
          )}
          <Text style={styles.barText} numberOfLines={1}>
            {latest.content}
          </Text>
        </View>
        {pinnedMessages.length > 1 && (
          <Text style={styles.barCount}>{pinnedMessages.length}</Text>
        )}
      </Pressable>

      {/* All pinned messages modal */}
      <Modal
        visible={expanded}
        transparent
        animationType="slide"
        onRequestClose={() => setExpanded(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.overlay} onPress={() => setExpanded(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Pinned Messages</Text>
          <FlatList
            data={[...pinnedMessages].reverse()}
            keyExtractor={(item) => item.messageId}
            renderItem={({ item }) => (
              <Pressable
                style={styles.pinnedItem}
                onPress={() => {
                  setExpanded(false);
                  onScrollToMessage(item.messageId);
                }}
              >
                <View style={styles.pinnedContent}>
                  <Text style={styles.pinnedSender}>
                    {item.senderUsername ?? 'Unknown'}
                  </Text>
                  <Text style={styles.pinnedText} numberOfLines={3}>
                    {item.content}
                  </Text>
                </View>
                {isAdmin && onUnpin && (
                  <Pressable
                    onPress={() => onUnpin(item.messageId)}
                    style={styles.unpinBtn}
                    hitSlop={8}
                  >
                    <Text style={styles.unpinText}>Unpin</Text>
                  </Pressable>
                )}
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: THEME.surfaceHigh,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  pinIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  barContent: {
    flex: 1,
  },
  barSender: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: '#0096C7',
    fontWeight: '700',
  },
  barText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: THEME.text,
  },
  barCount: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textMuted,
    backgroundColor: THEME.surface,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
    overflow: 'hidden',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: THEME.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '60%',
    padding: 16,
  },
  sheetTitle: {
    fontFamily: FONTS.mono,
    fontSize: 16,
    fontWeight: '700',
    color: THEME.text,
    marginBottom: 12,
  },
  pinnedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  pinnedContent: {
    flex: 1,
  },
  pinnedSender: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: '#0096C7',
    fontWeight: '700',
  },
  pinnedText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: THEME.text,
    marginTop: 2,
  },
  unpinBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 6,
    marginLeft: 8,
  },
  unpinText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: '#ff4444',
    fontWeight: '700',
  },
});
