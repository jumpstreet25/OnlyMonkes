/**
 * SearchModal
 *
 * Full-screen search with two tabs: Messages and Users.
 * Messages: filters chat by keyword.
 * Users: searches @username directory, tap to open profile or DM.
 */

import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  FlatList,
  Image,
  ListRenderItem,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { format } from "date-fns";
import { router } from "expo-router";
import { GlassModal } from "@/components/GlassModal";
import { THEME, FONTS } from "@/lib/constants";
import { useChatStore } from "@/store/chatStore";
import { shortenAddress } from "@/lib/nftVerification";
import { searchUsersByPrefix, getCachedProfile } from "@/lib/userProfile";
import type { ChatMessage } from "@/types";

interface SearchModalProps {
  visible: boolean;
  onClose: () => void;
}

type Tab = "messages" | "users";

interface UserResult {
  inboxId: string;
  username: string;
  nftImage?: string | null;
  online?: boolean;
}

export function SearchModal({ visible, onClose }: SearchModalProps) {
  const insets = useSafeAreaInsets();
  const { messages } = useChatStore();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("messages");

  // Message results
  const msgResults = useMemo(() => {
    if (tab !== "messages") return [];
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return messages
      .filter((m) => m.content.toLowerCase().includes(q))
      .slice()
      .reverse();
  }, [query, messages, tab]);

  // User results
  const userResults = useMemo<UserResult[]>(() => {
    if (tab !== "users") return [];
    const q = query.trim();
    if (q.length < 1) return [];
    const matches = searchUsersByPrefix(q, undefined, 20);
    return matches.map(({ inboxId, username }) => {
      const profile = getCachedProfile(inboxId);
      return { inboxId, username, nftImage: profile?.nftImage };
    });
  }, [query, tab]);

  const renderMsgResult: ListRenderItem<ChatMessage> = ({ item }) => {
    const q = query.trim().toLowerCase();
    const content = item.content;
    const idx = content.toLowerCase().indexOf(q);
    const before = content.slice(0, idx);
    const match = content.slice(idx, idx + q.length);
    const after = content.slice(idx + q.length);

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

  const renderUserResult: ListRenderItem<UserResult> = ({ item }) => (
    <Pressable
      style={({ pressed }) => [styles.userRow, pressed && { opacity: 0.7 }]}
      onPress={() => {
        onClose();
        setTimeout(() => router.push(`/dm/${item.inboxId}` as any), 300);
      }}
    >
      {item.nftImage ? (
        <Image source={{ uri: item.nftImage }} style={styles.userAvatar} />
      ) : (
        <View style={[styles.userAvatar, styles.userAvatarFallback]}>
          <Text style={{ fontSize: 18 }}>🐒</Text>
        </View>
      )}
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.username}</Text>
        <Text style={styles.userSub}>Tap to DM</Text>
      </View>
    </Pressable>
  );

  const noQuery = query.trim().length < (tab === "messages" ? 2 : 1);
  const results = tab === "messages" ? msgResults : userResults;

  return (
    <GlassModal visible={visible} onClose={onClose} position="bottom" animationType="slide" cardStyle={{ height: Dimensions.get("window").height * 0.7 }}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Search bar */}
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={tab === "messages" ? "Search messages…" : "Search users…"}
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

        {/* Tabs */}
        <View style={styles.tabRow}>
          <Pressable style={[styles.tab, tab === "messages" && styles.tabActive]} onPress={() => setTab("messages")}>
            <Text style={[styles.tabText, tab === "messages" && styles.tabTextActive]}>Messages</Text>
          </Pressable>
          <Pressable style={[styles.tab, tab === "users" && styles.tabActive]} onPress={() => setTab("users")}>
            <Text style={[styles.tabText, tab === "users" && styles.tabTextActive]}>Users</Text>
          </Pressable>
        </View>

        {/* Results */}
        {noQuery ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>{tab === "messages" ? "🔍" : "👤"}</Text>
            <Text style={styles.emptyText}>
              {tab === "messages" ? "Type at least 2 characters to search" : "Type a username to find"}
            </Text>
          </View>
        ) : results.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🐒</Text>
            <Text style={styles.emptyText}>
              {tab === "messages" ? `No messages found for "${query}"` : `No users found for "${query}"`}
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.resultCount}>
              {results.length} result{results.length !== 1 ? "s" : ""}
            </Text>
            {tab === "messages" ? (
              <FlatList
                data={msgResults}
                keyExtractor={(item) => item.id}
                renderItem={renderMsgResult}
                contentContainerStyle={styles.list}
                keyboardShouldPersistTaps="handled"
              />
            ) : (
              <FlatList
                data={userResults}
                keyExtractor={(item) => item.inboxId}
                renderItem={renderUserResult}
                contentContainerStyle={styles.list}
                keyboardShouldPersistTaps="handled"
              />
            )}
          </>
        )}
      </View>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg },
  searchBar: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 12,
    paddingVertical: 10, gap: 8, borderBottomWidth: 1,
    borderBottomColor: THEME.border, backgroundColor: "rgba(6,6,14,0.80)",
  },
  searchIcon: { fontSize: 16 },
  input: { flex: 1, fontFamily: FONTS.body, fontSize: 16, color: THEME.text, paddingVertical: 4 },
  closeBtn: { paddingHorizontal: 4 },
  closeText: { fontFamily: FONTS.bodyMed, fontSize: 14, color: THEME.accent },
  tabRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: THEME.border },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: THEME.accent },
  tabText: { fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.textMuted },
  tabTextActive: { color: THEME.accent },
  resultCount: {
    fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint,
    letterSpacing: 1, textTransform: "uppercase",
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
  },
  list: { paddingHorizontal: 12, paddingBottom: 24 },
  resultRow: {
    backgroundColor: "rgba(6,6,14,0.70)", borderRadius: 12,
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.05)",
    padding: 14, marginBottom: 8, gap: 6,
  },
  resultHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  resultSender: { fontFamily: FONTS.displayMed, fontSize: 13, color: THEME.accent },
  resultTime: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint },
  resultContent: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textMuted, lineHeight: 20 },
  resultHighlight: { backgroundColor: "rgba(255,215,0,0.25)", color: "#FFD700", fontFamily: FONTS.bodyMed },
  userRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(6,6,14,0.70)", borderRadius: 12,
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.05)",
    padding: 12, marginBottom: 8,
  },
  userAvatar: { width: 42, height: 42, borderRadius: 21 },
  userAvatarFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.05)" },
  userInfo: { flex: 1, gap: 2 },
  userName: { fontFamily: FONTS.displayMed, fontSize: 15, color: THEME.text },
  userSub: { fontFamily: FONTS.body, fontSize: 11, color: THEME.textMuted },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textFaint, textAlign: "center", lineHeight: 20 },
});
