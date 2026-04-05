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
 * Bot channel buttons (Bets/Trades/Sales) replace old stats row.
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
  TextInput,
  Linking,
  Switch,
  Alert,
  Platform,
} from "react-native";
import Slider from "@react-native-community/slider";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { THEME, FONTS, SKR_MINT, JUP_API_KEY } from "@/lib/constants";
import { useChatStore } from "@/store/chatStore";
import { useAppStore } from "@/store/appStore";
import { getCachedProfile, useProfileVersion } from "@/lib/userProfile";
import { ProfileScorecard } from "@/components/ProfileScorecard";
import { shortenAddress } from "@/lib/nftVerification";
import { clearPushToken, registerForPushNotifications, scheduleTestNotification } from "@/lib/notifications";
import { markChannelRead } from "@/lib/messageCache";
import { loadBananaState, type BananaState } from "@/lib/bananaRewards";
import { BananaShopModal } from "@/components/BananaShopModal";
import type { ProfileTarget } from "@/components/UserProfileModal";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { LeaderboardView } from "@/components/LeaderboardView";

const DRAWER_WIDTH_RATIO = 0.82;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const URL_REGEX = /https?:\/\/[^\s"'<>)]+/g;
const BOT_USERNAME = "AI Agent #9385";

type ActiveView = "list" | "messages" | "alerts" | "events" | "images" | "links" | "settings" | "tools" | "leaderboard";

const VIEW_TITLES: Record<ActiveView, string> = {
  list:        "Community",
  messages:    "Messages",
  alerts:      "AI Agent Alerts",
  events:      "Events",
  images:      "Shared Images",
  links:       "Shared Links",
  settings:    "App Settings",
  tools:       "Monke Tools",
  leaderboard: "Leaderboard",
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
  onStartLive?: () => void;
  onStartVideo?: () => void;
  onSearch?: () => void;
  onPressUser?: (target: ProfileTarget) => void;
  broadcastProfile?: () => void;
  onDevTip?: (amount: number) => void;
  onEditProfile?: () => void;
  onSwitchPfp?: () => void;
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

const SPORTS_LIST = [
  { key: "nfl", label: "NFL 🏈" },
  { key: "ncaaf", label: "NCAAF 🏈" },
  { key: "nba", label: "NBA 🏀" },
  { key: "ncaab", label: "NCAAB 🏀" },
  { key: "mlb", label: "MLB ⚾" },
  { key: "nhl", label: "NHL 🏒" },
  { key: "epl", label: "EPL ⚽" },
  { key: "ucl", label: "UCL ⚽" },
  { key: "mma", label: "MMA 🥊" },
] as const;

export function MenuDrawer({ visible, onClose, onCreateEvent, onStartLive, onStartVideo, onSearch, onPressUser, broadcastProfile, onDevTip, onEditProfile, onSwitchPfp }: MenuDrawerProps) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const { messages } = useChatStore();
  const calendarEvents = useAppStore(s => s.calendarEvents);
  const myInboxId = useAppStore(s => s.myInboxId);
  const notificationsEnabled = useAppStore(s => s.notificationsEnabled);
  const mentionsOnly = useAppStore(s => s.mentionsOnly);
  const botNotificationsEnabled = useAppStore(s => s.botNotificationsEnabled);
  const dmNotificationsEnabled = useAppStore(s => s.dmNotificationsEnabled);
  const liveRoomNotificationsEnabled = useAppStore(s => s.liveRoomNotificationsEnabled);
  const setNotificationsEnabled = useAppStore(s => s.setNotificationsEnabled);
  const setMentionsOnly = useAppStore(s => s.setMentionsOnly);
  const setBotNotificationsEnabled = useAppStore(s => s.setBotNotificationsEnabled);
  const setDmNotificationsEnabled = useAppStore(s => s.setDmNotificationsEnabled);
  const setLiveRoomNotificationsEnabled = useAppStore(s => s.setLiveRoomNotificationsEnabled);
  const mutedBotChannels = useAppStore(s => s.mutedBotChannels);
  const toggleBotChannelMute = useAppStore(s => s.toggleBotChannelMute);
  const mutedSports = useAppStore(s => s.mutedSports);
  const toggleSportMute = useAppStore(s => s.toggleSportMute);
  const expoPushToken = useAppStore(s => s.expoPushToken);
  const setExpoPushToken = useAppStore(s => s.setExpoPushToken);
  const communityBadges = useAppStore(s => s.communityBadges);
  const clearCommunityBadge = useAppStore(s => s.clearCommunityBadge);
  const themeOverrides = useAppStore(s => s.themeOverrides);
  const [activeView, setActiveView] = useState<ActiveView>("list");

  useProfileVersion();

  useEffect(() => {
    if (!visible) setActiveView("list");
  }, [visible]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const activeUsers = useMemo<ActiveUser[]>(() => {
    const cutoff = Date.now() - ONE_DAY_MS;
    // Dedup by username (same human can have multiple inboxIds after reinstalls)
    const seen = new Map<string, ActiveUser>();
    for (const msg of messages) {
      if (msg.sentAt.getTime() < cutoff) continue;
      const cached = getCachedProfile(msg.senderAddress);
      const msgNft = cached?.nftImage ?? msg.senderNft?.image ?? null;
      const msgUsername = cached?.username ?? msg.senderUsername;
      // Key by username when available, fall back to inboxId
      const key = msgUsername?.toLowerCase() || msg.senderAddress;
      if (!seen.has(key)) {
        seen.set(key, {
          inboxId: msg.senderAddress,
          username: msgUsername,
          nftImage: msgNft,
          lastSeen: msg.sentAt,
        });
      } else {
        const ex = seen.get(key)!;
        // Keep the most recent entry's inboxId
        const isNewer = msg.sentAt > ex.lastSeen;
        seen.set(key, {
          inboxId: isNewer ? msg.senderAddress : ex.inboxId,
          lastSeen: isNewer ? msg.sentAt : ex.lastSeen,
          nftImage: msgNft ?? ex.nftImage,
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
    const isBot = name === 'AI Agent #9385';
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
        ) : isBot ? (
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          <Image source={require('../../assets/ai_agent_avatar.png')} style={styles.userAvatar} />
        ) : (
          <View style={styles.userAvatarFallback} />
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

  function GridButton({
    icon, label, badge, onPress,
  }: {
    icon: string;
    label: string;
    badge?: number;
    onPress: () => void;
  }) {
    return (
      <Pressable
        style={({ pressed }) => [styles.gridBtn, pressed && { opacity: 0.7, transform: [{ scale: 0.95 }] }]}
        onPress={onPress}
      >
        <Text style={styles.gridIcon}>{icon}</Text>
        <Text style={styles.gridLabel}>{label}</Text>
        {badge !== undefined && badge > 0 && (
          <View style={styles.gridBadge}>
            <Text style={styles.gridBadgeText}>{badge}</Text>
          </View>
        )}
      </Pressable>
    );
  }

  // ── Back / close header ───────────────────────────────────────────────────

  const isList = activeView === "list";

  const [searchText, setSearchText] = useState("");
  const [shopOpen, setShopOpen] = useState(false);
  const [bananaState, setBananaState] = useState<BananaState | null>(null);
  const bananaBalance = useAppStore(s => s.bananaBalance);

  useEffect(() => {
    if (visible) loadBananaState().then(setBananaState);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.overlay} />
      </Pressable>

      <View style={[styles.popup, themeOverrides ? { backgroundColor: themeOverrides.surface ?? themeOverrides.bg } : null]}>
        {/* Glass gradient overlay */}
        <LinearGradient
          colors={["rgba(248,248,255,0.06)", "rgba(0,0,0,0.12)"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: 20 }]}
        />
        {/* Top highlight */}
        <View style={styles.glassHighlight} />
        {/* Header — only shown on sub-views (Back button) */}
        {!isList && (
          <View style={styles.drawerHeader}>
            <Pressable
              onPress={() => setActiveView("list")}
              style={styles.backBtn}
              hitSlop={10}
            >
              <Text style={styles.backIcon}>‹</Text>
              <Text style={styles.backLabel}>Back</Text>
            </Pressable>
            <Text style={styles.subViewTitle}>{VIEW_TITLES[activeView]}</Text>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={10}>
              <Text style={styles.closeIcon}>✕</Text>
            </Pressable>
          </View>
        )}

        {/* Content */}
        <ScrollView showsVerticalScrollIndicator={false} style={styles.content}>

          {/* ── Main grid ──────────────────────────────────────────────────── */}
          {activeView === "list" && (
            <>
              {/* Profile Scorecard */}
              <ProfileScorecard
                onEditProfile={() => { onClose(); onEditProfile?.(); }}
                onPressPfp={() => { onClose(); onSwitchPfp?.(); }}
                onClose={onClose}
              />

              {/* Banana Streak Bar + Balance + Shop */}
              {bananaState && (() => {
                const msLeft = bananaState.lastClaimTs > 0
                  ? Math.max(0, (bananaState.lastClaimTs + 24 * 60 * 60 * 1000) - Date.now())
                  : 0;
                const hrsLeft = Math.floor(msLeft / 3600000);
                const minsLeft = Math.floor((msLeft % 3600000) / 60000);
                const canClaim = msLeft === 0;
                return (
                <View style={styles.bananaSection}>
                  <View style={styles.bananaHeader}>
                    <Text style={styles.bananaTitle}>
                      Daily Streak{" "}
                      <Text style={{ fontSize: 11, fontFamily: FONTS.mono, color: canClaim ? "#22c55e" : THEME.textMuted }}>
                        {canClaim ? "Ready!" : `${hrsLeft}h ${minsLeft}m`}
                      </Text>
                    </Text>
                    <View style={styles.bananaBalancePill}>
                      <Text style={styles.bananaBalanceText}>{bananaBalance} 🍌</Text>
                    </View>
                  </View>
                  <View style={styles.bananaBar}>
                    {[1, 2, 3, 4, 5, 6, 7].map(day => {
                      const filled = day <= bananaState.streakDay;
                      return (
                        <View key={day} style={[
                          styles.bananaSlot,
                          filled && styles.bananaSlotFilled,
                        ]}>
                          <Text style={[styles.bananaSlotEmoji, !filled && { opacity: 0.2 }]}>🍌</Text>
                        </View>
                      );
                    })}
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.shopBtn, pressed && { opacity: 0.8 }]}
                    onPress={() => setShopOpen(true)}
                  >
                    <Text style={styles.shopBtnText}>🛒 Banana Shop</Text>
                  </Pressable>
                </View>
                );
              })()}

              {/* Search bar */}
              <View style={styles.searchBar}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search messages…"
                  placeholderTextColor={THEME.textFaint}
                  value={searchText}
                  onChangeText={setSearchText}
                  onSubmitEditing={() => {
                    if (searchText.trim() && onSearch) {
                      onClose();
                      setTimeout(onSearch, 280);
                    }
                  }}
                  returnKeyType="search"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Grid of icon buttons */}
              <View style={styles.gridContainer}>
                <GridButton
                  icon="✉️"
                  label="Messages"
                  badge={communityBadges.dms || undefined}
                  onPress={() => { clearCommunityBadge('dms'); markChannelRead('dms').catch(() => {}); onClose(); setTimeout(() => router.push('/dms'), 300); }}
                />
                <GridButton
                  icon="📅"
                  label="Events"
                  badge={communityBadges.events || undefined}
                  onPress={() => { clearCommunityBadge('events'); setActiveView("events"); }}
                />
                <GridButton
                  icon="🔗"
                  label="Links"
                  badge={communityBadges.links || undefined}
                  onPress={() => { clearCommunityBadge('links'); setActiveView("links"); }}
                />
                <GridButton
                  icon="🏪"
                  label="Marketplace"
                  onPress={() => { onClose(); setTimeout(() => router.push('/marketplace'), 300); }}
                />
                <GridButton
                  icon="🏆"
                  label="Leaderboard"
                  onPress={() => setActiveView("leaderboard")}
                />
                <GridButton
                  icon="💼"
                  label="Portfolio"
                  onPress={() => { onClose(); setTimeout(() => router.push('/portfolio' as any), 300); }}
                />
                <GridButton
                  icon="🔧"
                  label="Tools"
                  onPress={() => setActiveView("tools")}
                />
                <GridButton
                  icon="⚙️"
                  label="Settings"
                  onPress={() => { onClose(); setTimeout(() => router.push('/settings' as any), 300); }}
                />
              </View>
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
                    const isBot = name === 'AI Agent #9385';
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
                        ) : isBot ? (
                          // eslint-disable-next-line @typescript-eslint/no-require-imports
                          <Image source={require('../../assets/ai_agent_avatar.png')} style={styles.userAvatar} />
                        ) : (
                          <View style={styles.userAvatarFallback} />
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
                sortedEvents.map((evt) => {
                  // Show "Go Live" for OnlyMonkes events whose start time has passed (within 2h)
                  const isOnlyMonkes = evt.location?.toLowerCase() === "onlymonkes";
                  const evtDate = new Date(`${evt.date} ${evt.time || "00:00"}`);
                  const now = Date.now();
                  const msSinceStart = now - evtDate.getTime();
                  const isLive = isOnlyMonkes && msSinceStart >= 0 && msSinceStart < 2 * 60 * 60 * 1000;

                  return (
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
                        {isLive && onStartLive && (
                          <Pressable
                            style={({ pressed }) => [styles.startLiveBtn, pressed && { opacity: 0.75 }]}
                            onPress={() => { onClose(); onStartLive(); }}
                          >
                            <View style={styles.startLiveDot} />
                            <Text style={styles.startLiveBtnText}>Start Live Audio Chat</Text>
                          </Pressable>
                        )}
                        {isLive && onStartVideo && (
                          <Pressable
                            style={({ pressed }) => [styles.startLiveBtn, { marginTop: 6, backgroundColor: '#0096C7' }, pressed && { opacity: 0.75 }]}
                            onPress={() => { onClose(); onStartVideo(); }}
                          >
                            <Text style={styles.startLiveBtnText}>Start Video Call</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                })
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
                    <View style={styles.linkDot} />
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
                <View style={styles.settingDivider} />
                <View style={styles.settingRow}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>DM notifications</Text>
                    <Text style={styles.settingDesc}>Push alerts for direct messages</Text>
                  </View>
                  <Switch
                    value={dmNotificationsEnabled}
                    onValueChange={setDmNotificationsEnabled}
                    trackColor={{ false: THEME.border, true: THEME.accent + "88" }}
                    thumbColor={dmNotificationsEnabled ? THEME.accent : THEME.textFaint}
                  />
                </View>
                <View style={styles.settingDivider} />
                <View style={styles.settingRow}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Live room alerts</Text>
                    <Text style={styles.settingDesc}>Notify when a live audio room starts</Text>
                  </View>
                  <Switch
                    value={liveRoomNotificationsEnabled}
                    onValueChange={setLiveRoomNotificationsEnabled}
                    trackColor={{ false: THEME.border, true: THEME.accent + "88" }}
                    thumbColor={liveRoomNotificationsEnabled ? THEME.accent : THEME.textFaint}
                  />
                </View>
              </View>

              {/* ── Per-Bot-Channel Mutes ──────────────────────────────── */}
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Bot Channel Alerts</Text>
              <View style={styles.settingsCard}>
                {(["bets", "trades", "sales", "predictions"] as const).map((ch, i) => (
                  <React.Fragment key={ch}>
                    {i > 0 && <View style={styles.settingDivider} />}
                    <View style={styles.settingRow}>
                      <View style={styles.settingInfo}>
                        <Text style={styles.settingTitle}>{ch.charAt(0).toUpperCase() + ch.slice(1)}</Text>
                        <Text style={styles.settingDesc}>
                          {mutedBotChannels[ch] ? "Muted — no push alerts" : "Push alerts enabled"}
                        </Text>
                      </View>
                      <Switch
                        value={!mutedBotChannels[ch]}
                        onValueChange={() => { toggleBotChannelMute(ch); broadcastProfile?.(); }}
                        trackColor={{ false: THEME.border, true: THEME.accent + "88" }}
                        thumbColor={!mutedBotChannels[ch] ? THEME.accent : THEME.textFaint}
                      />
                    </View>
                  </React.Fragment>
                ))}
              </View>

              {/* ── MonkeBets Sports Filter ────────────────────────────── */}
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>MonkeBets Sports Filter</Text>
              <Text style={[styles.settingDesc, { marginBottom: 8, paddingHorizontal: 4 }]}>
                Tap to mute sports you don't want alerts for
              </Text>
              <View style={styles.sportsPillRow}>
                {SPORTS_LIST.map(({ key, label }) => {
                  const muted = mutedSports.includes(key);
                  return (
                    <Pressable
                      key={key}
                      style={[styles.sportPill, muted && styles.sportPillMuted]}
                      onPress={() => { toggleSportMute(key); broadcastProfile?.(); }}
                    >
                      <Text style={[styles.sportPillText, muted && styles.sportPillTextMuted]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Text Size</Text>
              <View style={styles.settingsCard}>
                <View style={styles.settingRow}>
                  <Text style={[styles.settingTitle, { fontSize: 12 }]}>A</Text>
                  <View style={{ flex: 1, marginHorizontal: 12 }}>
                    <Slider
                      minimumValue={0.85}
                      maximumValue={1.3}
                      step={0.05}
                      value={useAppStore.getState().textScale ?? 1.0}
                      onSlidingComplete={(val: number) => useAppStore.getState().setTextScale(val)}
                      minimumTrackTintColor={THEME.accent}
                      maximumTrackTintColor={THEME.border}
                      thumbTintColor={THEME.accent}
                    />
                  </View>
                  <Text style={[styles.settingTitle, { fontSize: 20 }]}>A</Text>
                </View>
                <Text style={[styles.settingDesc, { textAlign: "center", marginTop: 4 }]}>
                  Adjusts message text size ({Math.round((useAppStore.getState().textScale ?? 1) * 100)}%)
                </Text>
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

          {/* ── Leaderboard ─────────────────────────────────────────────────── */}
          {activeView === "leaderboard" && (
            <LeaderboardView />
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

              {/* ── Support OnlyMonkes ────────────────────────────────────── */}
              <SupportCard onDevTip={onDevTip} />
            </>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>

        <Text style={styles.footerHint}>OnlyMonkes · Saga Monkes holders</Text>
      </View>

      <BananaShopModal visible={shopOpen} onClose={() => setShopOpen(false)} />
    </Modal>
  );
}

// ─── Support OnlyMonkes card ──────────────────────────────────────────────────

const DEV_WALLET = "7tLrnPvgcR5mLtyUcVwvmhAD1wXbAKgWcLBPWxpwyZ1J";

function buildSupportLink(amount?: number): string {
  const skrMint = SKR_MINT;
  const jupApiKey = JUP_API_KEY;

  if (skrMint) {
    // Solana Pay: opens Seed Vault / any Solana wallet to send SKR directly
    let uri = `solana:${DEV_WALLET}?spl-token=${skrMint}`;
    if (amount) uri += `&amount=${amount}`;
    uri += `&label=${encodeURIComponent("Support OnlyMonkes")}&message=${encodeURIComponent("Help build the future of OnlyMonkes 🐒")}`;
    return uri;
  }
  // Fallback: Jupiter swap SOL → SKR (SKR_MINT not set yet)
  let url = `https://jup.ag/swap/SOL-SKR?outputMint=${DEV_WALLET}`;
  if (jupApiKey) url += `&referralKey=${DEV_WALLET}&feeBps=50`;
  return url;
}

function SupportCard({ onDevTip }: { onDevTip?: (amount: number) => void }) {
  const [amount, setAmount] = React.useState("10");
  const [sending, setSending] = React.useState(false);
  const amounts = ["5", "10", "25", "50"];

  const handleSend = React.useCallback(async () => {
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) return;
    if (onDevTip) {
      // In-app MWA tip — one-tap biometric, never leaves the app
      onDevTip(val);
    } else {
      // Fallback: Solana Pay deep link (shouldn't happen but safety net)
      const link = buildSupportLink(val);
      Linking.openURL(link).catch(() => {});
    }
  }, [amount, onDevTip]);

  return (
    <View style={supportStyles.card}>
      <Text style={supportStyles.heading}>Help Support OnlyMonkes</Text>
      <Text style={supportStyles.sub}>
        One-tap $SKR tip to the dev wallet 🐒{"\n"}Biometric confirm — never leaves the app.
      </Text>

      <View style={supportStyles.pills}>
        {amounts.map((a) => (
          <Pressable
            key={a}
            style={[supportStyles.pill, amount === a && supportStyles.pillActive]}
            onPress={() => setAmount(a)}
          >
            <Text style={[supportStyles.pillText, amount === a && supportStyles.pillTextActive]}>
              {a} SKR
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={({ pressed }) => [supportStyles.btn, pressed && { opacity: 0.8 }, sending && { opacity: 0.5 }]}
        onPress={handleSend}
        disabled={sending}
      >
        <Text style={supportStyles.btnText}>
          {sending ? "Sending…" : `Send ${amount} $SKR  🐒`}
        </Text>
      </Pressable>

      <Text style={supportStyles.wallet} selectable numberOfLines={1} ellipsizeMode="middle">
        {DEV_WALLET}
      </Text>
    </View>
  );
}

const supportStyles = StyleSheet.create({
  card: {
    marginTop: 20,
    marginHorizontal: 2,
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#7C3AED44",
    padding: 16,
    gap: 10,
  },
  heading: {
    fontFamily: FONTS.heading,
    fontSize: 14,
    color: THEME.text,
    textAlign: "center",
  },
  sub: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textDim,
    textAlign: "center",
    lineHeight: 17,
  },
  pills: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  pill: {
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
  },
  pillActive: {
    borderColor: "#7C3AED",
    backgroundColor: "#7C3AED22",
  },
  pillText: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textDim },
  pillTextActive: { color: "#A78BFA", fontFamily: FONTS.bodyMed },
  btn: {
    backgroundColor: "#7C3AED",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnText: { fontFamily: FONTS.heading, fontSize: 14, color: "#fff" },
  customBtn: { alignItems: "center", paddingVertical: 4 },
  customBtnText: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textDim },
  wallet: {
    fontFamily: FONTS.mono ?? FONTS.body,
    fontSize: 10,
    color: THEME.textFaint,
    textAlign: "center",
  },
});

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
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  popup: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 90,
    bottom: 80,
    backgroundColor: "rgba(8, 8, 16, 0.94)",
    borderRadius: 20,
    marginHorizontal: 8,
    borderWidth: 0.75,
    borderColor: "rgba(255, 255, 255, 0.06)",
    overflow: "hidden",
  },
  glassHighlight: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    height: 1.5,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 1,
    zIndex: 1,
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
    color: "#6CB4EE",
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

  // Bot Channel Buttons
  botChannelsRow: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
    marginHorizontal: 20,
    marginBottom: 14,
    gap: 12,
  },
  botChannelBtn: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  botChannelImg: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  botChannelBadge: {
    position: "absolute",
    top: -2,
    right: -4,
    backgroundColor: "#EF4444",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: THEME.surfaceHigh,
  },
  botChannelBadgeText: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: "#fff",
    fontWeight: "700",
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

  // Banana streak section
  bananaSection: {
    marginBottom: 16,
    backgroundColor: "rgba(6, 6, 14, 0.80)",
    borderRadius: 16,
    borderWidth: 0.75,
    borderColor: "rgba(255, 213, 79, 0.10)",
    padding: 14,
    gap: 10,
  },
  bananaHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bananaTitle: {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: "#FFD54F",
  },
  bananaBalancePill: {
    backgroundColor: "rgba(255, 213, 79, 0.1)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(255, 213, 79, 0.15)",
  },
  bananaBalanceText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: "#FFD54F",
    fontWeight: "600",
  },
  bananaBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 4,
  },
  bananaSlot: {
    flex: 1,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  bananaSlotFilled: {
    backgroundColor: "rgba(255, 213, 79, 0.12)",
    borderColor: "rgba(255, 213, 79, 0.25)",
  },
  bananaSlotEmoji: {
    fontSize: 16,
  },
  shopBtn: {
    backgroundColor: "rgba(6, 6, 14, 0.75)",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 0.75,
    borderColor: "rgba(255, 213, 79, 0.12)",
  },
  shopBtnText: {
    fontFamily: FONTS.displayMed,
    fontSize: 13,
    color: "#FFD54F",
  },

  // Search bar
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(6, 6, 14, 0.75)",
    borderRadius: 14,
    borderWidth: 0.75,
    borderColor: "rgba(255, 255, 255, 0.06)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 20,
    gap: 8,
  },
  searchIcon: { fontSize: 16 },
  searchInput: {
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.text,
    padding: 0,
    margin: 0,
  },

  // Grid buttons
  gridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 24,
  },
  gridBtn: {
    width: "30%",
    aspectRatio: 1,
    backgroundColor: "rgba(6, 6, 14, 0.80)",
    borderRadius: 16,
    borderWidth: 0.75,
    borderColor: "rgba(255, 255, 255, 0.06)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  gridIcon: { fontSize: 28 },
  gridLabel: {
    fontFamily: FONTS.bodyMed,
    fontSize: 11,
    color: THEME.textMuted,
    textAlign: "center",
  },
  gridBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "#EF4444",
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  gridBadgeText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "#fff",
    fontWeight: "700",
  },

  // Menu list (for sub-views)
  menuList: {
    marginBottom: 20,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 10,
    marginBottom: 4,
    borderRadius: 12,
    backgroundColor: "rgba(6, 6, 14, 0.55)",
    borderWidth: 0.5,
    borderColor: "rgba(255, 255, 255, 0.04)",
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
    backgroundColor: "#6CB4EE",
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
  userAvatar: { width: 38, height: 38, borderRadius: 19 },
  userAvatarFallback: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: THEME.accentSoft,
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
  startLiveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#2D0A0A",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#EF4444",
  },
  startLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#EF4444" },
  startLiveBtnText: { fontFamily: FONTS.bodySemi, fontSize: 12, color: "#EF4444" },

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
  linkDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: THEME.accent },
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
  sportsPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 4,
  },
  sportPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: THEME.accent + "22",
    borderWidth: 1,
    borderColor: THEME.accent + "44",
  },
  sportPillMuted: {
    backgroundColor: THEME.surface,
    borderColor: THEME.border,
    opacity: 0.5,
  },
  sportPillText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 12,
    color: THEME.accent,
  },
  sportPillTextMuted: {
    color: THEME.textMuted,
    textDecorationLine: "line-through" as const,
  },
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
