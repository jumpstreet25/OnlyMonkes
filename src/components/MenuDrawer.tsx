/**
 * MenuDrawer
 *
 * Slide-in Community drawer (right side).
 * Clean nav list → sub-views:
 *   💬 Messages       — active users to DM
 *   🤖 AI Agent Alerts — alerts from AI Agent #9385
 *   🗓️  Events         — community calendar + add event
 *   🖼️  Shared Images  — images/GIFs/Videos sent in chat
 *   🔗  Shared Links   — URLs shared in chat
 *   ⚙️  App Settings   — notification toggles, push token
 *   🔧  Monke Tools    — ecosystem links
 *
 * All-Time Users count replaces the old emoji tab bar.
 * Active Monkes 24hr lives at the bottom of the main list.
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
  Switch,
  Alert,
  Platform,
} from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { THEME, FONTS } from "@/lib/constants";
import { useChatStore } from "@/store/chatStore";
import { useAppStore } from "@/store/appStore";
import { getCachedProfile, useProfileVersion, getAllTimeUsers } from "@/lib/userProfile";
import { shortenAddress } from "@/lib/nftVerification";
import { clearPushToken, registerForPushNotifications, scheduleTestNotification } from "@/lib/notifications";
import type { ProfileTarget } from "@/components/UserProfileModal";

const DRAWER_WIDTH_RATIO = 0.82;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const URL_REGEX = /https?:\/\/[^\s"'<>)]+/g;
const BOT_USERNAME = "AI Agent #9385";

type ActiveView = "list" | "messages" | "alerts" | "events" | "images" | "links" | "settings" | "tools";

const VIEW_TITLES: Record<ActiveView, string> = {
  list:     "Community",
  messages: "Messages",
  alerts:   "AI Agent Alerts",
  events:   "Events",
  images:   "Shared Images",
  links:    "Shared Links",
  settings: "App Settings",
  tools:    "Monke Tools",
};

const TOOLS = [
  { name: "MonkeExplorer", url: "https://explorer.sagamonkes.com", icon: "🔭" },
  { name: "MonkeMerits",   url: "https://merits.sagamonkes.com",   icon: "🏆" },
  { name: "MonkeShop",     url: "https://shop.sagamonkes.com",     icon: "🛒" },
  { name: "MonkeSignal",   url: "https://signal.sagamonkes.com",   icon: "📡" },
  { name: "MonkeSnap",     url: "https://snap.sagamonkes.com",     icon: "📸" },
  { name: "MonkeSwap",     url: "https://swap.sagamonkes.com",     icon: "🔄" },
] as const;

interface MenuDrawerProps {
  visible: boolean;
  onClose: () => void;
  onCreateEvent?: () => void;
  onSearch?: () => void;
  onPressUser?: (target: ProfileTarget) => void;
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

export function MenuDrawer({ visible, onClose, onCreateEvent, onSearch, onPressUser }: MenuDrawerProps) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const DRAWER_WIDTH = SCREEN_WIDTH * DRAWER_WIDTH_RATIO;

  const slideAnim = useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const { messages } = useChatStore();
  const { calendarEvents, myInboxId, username,
    notificationsEnabled, mentionsOnly, botNotificationsEnabled,
    setNotificationsEnabled, setMentionsOnly, setBotNotificationsEnabled,
    expoPushToken, setExpoPushToken,
  } = useAppStore();
  const [activeView, setActiveView] = useState<ActiveView>("list");

  useProfileVersion();

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 0 : DRAWER_WIDTH,
      duration: 260,
      useNativeDriver: true,
    }).start();
    if (!visible) setActiveView("list");
  }, [visible, DRAWER_WIDTH]);

  // ── Derived data ──────────────────────────────────────────────────────────

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

  const sharedMedia = useMemo(() =>
    messages.filter((m) =>
      m.content.startsWith("IMAGE:") ||
      m.content.startsWith("GIF:") ||
      m.content.startsWith("VIDEO:")
    ), [messages]);

  const agentAlerts = useMemo(() =>
    messages.filter((m) => m.senderUsername === BOT_USERNAME),
    [messages]);

  const allTimeUsers = getAllTimeUsers().size;

  const sortedEvents = useMemo(() => {
    return [...calendarEvents].sort((a, b) => {
      const da = new Date(`${a.date} ${a.time || "00:00"}`);
      const db = new Date(`${b.date} ${b.time || "00:00"}`);
      return da.getTime() - db.getTime();
    });
  }, [calendarEvents]);

  // ── Notification handlers ─────────────────────────────────────────────────

  async function handleTestNotification() {
    await scheduleTestNotification();
  }

  async function handleRefreshToken() {
    await clearPushToken();
    const token = await registerForPushNotifications();
    if (token) {
      setExpoPushToken(token);
      Alert.alert("Token refreshed", token);
    } else {
      Alert.alert("Failed", "Could not get push token. Check notification permissions.");
    }
  }

  // ── User row helper ───────────────────────────────────────────────────────

  function renderUserRow(user: ActiveUser, showDot = true) {
    const cached = getCachedProfile(user.inboxId);
    const name = cached?.username ?? user.username ?? shortenAddress(user.inboxId);
    const avatarUri = cached?.nftImage ?? user.nftImage ?? null;
    return (
      <Pressable
        key={user.inboxId}
        style={({ pressed }) => [styles.userRow, pressed && { opacity: 0.7 }]}
        onPress={() => {
          if (!onPressUser) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPressUser({
            senderAddress: user.inboxId,
            senderUsername: name,
            senderNft: avatarUri ? { mint: "", name: "", image: avatarUri } : null,
          });
        }}
      >
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
        {showDot && <View style={styles.onlineDot} />}
      </Pressable>
    );
  }

  // ── Menu list item helper ─────────────────────────────────────────────────

  function MenuItem({
    icon, title, subtitle, badge, onPress, rightExtra,
  }: {
    icon: string;
    title: string;
    subtitle?: string;
    badge?: number;
    onPress: () => void;
    rightExtra?: React.ReactNode;
  }) {
    return (
      <Pressable
        style={({ pressed }) => [styles.menuItem, pressed && { opacity: 0.7 }]}
        onPress={onPress}
      >
        <View style={styles.menuItemInfo}>
          <Text style={styles.menuItemTitle}>{title}</Text>
          {subtitle ? <Text style={styles.menuItemSub}>{subtitle}</Text> : null}
        </View>
        {badge !== undefined && badge > 0 && (
          <View style={styles.menuBadge}>
            <Text style={styles.menuBadgeText}>{badge}</Text>
          </View>
        )}
        {rightExtra}
        <Text style={styles.menuChevron}>›</Text>
      </Pressable>
    );
  }

  // ── Back / close header ───────────────────────────────────────────────────

  const isList = activeView === "list";

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
          {!isList ? (
            <Pressable
              onPress={() => setActiveView("list")}
              style={styles.backBtn}
              hitSlop={10}
            >
              <Text style={styles.backIcon}>‹</Text>
              <Text style={styles.backLabel}>Back</Text>
            </Pressable>
          ) : (
            <Text style={styles.drawerTitle}>Community</Text>
          )}
          {!isList && (
            <Text style={styles.subViewTitle}>{VIEW_TITLES[activeView]}</Text>
          )}
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={10}>
            <Text style={styles.closeIcon}>✕</Text>
          </Pressable>
        </View>

        {/* All-Time Users — always visible */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{allTimeUsers}</Text>
            <Text style={styles.statLabel}>All-Time Users</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statNum} numberOfLines={1}>
              {username ?? shortenAddress(myInboxId ?? "")}
            </Text>
            <Text style={styles.statLabel}>Logged In</Text>
          </View>
        </View>

        {/* Content */}
        <ScrollView showsVerticalScrollIndicator={false} style={styles.content}>

          {/* ── Main list ──────────────────────────────────────────────────── */}
          {activeView === "list" && (
            <>
              <View style={styles.menuList}>
                <MenuItem
                  icon="💬"
                  title="Messages"
                  subtitle="Direct messages"
                  onPress={() => { onClose(); router.push('/dms'); }}
                />
                <MenuItem
                  icon="🤖"
                  title="AI Agent Alerts"
                  subtitle={agentAlerts.length > 0 ? `${agentAlerts.length} alerts` : "Trade signals & announcements"}
                  badge={agentAlerts.length || undefined}
                  onPress={() => setActiveView("alerts")}
                />
                <MenuItem
                  icon="🗓️"
                  title="Events"
                  subtitle={sortedEvents.length > 0 ? `${sortedEvents.length} upcoming` : "Community calendar"}
                  badge={sortedEvents.length || undefined}
                  onPress={() => setActiveView("events")}
                />
                <MenuItem
                  icon="🖼️"
                  title="Shared Images"
                  subtitle={sharedMedia.length > 0 ? `${sharedMedia.length} shared` : "Photos, GIFs & videos"}
                  onPress={() => setActiveView("images")}
                />
                <MenuItem
                  icon="🔗"
                  title="Shared Links"
                  subtitle={sharedLinks.length > 0 ? `${sharedLinks.length} links` : "URLs shared in chat"}
                  badge={sharedLinks.length || undefined}
                  onPress={() => setActiveView("links")}
                />
                {onSearch && (
                  <MenuItem
                    icon="🔍"
                    title="Search"
                    subtitle="Search messages"
                    onPress={() => { onClose(); setTimeout(onSearch, 280); }}
                  />
                )}
                <MenuItem
                  icon="⚙️"
                  title="App Settings"
                  subtitle="Notifications & preferences"
                  onPress={() => setActiveView("settings")}
                />
                <MenuItem
                  icon="🔧"
                  title="Monke Tools"
                  subtitle="Ecosystem links"
                  onPress={() => setActiveView("tools")}
                />
              </View>

              {/* Active Monkes 24hr */}
              <Text style={styles.sectionLabel}>
                Active last 24h · {activeUsers.length}
              </Text>
              {activeUsers.length === 0 ? (
                <Text style={styles.emptyText}>No activity in the last 24 hours.</Text>
              ) : (
                activeUsers.map((u) => renderUserRow(u))
              )}
            </>
          )}

          {/* ── Messages ───────────────────────────────────────────────────── */}
          {activeView === "messages" && (
            <>
              <Text style={styles.sectionLabel}>
                Tap a user to open a direct message
              </Text>
              {activeUsers.length === 0 ? (
                <Text style={styles.emptyText}>No recent users to message.</Text>
              ) : (
                activeUsers
                  .filter(u => u.inboxId !== myInboxId)
                  .map((u) => {
                    const cached = getCachedProfile(u.inboxId);
                    const name = cached?.username ?? u.username ?? shortenAddress(u.inboxId);
                    const avatarUri = cached?.nftImage ?? u.nftImage ?? null;
                    return (
                      <Pressable
                        key={u.inboxId}
                        style={({ pressed }) => [styles.userRow, pressed && { opacity: 0.7 }]}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          onClose();
                          router.push(`/dm/${u.inboxId}`);
                        }}
                      >
                        {avatarUri ? (
                          <Image source={{ uri: avatarUri }} style={styles.userAvatar} />
                        ) : (
                          <View style={styles.userAvatarFallback}>
                            <Text style={styles.userAvatarGlyph}>🐒</Text>
                          </View>
                        )}
                        <View style={styles.userInfo}>
                          <Text style={styles.userName} numberOfLines={1}>{name}</Text>
                          <Text style={styles.userTime}>{formatRelative(u.lastSeen)}</Text>
                        </View>
                        <Text style={styles.dmIcon}>✉</Text>
                      </Pressable>
                    );
                  })
              )}
            </>
          )}

          {/* ── AI Agent Alerts ─────────────────────────────────────────────── */}
          {activeView === "alerts" && (
            <>
              <Text style={styles.sectionLabel}>
                Alerts · {agentAlerts.length}
              </Text>
              {agentAlerts.length === 0 ? (
                <Text style={styles.emptyText}>No alerts from AI Agent yet.</Text>
              ) : (
                [...agentAlerts].reverse().map((msg) => (
                  <View key={msg.id} style={styles.alertRow}>
                    <View style={styles.alertDot} />
                    <View style={styles.alertInfo}>
                      <Text style={styles.alertContent}>{msg.content}</Text>
                      <Text style={styles.alertTime}>{formatRelative(msg.sentAt)}</Text>
                    </View>
                  </View>
                ))
              )}
            </>
          )}

          {/* ── Events ─────────────────────────────────────────────────────── */}
          {activeView === "events" && (
            <>
              <View style={styles.eventsHeader}>
                <Text style={styles.sectionLabel}>Community Events</Text>
                {onCreateEvent && (
                  <Pressable
                    style={styles.createEventBtn}
                    onPress={() => { onClose(); setTimeout(onCreateEvent, 300); }}
                  >
                    <Text style={styles.createEventText}>+ Add Event</Text>
                  </Pressable>
                )}
              </View>
              {sortedEvents.length === 0 ? (
                <Text style={styles.emptyText}>No events yet. Tap + Add Event to create one.</Text>
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

          {/* ── Shared Images ───────────────────────────────────────────────── */}
          {activeView === "images" && (
            <>
              <Text style={styles.sectionLabel}>Shared Media · {sharedMedia.length}</Text>
              {sharedMedia.length === 0 ? (
                <Text style={styles.emptyText}>No images, GIFs or videos shared yet.</Text>
              ) : (
                [...sharedMedia].reverse().map((msg) => {
                  const isVideo = msg.content.startsWith("VIDEO:");
                  const parts = msg.content.replace(/^(IMAGE:|GIF:|VIDEO:)/, "").split("|");
                  const thumbUri = isVideo ? parts[1] ?? parts[0] : parts[0];
                  const displayUri = thumbUri;
                  return (
                    <View key={msg.id} style={styles.mediaRow}>
                      <Image
                        source={{ uri: displayUri }}
                        style={styles.mediaThumb}
                        resizeMode="cover"
                      />
                      <View style={styles.mediaInfo}>
                        <Text style={styles.mediaSender}>
                          {getCachedProfile(msg.senderAddress)?.username ?? msg.senderUsername ?? shortenAddress(msg.senderAddress)}
                          {isVideo ? "  🎥" : ""}
                        </Text>
                        <Text style={styles.mediaTime}>{formatRelative(msg.sentAt)}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </>
          )}

          {/* ── Shared Links ─────────────────────────────────────────────────── */}
          {activeView === "links" && (
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

          {/* ── App Settings ─────────────────────────────────────────────────── */}
          {activeView === "settings" && (
            <>
              <Text style={styles.sectionLabel}>Notifications</Text>

              {Platform.OS === "android" && (
                <Pressable style={styles.fixBanner} onPress={() => Linking.openSettings()}>
                  <Text style={styles.fixBannerIcon}>🔔</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fixBannerTitle}>Not seeing popup alerts?</Text>
                    <Text style={styles.fixBannerDesc}>
                      Tap to open Notification Settings → set importance to{" "}
                      <Text style={{ color: THEME.accent }}>Urgent</Text> for heads-up banners.
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              )}

              <View style={styles.settingsCard}>
                <View style={styles.settingRow}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Enable notifications</Text>
                    <Text style={styles.settingDesc}>Get notified for new messages in all chats</Text>
                  </View>
                  <Switch
                    value={notificationsEnabled}
                    onValueChange={setNotificationsEnabled}
                    trackColor={{ false: THEME.border, true: THEME.accent + "88" }}
                    thumbColor={notificationsEnabled ? THEME.accent : THEME.textFaint}
                  />
                </View>
                <View style={styles.settingDivider} />
                <View style={[styles.settingRow, !notificationsEnabled && styles.settingRowDisabled]}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>@Mentions only</Text>
                    <Text style={styles.settingDesc}>Only notify when someone @mentions you</Text>
                  </View>
                  <Switch
                    value={mentionsOnly}
                    onValueChange={setMentionsOnly}
                    disabled={!notificationsEnabled}
                    trackColor={{ false: THEME.border, true: THEME.accent + "88" }}
                    thumbColor={mentionsOnly ? THEME.accent : THEME.textFaint}
                  />
                </View>
                <View style={styles.settingDivider} />
                <View style={styles.settingRow}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Bot notifications</Text>
                    <Text style={styles.settingDesc}>Alerts from AI Agent (trade signals)</Text>
                  </View>
                  <Switch
                    value={botNotificationsEnabled}
                    onValueChange={setBotNotificationsEnabled}
                    trackColor={{ false: THEME.border, true: THEME.accent + "88" }}
                    thumbColor={botNotificationsEnabled ? THEME.accent : THEME.textFaint}
                  />
                </View>
              </View>

              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Push Token</Text>
              <View style={styles.tokenCard}>
                <Text style={styles.tokenText} numberOfLines={2} selectable>
                  {expoPushToken ?? "Not registered yet"}
                </Text>
                <View style={styles.tokenButtons}>
                  {expoPushToken && (
                    <Pressable
                      style={styles.tokenBtn}
                      onPress={async () => {
                        await Clipboard.setStringAsync(expoPushToken);
                        Alert.alert("Copied", "Expo push token copied to clipboard.");
                      }}
                    >
                      <Text style={styles.tokenBtnText}>Copy</Text>
                    </Pressable>
                  )}
                  <Pressable style={styles.tokenBtn} onPress={handleRefreshToken}>
                    <Text style={styles.tokenBtnText}>Refresh</Text>
                  </Pressable>
                  <Pressable style={[styles.tokenBtn, { borderColor: THEME.accent }]} onPress={handleTestNotification}>
                    <Text style={styles.tokenBtnText}>Test (press Home!)</Text>
                  </Pressable>
                </View>
              </View>
            </>
          )}

          {/* ── Monke Tools ──────────────────────────────────────────────────── */}
          {activeView === "tools" && (
            <>
              <Text style={styles.sectionLabel}>Ecosystem</Text>
              {TOOLS.map((tool, idx) => (
                <Pressable
                  key={tool.name}
                  style={({ pressed }) => [
                    styles.toolRow,
                    idx === 0 && styles.toolRowFirst,
                    idx === TOOLS.length - 1 && styles.toolRowLast,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => Linking.openURL(tool.url)}
                >
                  <View style={styles.toolIconBox}>
                    <Text style={styles.toolIcon}>{tool.icon}</Text>
                  </View>
                  <View style={styles.toolInfo}>
                    <Text style={styles.toolName}>{tool.name}</Text>
                    <Text style={styles.toolUrl}>{tool.url.replace("https://", "")}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ))}
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

  // Header
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 8,
  },
  drawerTitle: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: THEME.text,
    flex: 1,
  },
  subViewTitle: {
    fontFamily: FONTS.display,
    fontSize: 17,
    color: THEME.text,
    flex: 1,
    textAlign: "center",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  backIcon: {
    fontSize: 22,
    color: THEME.accent,
    lineHeight: 24,
  },
  backLabel: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: THEME.accent,
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

  // All-Time Users
  statsRow: {
    flexDirection: "row",
    borderRadius: 12,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    marginHorizontal: 20,
    marginBottom: 14,
    overflow: "hidden",
  },
  statBox: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  statDivider: {
    width: 1,
    backgroundColor: THEME.border,
  },
  statNum: {
    fontFamily: FONTS.display,
    fontSize: 16,
    color: THEME.text,
    marginBottom: 2,
  },
  statLabel: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.textFaint,
    letterSpacing: 1,
    textTransform: "uppercase",
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
    marginBottom: 10,
  },
  emptyText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textFaint,
    textAlign: "center",
    marginTop: 24,
    lineHeight: 20,
  },

  // Menu list
  menuList: {
    marginBottom: 20,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    gap: 12,
  },
  menuItemInfo: { flex: 1, gap: 2 },
  menuItemTitle: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: THEME.text,
  },
  menuItemSub: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
  },
  menuBadge: {
    backgroundColor: THEME.accent,
    borderRadius: 8,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  menuBadgeText: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: "#fff",
  },
  menuChevron: {
    fontSize: 20,
    color: THEME.textFaint,
  },

  // User rows
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
  dmIcon: { fontSize: 15, color: THEME.accent, marginLeft: "auto" as any },

  // AI Agent Alerts
  alertRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    alignItems: "flex-start",
  },
  alertDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: THEME.accent,
    marginTop: 5,
    flexShrink: 0,
  },
  alertInfo: { flex: 1, gap: 4 },
  alertContent: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.text,
    lineHeight: 19,
  },
  alertTime: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
  },

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

  // App Settings
  fixBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: THEME.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.accent + "44",
    padding: 14,
    marginBottom: 10,
  },
  fixBannerIcon: { fontSize: 22 },
  fixBannerTitle: { fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.text, marginBottom: 2 },
  fixBannerDesc: { fontFamily: FONTS.body, fontSize: 11, color: THEME.textMuted, lineHeight: 15 },
  settingsCard: {
    backgroundColor: THEME.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  settingRowDisabled: { opacity: 0.4 },
  settingInfo: { flex: 1, gap: 3 },
  settingTitle: { fontFamily: FONTS.bodyMed, fontSize: 14, color: THEME.text },
  settingDesc: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted, lineHeight: 16 },
  settingDivider: { height: 1, backgroundColor: THEME.border, marginHorizontal: 16 },
  tokenCard: {
    backgroundColor: THEME.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 14,
    gap: 10,
  },
  tokenText: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted, lineHeight: 16 },
  tokenButtons: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  tokenBtn: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  tokenBtnText: { fontFamily: FONTS.bodyMed, fontSize: 12, color: THEME.accent },

  // Monke Tools
  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    borderBottomWidth: 0,
  },
  toolRowFirst: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  toolRowLast: { borderBottomWidth: 1, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  toolIconBox: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: THEME.surfaceHigh,
    borderWidth: 1, borderColor: THEME.border,
    alignItems: "center", justifyContent: "center",
  },
  toolIcon: { fontSize: 20 },
  toolInfo: { flex: 1, gap: 2 },
  toolName: { fontFamily: FONTS.displayMed, fontSize: 14, color: THEME.text },
  toolUrl: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint },

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
