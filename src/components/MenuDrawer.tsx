/**
 * MenuDrawer
 *
 * Slide-in drawer (right side). Four tabs:
 *   👥 Members  — active in last 24h
 *   📅 Events   — community calendar
 *   🔗 Links    — URLs shared in chat
 *   🖼️ Media    — images/GIFs shared in chat (placeholder)
 */

import React, { useEffect, useRef, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  Animated,
  useWindowDimensions,
  Image,
  ScrollView,
  Linking,
} from "react-native";
import { THEME, FONTS } from "@/lib/constants";
import { useChatStore } from "@/store/chatStore";
import { useAppStore } from "@/store/appStore";
import { getCachedProfile } from "@/lib/userProfile";
import { shortenAddress } from "@/lib/nftVerification";

const DRAWER_WIDTH_RATIO = 0.82;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const URL_REGEX = /https?:\/\/[^\s"'<>)]+/g;

type Tab = "members" | "events" | "links" | "media";

interface MenuDrawerProps {
  visible: boolean;
  onClose: () => void;
  onCreateEvent?: () => void;
  onSearch?: () => void;
  onMonkeTools?: () => void;
}

interface ActiveUser {
  inboxId: string;
  username?: string;
  nftImage?: string | null;
  lastSeen: Date;
}

interface SharedLink {
  url: string;
  senderUsername?: string;
  sentAt: Date;
}

export function MenuDrawer({ visible, onClose, onCreateEvent, onSearch, onMonkeTools }: MenuDrawerProps) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const DRAWER_WIDTH = SCREEN_WIDTH * DRAWER_WIDTH_RATIO;

  const slideAnim = useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const { messages } = useChatStore();
  const { calendarEvents } = useAppStore();
  const [activeTab, setActiveTab] = useState<Tab>("members");

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 0 : DRAWER_WIDTH,
      duration: 260,
      useNativeDriver: true,
    }).start();
    if (!visible) setActiveTab("members");
  }, [visible, DRAWER_WIDTH]);

  // ── Derived data ────────────────────────────────────────────────────────────

  const activeUsers = useMemo<ActiveUser[]>(() => {
    const cutoff = Date.now() - ONE_DAY_MS;
    const seen = new Map<string, ActiveUser>();
    for (const msg of messages) {
      if (msg.sentAt.getTime() < cutoff) continue;
      const cached = getCachedProfile(msg.senderAddress);
      const msgNft = cached?.nftImage ?? msg.senderNft?.image ?? null;
      const msgUsername = cached?.username ?? msg.senderUsername;
      if (!seen.has(msg.senderAddress)) {
        seen.set(msg.senderAddress, {
          inboxId: msg.senderAddress,
          username: msgUsername,
          nftImage: msgNft,
          lastSeen: msg.sentAt,
        });
      } else {
        const ex = seen.get(msg.senderAddress)!;
        seen.set(msg.senderAddress, {
          ...ex,
          lastSeen: msg.sentAt > ex.lastSeen ? msg.sentAt : ex.lastSeen,
          // always keep the best nftImage and username found across all messages
          nftImage: ex.nftImage ?? msgNft,
          username: ex.username ?? msgUsername,
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
  }, [messages]);

  const sharedLinks = useMemo<SharedLink[]>(() => {
    const seen = new Set<string>();
    const results: SharedLink[] = [];
    for (const msg of [...messages].reverse()) {
      const found = msg.content.match(URL_REGEX);
      if (!found) continue;
      for (const url of found) {
        if (!seen.has(url)) {
          seen.add(url);
          results.push({
            url,
            senderUsername: getCachedProfile(msg.senderAddress)?.username ?? msg.senderUsername,
            sentAt: msg.sentAt,
          });
        }
      }
    }
    return results;
  }, [messages]);

  const sharedMedia = useMemo(() => {
    return messages.filter((m) => m.content.startsWith("IMAGE:") || m.content.startsWith("GIF:"));
  }, [messages]);

  // Sort events: upcoming first
  const sortedEvents = useMemo(() => {
    return [...calendarEvents].sort((a, b) => {
      const da = new Date(`${a.date} ${a.time || "00:00"}`);
      const db = new Date(`${b.date} ${b.time || "00:00"}`);
      return da.getTime() - db.getTime();
    });
  }, [calendarEvents]);

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: "members", label: "👥" },
    { id: "events",  label: "📅", badge: sortedEvents.length || undefined },
    { id: "links",   label: "🔗", badge: sharedLinks.length || undefined },
    { id: "media",   label: "🖼️" },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={onClose} />

      <Animated.View
        style={[
          styles.drawer,
          { width: DRAWER_WIDTH, transform: [{ translateX: slideAnim }] },
        ]}
      >
        {/* Header */}
        <View style={styles.drawerHeader}>
          <Text style={styles.drawerTitle}>Community</Text>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={10}>
            <Text style={styles.closeIcon}>✕</Text>
          </Pressable>
        </View>

        {/* Quick actions — Search + Monke Tools */}
        <View style={styles.quickActions}>
          {onSearch && (
            <Pressable
              style={({ pressed }) => [styles.quickBtn, pressed && { opacity: 0.7 }]}
              onPress={() => { onClose(); setTimeout(onSearch, 280); }}
            >
              <Text style={styles.quickBtnIcon}>🔍</Text>
              <Text style={styles.quickBtnLabel}>Search</Text>
            </Pressable>
          )}
          {onMonkeTools && (
            <Pressable
              style={({ pressed }) => [styles.quickBtn, pressed && { opacity: 0.7 }]}
              onPress={() => { onClose(); setTimeout(onMonkeTools, 280); }}
            >
              <Text style={styles.quickBtnIcon}>🔧</Text>
              <Text style={styles.quickBtnLabel}>Monke Tools</Text>
            </Pressable>
          )}
        </View>

        {/* Tab bar */}
        <View style={styles.tabBar}>
          {TABS.map((tab) => (
            <Pressable
              key={tab.id}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Text style={styles.tabEmoji}>{tab.label}</Text>
              {tab.badge !== undefined && tab.badge > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{tab.badge}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>

        {/* Tab content */}
        <ScrollView showsVerticalScrollIndicator={false} style={styles.content}>
          {/* ── Members ─────────────────────────────────────────────────────── */}
          {activeTab === "members" && (
            <>
              <Text style={styles.sectionLabel}>
                Active last 24h · {activeUsers.length}
              </Text>
              {activeUsers.length === 0 ? (
                <Text style={styles.emptyText}>No activity in the last 24 hours.</Text>
              ) : (
                activeUsers.map((user) => {
                  const cached = getCachedProfile(user.inboxId);
                  const name = cached?.username ?? user.username ?? shortenAddress(user.inboxId);
                  const avatarUri = cached?.nftImage ?? user.nftImage ?? null;
                  return (
                    <View key={user.inboxId} style={styles.userRow}>
                      {avatarUri ? (
                        <Image source={{ uri: avatarUri }} style={styles.userAvatar} />
                      ) : (
                        <View style={styles.userAvatarFallback}>
                          <Text style={styles.userAvatarGlyph}>🐒</Text>
                        </View>
                      )}
                      <View style={styles.userInfo}>
                        <Text style={styles.userName} numberOfLines={1}>{name}</Text>
                        <Text style={styles.userTime}>{formatRelative(user.lastSeen)}</Text>
                      </View>
                      <View style={styles.onlineDot} />
                    </View>
                  );
                })
              )}
            </>
          )}

          {/* ── Events ──────────────────────────────────────────────────────── */}
          {activeTab === "events" && (
            <>
              <View style={styles.eventsHeader}>
                <Text style={styles.sectionLabel}>Community Events</Text>
                {onCreateEvent && (
                  <Pressable
                    style={styles.createEventBtn}
                    onPress={() => { onClose(); setTimeout(onCreateEvent, 300); }}
                  >
                    <Text style={styles.createEventText}>+ New</Text>
                  </Pressable>
                )}
              </View>
              {sortedEvents.length === 0 ? (
                <Text style={styles.emptyText}>No events yet. Tap + New to create one.</Text>
              ) : (
                sortedEvents.map((evt) => (
                  <View key={evt.id} style={styles.eventRow}>
                    <View style={styles.eventDateBadge}>
                      <Text style={styles.eventDateText}>
                        {evt.date.split("/").slice(0, 2).join("/")}
                      </Text>
                    </View>
                    <View style={styles.eventInfo}>
                      <Text style={styles.eventTitle} numberOfLines={1}>{evt.title}</Text>
                      {evt.time ? <Text style={styles.eventMeta}>{evt.time}{evt.location ? ` · ${evt.location}` : ""}</Text> : null}
                      {evt.purpose ? <Text style={styles.eventPurpose} numberOfLines={2}>{evt.purpose}</Text> : null}
                      <Text style={styles.eventCreator}>by {evt.creatorUsername ?? shortenAddress(evt.creatorInboxId)}</Text>
                    </View>
                  </View>
                ))
              )}
            </>
          )}

          {/* ── Links ───────────────────────────────────────────────────────── */}
          {activeTab === "links" && (
            <>
              <Text style={styles.sectionLabel}>
                Shared Links · {sharedLinks.length}
              </Text>
              {sharedLinks.length === 0 ? (
                <Text style={styles.emptyText}>No links shared in chat yet.</Text>
              ) : (
                sharedLinks.map((link, i) => (
                  <Pressable
                    key={i}
                    style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.7 }]}
                    onPress={() => Linking.openURL(link.url)}
                  >
                    <Text style={styles.linkIcon}>🔗</Text>
                    <View style={styles.linkInfo}>
                      <Text style={styles.linkUrl} numberOfLines={1}>{link.url.replace(/^https?:\/\//, "")}</Text>
                      <Text style={styles.linkMeta}>
                        {link.senderUsername ?? "?"} · {formatRelative(link.sentAt)}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                ))
              )}
            </>
          )}

          {/* ── Media ───────────────────────────────────────────────────────── */}
          {activeTab === "media" && (
            <>
              <Text style={styles.sectionLabel}>Shared Media</Text>
              {sharedMedia.length === 0 ? (
                <Text style={styles.emptyText}>No images or GIFs shared yet.</Text>
              ) : (
                sharedMedia.map((msg) => (
                  <View key={msg.id} style={styles.mediaRow}>
                    <Image
                      source={{ uri: msg.content.replace(/^(IMAGE:|GIF:)/, "") }}
                      style={styles.mediaThumb}
                      resizeMode="cover"
                    />
                    <View style={styles.mediaInfo}>
                      <Text style={styles.mediaSender}>{getCachedProfile(msg.senderAddress)?.username ?? msg.senderUsername ?? shortenAddress(msg.senderAddress)}</Text>
                      <Text style={styles.mediaTime}>{formatRelative(msg.sentAt)}</Text>
                    </View>
                  </View>
                ))
              )}
            </>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>

        <Text style={styles.footerHint}>OnlyMonkes · Saga Monkes holders 🐒</Text>
      </Animated.View>
    </Modal>
  );
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return "1d ago";
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  drawer: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: THEME.surfaceHigh,
    paddingTop: 56,
    borderLeftWidth: 1,
    borderLeftColor: THEME.border,
    shadowColor: "#000",
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 20,
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  drawerTitle: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: THEME.text,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: THEME.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: {
    fontSize: 14,
    color: THEME.textMuted,
  },

  quickActions: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  quickBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: THEME.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingVertical: 10,
  },
  quickBtnIcon: { fontSize: 16 },
  quickBtnLabel: {
    fontFamily: FONTS.displayMed,
    fontSize: 12,
    color: THEME.text,
  },

  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    marginHorizontal: 20,
    marginBottom: 14,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    position: "relative",
  },
  tabActive: {
    borderBottomColor: THEME.accent,
  },
  tabEmoji: { fontSize: 18 },
  tabBadge: {
    position: "absolute",
    top: 2,
    right: 6,
    backgroundColor: THEME.accent,
    borderRadius: 8,
    minWidth: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  tabBadgeText: {
    fontFamily: FONTS.mono,
    fontSize: 8,
    color: "#fff",
  },

  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  sectionLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  emptyText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textFaint,
    textAlign: "center",
    marginTop: 24,
    lineHeight: 20,
  },

  // Members
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  userAvatar: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, borderColor: THEME.border },
  userAvatarFallback: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: THEME.accentSoft, borderWidth: 1, borderColor: THEME.accent + "44",
    alignItems: "center", justifyContent: "center",
  },
  userAvatarGlyph: { fontSize: 16 },
  userInfo: { flex: 1, gap: 2 },
  userName: { fontFamily: FONTS.displayMed, fontSize: 13, color: THEME.text },
  userTime: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#4caf50" },

  // Events
  eventsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  createEventBtn: {
    backgroundColor: THEME.accentSoft,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: THEME.accent + "55",
  },
  createEventText: { fontFamily: FONTS.displayMed, fontSize: 12, color: THEME.accent },
  eventRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  eventDateBadge: {
    backgroundColor: THEME.accentSoft,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 42,
    borderWidth: 1,
    borderColor: THEME.accent + "44",
  },
  eventDateText: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.accent, textAlign: "center" },
  eventInfo: { flex: 1, gap: 3 },
  eventTitle: { fontFamily: FONTS.displayMed, fontSize: 13, color: THEME.text },
  eventMeta: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted },
  eventPurpose: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textFaint, lineHeight: 17 },
  eventCreator: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint },

  // Links
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  linkIcon: { fontSize: 16 },
  linkInfo: { flex: 1, gap: 2 },
  linkUrl: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.accent },
  linkMeta: { fontFamily: FONTS.body, fontSize: 11, color: THEME.textFaint },
  chevron: { fontSize: 18, color: THEME.textFaint },

  // Media
  mediaRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: THEME.border },
  mediaThumb: { width: 60, height: 60, borderRadius: 10, borderWidth: 1, borderColor: THEME.border },
  mediaInfo: { flex: 1, gap: 3 },
  mediaSender: { fontFamily: FONTS.displayMed, fontSize: 13, color: THEME.text },
  mediaTime: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint },

  footerHint: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textFaint,
    textAlign: "center",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
    paddingHorizontal: 20,
  },
});
