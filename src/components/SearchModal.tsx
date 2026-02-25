/**
 * SearchModal
 *
 * Full-screen chat search. Filters messages by keyword (case-insensitive).
 * Shows sender, time, and a snippet of the matched message.
 */

import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  FlatList,
  ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { format } from "date-fns";
import { THEME, FONTS } from "@/lib/constants";
import { useChatStore } from "@/store/chatStore";
import { shortenAddress } from "@/lib/nftVerification";
import type { ChatMessage } from "@/types";

interface SearchModalProps {
  visible: boolean;
  onClose: () => void;
}

export function SearchModal({ visible, onClose }: SearchModalProps) {
  const insets = useSafeAreaInsets();
  const { messages } = useChatStore();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return messages
      .filter((m) => m.content.toLowerCase().includes(q))
      .slice()
      .reverse(); // most recent first
  }, [query, messages]);

  const renderResult: ListRenderItem<ChatMessage> = ({ item }) => {
    const q = query.trim().toLowerCase();
    const content = item.content;
    const idx = content.toLowerCase().indexOf(q);
    const before = content.slice(0, idx);
    const match  = content.slice(idx, idx + q.length);
    const after  = content.slice(idx + q.length);

    return (
      <View style={styles.resultRow}>
        <View style={styles.resultHeader}>
          <Text style={styles.resultSender}>
            {item.senderUsername ?? shortenAddress(item.senderAddress)}
          </Text>
          <Text style={styles.resultTime}>
            {format(item.sentAt, "MMM d, HH:mm")}
          </Text>
        </View>
        <Text style={styles.resultContent} numberOfLines={2}>
          {before}
          <Text style={styles.resultHighlight}>{match}</Text>
          {after}
        </Text>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Search bar */}
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search messages…"
            placeholderTextColor={THEME.textFaint}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
            <Text style={styles.closeText}>Cancel</Text>
          </Pressable>
        </View>

        {/* Results */}
        {query.trim().length < 2 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔍</Text>
            <Text style={styles.emptyText}>Type at least 2 characters to search</Text>
          </View>
        ) : results.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🐒</Text>
            <Text style={styles.emptyText}>No messages found for "{query}"</Text>
          </View>
        ) : (
          <>
            <Text style={styles.resultCount}>
              {results.length} result{results.length !== 1 ? "s" : ""}
            </Text>
            <FlatList
              data={results}
              keyExtractor={(item) => item.id}
              renderItem={renderResult}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
            />
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    backgroundColor: THEME.surface,
  },
  searchIcon: { fontSize: 16 },
  input: {
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 16,
    color: THEME.text,
    paddingVertical: 4,
  },
  closeBtn: {
    paddingHorizontal: 4,
  },
  closeText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.accent,
  },
  resultCount: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  list: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  resultRow: {
    backgroundColor: THEME.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 14,
    marginBottom: 8,
    gap: 6,
  },
  resultHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  resultSender: {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: THEME.accent,
  },
  resultTime: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
  },
  resultContent: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
    lineHeight: 20,
  },
  resultHighlight: {
    backgroundColor: "rgba(255,215,0,0.25)",
    color: "#FFD700",
    fontFamily: FONTS.bodyMed,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyIcon: { fontSize: 40 },
  emptyText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textFaint,
    textAlign: "center",
    lineHeight: 20,
  },
});
