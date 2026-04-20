/**
 * DmInboxScreen — Twitter/X-style DM inbox.
 *
 * Layout:
 *   Header: "Messages" + ✎ compose button (top-right)
 *   FlatList: one row per DM thread → avatar | username + last message | timestamp
 *   Compose modal: searchable list of all known users → tap to open DM
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Image,
  TextInput,
  Modal,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { formatDistanceToNowStrict } from 'date-fns';
import { THEME, FONTS } from '@/lib/constants';
import { useThemeColor } from '@/lib/shopTheme';
import { useDmInbox } from '@/hooks/useDmInbox';
import { useAppStore } from '@/store/appStore';
import { getCachedProfile, getDeduplicatedUsers, useProfileVersion } from '@/lib/userProfile';
import { shortenAddress } from '@/lib/nftVerification';
import type { DmThread } from '@/lib/xmtp';
import { listGroupDmThreads, createGroupDm, type GroupDmThread } from '@/lib/xmtp';
import { getXmtpClient } from '@/hooks/useXmtp';
import { markChannelRead } from '@/lib/messageCache';
import { DmInboxSkeleton } from '@/components/SkeletonLoader';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(date: Date | null): string {
  if (!date) return '';
  try { return formatDistanceToNowStrict(date, { addSuffix: false }); } catch { return ''; }
}

// ─── Thread Row ───────────────────────────────────────────────────────────────

function ThreadRow({ thread, myInboxId, unread }: { thread: DmThread; myInboxId: string; unread: number }) {
  if (thread.peerInboxId === myInboxId) return null;

  let profile: any = null;
  try { profile = getCachedProfile(thread.peerInboxId); } catch { /* ignore */ }
  const name: string = profile?.username ?? 'Monke';
  const avatarUri: string | null = profile?.nftImage ?? null;
  const isBot = name === 'AI Agent #9385';

  const rawMsg = thread.lastMessage;
  let preview = 'No messages yet';
  if (typeof rawMsg === 'string' && rawMsg.length > 0) {
    try {
      // Filter out protocol messages that shouldn't be shown as previews
      if (rawMsg.startsWith('READ:') || rawMsg.startsWith('TYPING:') || rawMsg.startsWith('PROFILE_UPDATE:') || rawMsg.startsWith('GIFT_ITEM:')) {
        preview = 'No messages yet';
      } else {
        preview = rawMsg
          .replace(/^STICKER:[^\s]+/, 'Sticker')
          .replace(/^GIF:[^\s]+/, 'GIF')
          .replace(/^IMAGE:[^\s]+/, 'Photo')
          .replace(/^VIDEO:[^\s]+/, 'Video')
          .replace(/^MSG:[^:]+:/, '');
      }
    } catch { preview = String(rawMsg).slice(0, 50); }
  }

  let timeStr = '';
  try {
    if (thread.lastMessageAt instanceof Date) {
      timeStr = relativeTime(thread.lastMessageAt);
    }
  } catch { timeStr = ''; }

  return (
    <Pressable
      style={styles.threadRow}
      onPress={() => router.push(`/dm/${thread.peerInboxId}` as any)}
    >
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={styles.avatar} />
      ) : isBot ? (
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        <Image source={require('../../assets/ai_agent_avatar.png')} style={styles.avatar} />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarGlyph}>🐒</Text>
        </View>
      )}
      <View style={styles.threadInfo}>
        <View style={styles.threadHeader}>
          <Text style={[styles.threadName, unread > 0 && styles.threadNameUnread]} numberOfLines={1}>{name}</Text>
          {timeStr ? <Text style={[styles.threadTime, unread > 0 && styles.threadTimeUnread]}>{timeStr}</Text> : null}
        </View>
        <Text style={[styles.threadPreview, unread > 0 && styles.threadPreviewUnread]} numberOfLines={1}>{preview}</Text>
      </View>
      {unread > 0 ? (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      ) : (
        <Text style={styles.chevron}>›</Text>
      )}
    </Pressable>
  );
}

// ─���─ Group Thread Row ────────────────────────────────────────────────────────

function GroupThreadRow({ thread, myInboxId }: { thread: GroupDmThread; myInboxId: string }) {
  // Build display name from member profiles
  const memberNames = thread.memberInboxIds
    .filter(id => id !== myInboxId)
    .map(id => {
      const p = getCachedProfile(id);
      return p?.username ?? 'Monke';
    });
  const displayName = thread.groupName || memberNames.slice(0, 3).join(', ') + (memberNames.length > 3 ? '...' : '');

  const preview = thread.lastMessage ? thread.lastMessage.slice(0, 60) : 'No messages yet';
  let timeStr = '';
  try {
    if (thread.lastMessageAt) {
      timeStr = relativeTime(thread.lastMessageAt);
    }
  } catch { timeStr = ''; }

  return (
    <Pressable
      style={styles.threadRow}
      onPress={() => router.push(`/group-dm/${thread.groupId}` as any)}
    >
      <View style={styles.avatarFallback}>
        <Text style={styles.avatarGlyph}>{memberNames.length + 1}</Text>
      </View>
      <View style={styles.threadInfo}>
        <View style={styles.threadHeader}>
          <Text style={styles.threadName} numberOfLines={1}>{displayName}</Text>
          {timeStr ? <Text style={styles.threadTime}>{timeStr}</Text> : null}
        </View>
        <Text style={styles.threadPreview} numberOfLines={1}>{preview}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

// ─── New Group Modal ──────────────────────────────────��──────────────────────

function NewGroupModal({ visible, onClose, myInboxId }: {
  visible: boolean;
  onClose: () => void;
  myInboxId: string;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  useProfileVersion();

  const users = useMemo(() => {
    const allUsers = getDeduplicatedUsers();
    const results: Array<{ inboxId: string; name: string; avatarUri: string | null }> = [];
    for (const [inboxId, uname] of allUsers.entries()) {
      if (inboxId === myInboxId) continue;
      const profile = getCachedProfile(inboxId);
      const name = profile?.username ?? uname ?? 'Monke';
      if (query && !name.toLowerCase().includes(query.toLowerCase())) continue;
      results.push({ inboxId, name, avatarUri: profile?.nftImage ?? null });
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }, [query, myInboxId]);

  const toggleUser = useCallback((inboxId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(inboxId)) next.delete(inboxId);
      else next.add(inboxId);
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (selected.size < 1) return;
    setCreating(true);
    try {
      const client = getXmtpClient();
      if (!client) throw new Error('XMTP not connected');
      const memberIds = Array.from(selected);
      const names = memberIds.map(id => {
        const p = getCachedProfile(id);
        return p?.username ?? 'Monke';
      });
      const groupName = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '');
      const group = await createGroupDm(client, memberIds, groupName);
      const groupId = (group as any).id;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onClose();
      setSelected(new Set());
      setQuery('');
      router.push(`/group-dm/${groupId}` as any);
    } catch (e: any) {
      console.warn('[NewGroupModal] create failed:', e?.message ?? e);
    } finally {
      setCreating(false);
    }
  }, [selected, myInboxId, onClose]);

  // Reset on close
  useEffect(() => {
    if (!visible) { setSelected(new Set()); setQuery(''); }
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Pressable onPress={onClose} style={styles.modalCancelBtn} hitSlop={8}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>New Group</Text>
            <Pressable
              onPress={handleCreate}
              disabled={selected.size < 1 || creating}
              style={[styles.modalCancelBtn, { alignItems: 'flex-end' as const }]}
              hitSlop={8}
            >
              <Text style={[styles.modalCancelText, selected.size < 1 && { opacity: 0.4 }]}>
                {creating ? '...' : `Create (${selected.size})`}
              </Text>
            </Pressable>
          </View>

          {selected.size > 0 && (
            <View style={styles.selectedRow}>
              {Array.from(selected).map(id => {
                const p = getCachedProfile(id);
                return (
                  <Pressable key={id} style={styles.selectedChip} onPress={() => toggleUser(id)}>
                    <Text style={styles.selectedChipText}>{p?.username ?? 'Monke'} x</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={styles.searchBar}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search Monkes..."
              placeholderTextColor={THEME.textFaint}
              value={query}
              onChangeText={setQuery}
              autoFocus
              autoCapitalize="none"
            />
          </View>

          <FlatList
            data={users}
            keyExtractor={u => u.inboxId}
            renderItem={({ item }) => {
              const isSelected = selected.has(item.inboxId);
              return (
                <Pressable
                  style={({ pressed }) => [styles.userRow, pressed && { opacity: 0.7 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleUser(item.inboxId); }}
                >
                  {item.avatarUri ? (
                    <Image source={{ uri: item.avatarUri }} style={styles.userAvatar} />
                  ) : (
                    <View style={styles.userAvatarFallback}>
                      <Text style={styles.avatarGlyph}>🐒</Text>
                    </View>
                  )}
                  <Text style={styles.userName} numberOfLines={1}>{item.name}</Text>
                  <View style={[styles.checkCircle, isSelected && styles.checkCircleSelected]}>
                    {isSelected && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {query ? 'No users match your search.' : 'No users found yet.'}
              </Text>
            }
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
            removeClippedSubviews
            maxToRenderPerBatch={20}
            windowSize={7}
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── Compose Modal ────────────────────────────────────────────────────────────

function ComposeModal({ visible, onClose, myInboxId }: {
  visible: boolean;
  onClose: () => void;
  myInboxId: string;
}) {
  const [query, setQuery] = useState('');
  useProfileVersion();

  const users = useMemo(() => {
    const allUsers = getDeduplicatedUsers(); // Map<inboxId, username> (deduplicated by wallet)
    const results: Array<{ inboxId: string; name: string; avatarUri: string | null }> = [];
    for (const [inboxId, uname] of allUsers.entries()) {
      if (inboxId === myInboxId) continue;
      const profile = getCachedProfile(inboxId);
      const name    = profile?.username ?? uname ?? 'Monke';
      if (query && !name.toLowerCase().includes(query.toLowerCase())) continue;
      results.push({ inboxId, name, avatarUri: profile?.nftImage ?? null });
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }, [query, myInboxId]);

  const handleSelect = useCallback((inboxId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    router.push(`/dm/${inboxId}`);
  }, [onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Pressable onPress={onClose} style={styles.modalCancelBtn} hitSlop={8}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>New Message</Text>
            <View style={{ width: 60 }} />
          </View>

          {/* Search */}
          <View style={styles.searchBar}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search Monkes..."
              placeholderTextColor={THEME.textFaint}
              value={query}
              onChangeText={setQuery}
              autoFocus
              autoCapitalize="none"
            />
          </View>

          {/* User list */}
          <FlatList
            data={users}
            keyExtractor={u => u.inboxId}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.userRow, pressed && { opacity: 0.7 }]}
                onPress={() => handleSelect(item.inboxId)}
              >
                {item.avatarUri ? (
                  <Image source={{ uri: item.avatarUri }} style={styles.userAvatar} />
                ) : (
                  <View style={styles.userAvatarFallback}>
                    <Text style={styles.avatarGlyph}>🐒</Text>
                  </View>
                )}
                <Text style={styles.userName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {query ? 'No users match your search.' : 'No users found yet.'}
              </Text>
            }
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
            removeClippedSubviews
            maxToRenderPerBatch={20}
            windowSize={7}
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DmInboxScreen() {
  const insets = useSafeAreaInsets();
  const { myInboxId, dmUnreadCounts } = useAppStore();
  const { threads, loading, refreshing, refresh } = useDmInbox();
  const [composeOpen, setComposeOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [groupThreads, setGroupThreads] = useState<GroupDmThread[]>([]);
  useProfileVersion();
  const themeBg = useThemeColor('bg');
  const themeBorder = useThemeColor('border');

  // Mark DMs as read so badge count resets on next sync
  useEffect(() => {
    markChannelRead('dms').catch(() => {});
    useAppStore.getState().clearCommunityBadge('dms');
  }, []);

  // Load group DM threads
  useEffect(() => {
    async function loadGroups() {
      const client = getXmtpClient();
      if (!client) return;
      try {
        const groups = await listGroupDmThreads(client);
        setGroupThreads(groups);
      } catch { /* non-critical */ }
    }
    if (!loading) loadGroups();
  }, [loading]);

  // Merge 1-on-1 DMs and group DMs into a single sorted list
  const mergedThreads = useMemo(() => {
    type MergedItem =
      | { kind: 'dm'; thread: DmThread }
      | { kind: 'group'; thread: GroupDmThread };
    const items: MergedItem[] = [
      ...threads.map(t => ({ kind: 'dm' as const, thread: t })),
      ...groupThreads.map(t => ({ kind: 'group' as const, thread: t })),
    ];
    items.sort((a, b) => {
      const aTime = a.thread.lastMessageAt?.getTime() ?? 0;
      const bTime = b.thread.lastMessageAt?.getTime() ?? 0;
      return bTime - aTime;
    });
    return items;
  }, [threads, groupThreads]);

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: themeBg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: themeBorder }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Messages</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            style={styles.composeBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setNewGroupOpen(true); }}
            hitSlop={8}
          >
            <Text style={styles.composeIcon}>+</Text>
          </Pressable>
          <Pressable
            style={styles.composeBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setComposeOpen(true); }}
            hitSlop={8}
          >
            <Text style={styles.composeIcon}>✏</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <DmInboxSkeleton count={6} />
      ) : (
        <FlatList
          data={mergedThreads}
          keyExtractor={item => item.kind === 'dm' ? item.thread.peerInboxId : item.thread.groupId}
          renderItem={({ item }) => {
            if (item.kind === 'group') {
              return <GroupThreadRow thread={item.thread} myInboxId={myInboxId ?? ''} />;
            }
            return <ThreadRow thread={item.thread} myInboxId={myInboxId ?? ''} unread={dmUnreadCounts[item.thread.peerInboxId] ?? 0} />;
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={THEME.accent}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No DMs yet</Text>
              <Text style={styles.emptySubtitle}>
                Tap ✏ to start a conversation with another Monke.
              </Text>
            </View>
          }
          contentContainerStyle={{ flexGrow: 1 }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          removeClippedSubviews
          maxToRenderPerBatch={15}
          windowSize={7}
        />
      )}

      <ComposeModal
        visible={composeOpen}
        onClose={() => setComposeOpen(false)}
        myInboxId={myInboxId ?? ''}
      />
      <NewGroupModal
        visible={newGroupOpen}
        onClose={() => setNewGroupOpen(false)}
        myInboxId={myInboxId ?? ''}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 48;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  backBtn: { padding: 4, marginRight: 4 },
  backArrow: { fontSize: 22, color: THEME.text },
  headerTitle: {
    flex: 1,
    fontFamily: FONTS.displayMed,
    fontSize: 18,
    color: THEME.text,
    textAlign: 'center',
  },
  composeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: THEME.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: THEME.accent + '55',
  },
  composeIcon: { fontSize: 17, color: THEME.accent },

  // Thread row
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  avatarFallback: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: THEME.accentSoft,
    borderWidth: 1,
    borderColor: THEME.accent + '44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGlyph: { fontSize: 22 },
  threadInfo: { flex: 1, gap: 3 },
  threadHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  threadName: {
    fontFamily: FONTS.displayMed,
    fontSize: 15,
    color: THEME.text,
    flexShrink: 1,
  },
  threadTime: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textFaint,
    marginLeft: 8,
  },
  threadPreview: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textMuted,
  },
  chevron: { fontSize: 20, color: THEME.textFaint, marginLeft: 4 },
  // Unread badge
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: THEME.accent,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 5,
    marginLeft: 4,
  },
  unreadBadgeText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 11,
    color: '#fff',
    fontWeight: '700' as const,
  },
  threadNameUnread: { fontFamily: FONTS.displayMed, fontWeight: '700' as const },
  threadPreviewUnread: { color: THEME.text },
  threadTimeUnread: { color: THEME.accent },
  separator: { height: 1, backgroundColor: THEME.border, marginLeft: 76 },

  // Empty / loading
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  loadingText: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textMuted },
  emptyTitle: { fontFamily: FONTS.displayMed, fontSize: 18, color: THEME.text },
  emptySubtitle: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textMuted, textAlign: 'center', lineHeight: 20 },

  // Compose modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: THEME.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: THEME.border,
    maxHeight: '85%',
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  modalTitle: { fontFamily: FONTS.displayMed, fontSize: 16, color: THEME.text },
  modalCancelBtn: { width: 60 },
  modalCancelText: { fontFamily: FONTS.body, fontSize: 15, color: THEME.accent },

  // Search bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    gap: 8,
  },
  searchIcon: { fontSize: 14 },
  searchInput: {
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 15,
    color: THEME.text,
    padding: 0,
  },

  // User rows in compose modal
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  userAvatar: { width: 40, height: 40, borderRadius: 20 },
  userAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: THEME.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userName: { flex: 1, fontFamily: FONTS.bodyMed, fontSize: 15, color: THEME.text },
  emptyText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
    textAlign: 'center',
    padding: 32,
  },

  // New Group modal extras
  selectedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  selectedChip: {
    backgroundColor: THEME.accentSoft,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: THEME.accent + '55',
  },
  selectedChipText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: THEME.accent,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: THEME.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginLeft: 4,
  },
  checkCircleSelected: {
    backgroundColor: THEME.accent,
    borderColor: THEME.accent,
  },
  checkMark: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '700' as const,
  },
});
