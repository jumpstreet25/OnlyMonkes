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

import React, { useEffect, useRef, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  BackHandler,
  useWindowDimensions,
  Image,
  ScrollView,
  TextInput,
  Linking,
  Switch,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Slider from "@react-native-community/slider";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { toast } from "sonner-native";
import { THEME, FONTS, SKR_MINT, JUP_API_KEY, getWorldBarTint, getWorldAccent } from "@/lib/constants";
import { MenuIcon, type MenuIconName } from "@/components/MenuIcon";
import { WorldLayer } from "@/components/worlds/WorldLayer";
import { useThemeColor } from "@/lib/shopTheme";
import { useChatStore } from "@/store/chatStore";
import { useAppStore, type CalendarEvent } from "@/store/appStore";
import { getCachedProfile, useProfileVersion } from "@/lib/userProfile";
import { fetchSolanaEvents, type LumaEvent } from "@/lib/lumaEvents";
import { ProfileScorecard } from "@/components/ProfileScorecard";
import { shortenAddress } from "@/lib/nftVerification";
import { clearPushToken, registerForPushNotifications, scheduleTestNotification } from "@/lib/notifications";
import { markChannelRead } from "@/lib/messageCache";
import { loadBananaState, type BananaState } from "@/lib/bananaRewards";
import { BananaShopModal } from "@/components/BananaShopModal";
import { ReclaimModal } from "@/components/ReclaimModal";
import type { ProfileTarget } from "@/components/UserProfileModal";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { GLASS_GRADIENT_COLORS, HIGHLIGHT, getBlurProps } from "@/lib/glassTheme";
import { LeaderboardView } from "@/components/LeaderboardView";
import { EventRsvpModal } from "@/components/EventRsvpModal";
import { getAttendeeCount } from "@/lib/eventRsvp";
import { CHAT_THEMES, saveThemeId } from "@/lib/theme";
import { WebViewModal } from "@/components/WebViewModal";

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
  const [rsvpEvent, setRsvpEvent] = useState<CalendarEvent | null>(null);
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
  const botChannelCounts = useAppStore(s => s.botChannelCounts);
  const clearBotChannelCount = useAppStore(s => s.clearBotChannelCount);
  const themeOverrides = useAppStore(s => s.themeOverrides);
  const themeId = useAppStore(s => s.themeId);
  const setThemeId = useAppStore(s => s.setThemeId);
  const shopThemeActive = !!themeOverrides;
  const themeBg = useThemeColor('bg');
  const themeSurface = useThemeColor('surface');
  const themeBorder = useThemeColor('border');
  const themeAccent = useThemeColor('accent');
  // (v36 2026-05-09) Per-world chrome — drawer adopts the world's tint
  // and accent so it feels like part of the same world layer instead
  // of a separate dark slab. Falls back to themeSurface / themeAccent
  // when no world is equipped.
  const shopStyles = useAppStore(s => s.shopStyles);
  const worldId = shopStyles?.worldId as string | undefined;
  const drawerBg = worldId ? getWorldBarTint(worldId) : themeSurface;
  const iconAccent = themeOverrides ? themeAccent : (worldId ? getWorldAccent(worldId) : '#6CB4EE');
  // (v40 2026-05-09) Hex → rgba helper so per-world chrome (search bar
  // border, etc.) can tint at low alpha without hardcoding rgba per world.
  const accentRgba = useCallback((alpha: number) => {
    const hex = iconAccent.replace('#', '');
    if (hex.length !== 6) return iconAccent; // already rgba/named — leave it
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }, [iconAccent]);
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

  // Lu.ma-sourced Solana ecosystem events. Fetched lazily when the user
  // opens the Events tab. fetchSolanaEvents has a 6h AsyncStorage cache so
  // repeat opens are free. Same data the MonkeGlobe uses — just surfacing
  // it in the drawer too.
  const [solanaEvents, setSolanaEvents] = useState<LumaEvent[]>([]);
  const [solanaEventsLoading, setSolanaEventsLoading] = useState(false);
  const [solanaEventsLoaded, setSolanaEventsLoaded] = useState(false);
  useEffect(() => {
    if (activeView !== "events" || solanaEventsLoaded) return;
    let cancelled = false;
    setSolanaEventsLoading(true);
    fetchSolanaEvents()
      .then((evts) => {
        if (cancelled) return;
        // Future events only, sorted soonest-first, capped to 12 to keep the
        // drawer scroll reasonable.
        const now = Date.now();
        const upcoming = evts
          .filter((e) => {
            const t = Date.parse(e.startAt);
            return Number.isFinite(t) && t > now;
          })
          .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
          .slice(0, 12);
        setSolanaEvents(upcoming);
        setSolanaEventsLoaded(true);
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => { if (!cancelled) setSolanaEventsLoading(false); });
    return () => { cancelled = true; };
  }, [activeView, solanaEventsLoaded]);


  const sortedEvents = useMemo(() => {
    const now = Date.now();
    return [...calendarEvents]
      .filter((evt) => {
        // Parse "MM/DD/YYYY" date — keep events that haven't ended yet
        const [mm, dd, yyyy] = (evt.date ?? "").split("/").map(Number);
        if (!mm || !dd || !yyyy) return true; // can't parse, keep it
        // Parse time flexibly: "9:00", "09:00", "18:00", "9", "9am", "9:00 AM"
        const timeStr = (evt.time ?? "").trim().toLowerCase().replace(/\s*(am|pm)\s*$/i, (_, m) => m);
        let hh = NaN, min = 0;
        if (timeStr.includes(":")) {
          const parts = timeStr.replace(/[ap]m/, "").split(":").map(Number);
          hh = parts[0]; min = parts[1] || 0;
        } else if (/^\d{1,2}$/.test(timeStr.replace(/[ap]m/, ""))) {
          hh = parseInt(timeStr, 10);
        }
        if (timeStr.includes("pm") && !isNaN(hh) && hh < 12) hh += 12;
        if (timeStr.includes("am") && hh === 12) hh = 0;
        const hasTime = !isNaN(hh);
        const eventStart = new Date(yyyy, mm - 1, dd, hasTime ? hh : 23, hasTime ? min : 59, 0).getTime();
        const eventEnd = hasTime ? eventStart + 2 * 3600000 : eventStart;
        return eventEnd >= now;
      })
      .sort((a, b) => {
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
    const name = cached?.username ?? user.username ?? 'Monke';
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
    iconName, label, badge, onPress,
  }: {
    iconName: MenuIconName;
    label: string;
    badge?: number;
    onPress: () => void;
  }) {
    return (
      <Pressable
        style={({ pressed }) => [styles.gridBtn, pressed && { opacity: 0.7, transform: [{ scale: 0.95 }] }]}
        onPress={onPress}
        accessibilityLabel={label}
        accessibilityRole="button"
      >
        <MenuIcon name={iconName} size={28} color={iconAccent} />
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
  const [reclaimOpen, setReclaimOpen] = useState(false);
  const [webView, setWebView] = useState<{ url: string; title: string } | null>(null);
  const [bananaState, setBananaState] = useState<BananaState | null>(null);
  const bananaBalance = useAppStore(s => s.bananaBalance);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) loadBananaState().then(setBananaState);
  }, [visible]);

  // 2026-07-23: replaces RN's <Modal> — Android implements Modal as a
  // SEPARATE native Dialog window from the Activity, which BlurView (below)
  // can't see across to actually blur the real content behind it (confirmed
  // on-device: no visible blur, just a flat tint). Rendering directly in the
  // component tree instead keeps this in the same window as everything
  // else, matching how GlassBottomSheet already avoids this exact problem.
  // shouldRender stays true through the fade-out so the close animation
  // still plays instead of popping off instantly.
  //
  // 2026-08-05: was a useState mirroring `visible`, flipped true only
  // inside the effect below — see the matching, more detailed note in
  // GlassModal.tsx. That effect was observed not taking hold for 800ms+
  // during high JS-thread load (e.g. right after cold boot, when this
  // exact drawer's first render can coincide with XMTP sync churn),
  // leaving the drawer invisible despite visible=true. Deriving
  // shouldRender directly from `visible` removes the effect-timing
  // dependency for the open path; isClosing is effect-driven only for
  // the close fade-out.
  const [isClosing, setIsClosing] = useState(false);
  const shouldRender = visible || isClosing;
  const fadeAnim = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      setIsClosing(false);
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else {
      setIsClosing(true);
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setIsClosing(false);
      });
    }
  }, [visible]);

  // Replaces Modal's onRequestClose — Android hardware/gesture back button.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (activeView !== "list") { setActiveView("list"); } else { onClose(); }
      return true;
    });
    return () => sub.remove();
  }, [visible, activeView, onClose]);

  if (!shouldRender) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: fadeAnim, zIndex: 1000, elevation: 1000 }]}
      pointerEvents={visible ? "auto" : "none"}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
        <View style={styles.overlay} />
      </Pressable>

      <View style={[styles.popup, { paddingTop: insets.top + 12, borderColor: themeBorder }, worldId ? null : { backgroundColor: drawerBg }]}>
        {/* 2026-07-24: card's own BlurView, matching GlassModal/GlassCard —
            the backdrop BlurView (above, in the Pressable) only ever blurred
            the dismiss-tap area, never this popup's own (previously 0.96-
            opaque) fill. No-op when a world is equipped — WorldLayer below
            renders opaque on top of it by design (see the comment there). */}
        <BlurView {...getBlurProps()} style={StyleSheet.absoluteFill} />
        {/* (v37 2026-05-09) When a world is equipped, render the WorldLayer
            (paused) inside the drawer so its background — gradient,
            silhouette skyline, dappled-light orbs — shows through behind
            the menu content. Replaces the translucent tint that was
            letting the live chat bleed through. active={false} stops
            world animations while the drawer is open so we're not
            double-rendering banana mowers etc. */}
        {worldId ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <WorldLayer active={false} />
          </View>
        ) : null}
        {/* Glass gradient overlay */}
        <LinearGradient
          colors={GLASS_GRADIENT_COLORS}
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
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <Text style={styles.backIcon}>‹</Text>
              <Text style={styles.backLabel}>Back</Text>
            </Pressable>
            <Text style={styles.subViewTitle}>{VIEW_TITLES[activeView]}</Text>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={10} accessibilityLabel="Close menu" accessibilityRole="button">
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
                    {/* Banana balance pill — Skia banana + count (v39).
                        Banana stays brand-yellow regardless of world. */}
                    <View style={styles.bananaBalancePill}>
                      <Text style={styles.bananaBalanceText}>{bananaBalance}</Text>
                      <MenuIcon name="banana" size={13} color="#FFD24A" />
                    </View>
                  </View>
                  {/* 7-day streak strip — Skia banana per slot (v39).
                      Filled slots: full opacity yellow. Unfilled: 0.2 alpha. */}
                  <View style={styles.bananaBar}>
                    {[1, 2, 3, 4, 5, 6, 7].map(day => {
                      const filled = day <= bananaState.streakDay;
                      return (
                        <View key={day} style={[
                          styles.bananaSlot,
                          filled && styles.bananaSlotFilled,
                          !filled && { opacity: 0.2 },
                        ]}>
                          <MenuIcon name="banana" size={20} color="#FFD24A" />
                        </View>
                      );
                    })}
                  </View>
                  {/* Banana Shop button — Skia cart (iconAccent) + label (v39) */}
                  <Pressable
                    style={({ pressed }) => [styles.shopBtn, pressed && { opacity: 0.8 }]}
                    onPress={() => setShopOpen(true)}
                  >
                    <MenuIcon name="cart" size={16} color={iconAccent} />
                    <Text style={styles.shopBtnText}>Banana Shop</Text>
                  </Pressable>
                </View>
                );
              })()}

              {/* Search bar (v40 polish): world-aware border tint + Skia
                  magnifier replacing the 🔍 emoji. Icon + border use the
                  same iconAccent priority chain (PFP-theme > world > blue). */}
              <View style={[
                styles.searchBar,
                worldId ? { borderColor: accentRgba(0.22) } : null,
              ]}>
                <MenuIcon name="search" size={16} color={iconAccent} />
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

              {/* (v36 2026-05-09) Single combined "Menu" section. Bot
                  channel grid removed — already accessible from the main
                  chat bottom toolbar. Community + Tools merged. */}
              <Text style={[styles.navSectionLabel, worldId ? { color: iconAccent } : null]}>Menu</Text>
              <View style={styles.gridContainer}>
                <GridButton
                  iconName="messages"
                  label="Messages"
                  badge={communityBadges.dms || undefined}
                  onPress={() => { clearCommunityBadge('dms'); markChannelRead('dms').catch(() => {}); onClose(); setTimeout(() => router.push('/dms'), 300); }}
                />
                <GridButton
                  iconName="leaderboard"
                  label="Leaderboard"
                  onPress={() => setActiveView("leaderboard")}
                />
                <GridButton
                  iconName="events"
                  label="Events"
                  badge={communityBadges.events || undefined}
                  onPress={() => { clearCommunityBadge('events'); setActiveView("events"); }}
                />
                <GridButton
                  iconName="images"
                  label="Images"
                  onPress={() => setActiveView("images")}
                />
                <GridButton
                  iconName="links"
                  label="Links"
                  badge={communityBadges.links || undefined}
                  onPress={() => { clearCommunityBadge('links'); setActiveView("links"); }}
                />
                <GridButton
                  iconName="monkemarkets"
                  label="MonkeMarkets"
                  onPress={() => { onClose(); setTimeout(() => router.push('/marketplace'), 300); }}
                />
                <GridButton
                  iconName="portfolio"
                  label="Portfolio"
                  onPress={() => { onClose(); setTimeout(() => router.push('/portfolio' as any), 300); }}
                />
                <GridButton
                  iconName="watchlist"
                  label="Watchlist"
                  onPress={() => { onClose(); setTimeout(() => router.push('/watchlist' as any), 300); }}
                />
                <GridButton
                  iconName="globe"
                  label="Globe"
                  onPress={() => { onClose(); setTimeout(() => router.push('/globe' as any), 300); }}
                />
                <GridButton
                  iconName="monketools"
                  label="Monke Tools"
                  onPress={() => setActiveView("tools")}
                />
                <GridButton
                  iconName="settings"
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
                    const name = cached?.username ?? u.username ?? 'Monke';
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
                <Text style={styles.emptyText}>No community events yet. Tap + Add Event to create one.</Text>
              ) : (
                sortedEvents.map((evt) => {
                  // Show "Go Live" for OnlyMonkes events whose start time has passed (within 2h)
                  const isOnlyMonkes = evt.location?.toLowerCase() === "onlymonkes";
                  const evtDate = new Date(`${evt.date} ${evt.time || "00:00"}`);
                  const now = Date.now();
                  const msSinceStart = now - evtDate.getTime();
                  const isLive = isOnlyMonkes && msSinceStart >= 0 && msSinceStart < 2 * 60 * 60 * 1000;

                  const attendees = getAttendeeCount(evt.id);
                  return (
                    <Pressable key={evt.id} style={styles.eventRow} onPress={() => setRsvpEvent(evt)}>
                      <View style={styles.eventDateBadge}>
                        <Text style={styles.eventDateText}>
                          {evt.date.split("/").slice(0, 2).join("/")}
                        </Text>
                      </View>
                      <View style={styles.eventInfo}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={[styles.eventTitle, { flex: 1 }]} numberOfLines={1}>{evt.title}</Text>
                          {attendees > 0 && <Text style={{ fontFamily: FONTS.mono, fontSize: 10, color: "#FFD54F" }}>{attendees} 🐒</Text>}
                        </View>
                        {evt.time ? <Text style={styles.eventMeta}>{evt.time}{evt.location ? ` · ${evt.location}` : ""}</Text> : null}
                        {evt.purpose ? <Text style={styles.eventPurpose} numberOfLines={2}>{evt.purpose}</Text> : null}
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                          <Text style={styles.eventCreator}>by {evt.creatorUsername ?? getCachedProfile(evt.creatorInboxId)?.username ?? 'Monke'}</Text>
                          {evt.creatorInboxId === myInboxId && (
                            <Pressable
                              hitSlop={8}
                              onPress={() => {
                                Alert.alert("Delete Event", `Remove "${evt.title}"?`, [
                                  { text: "Cancel", style: "cancel" },
                                  { text: "Delete", style: "destructive", onPress: async () => {
                                    const { deleteEvent } = await import("@/lib/calendar");
                                    await deleteEvent(evt.id);
                                    const { loadEvents } = await import("@/lib/calendar");
                                    const updated = await loadEvents();
                                    useAppStore.getState().setCalendarEvents(updated);
                                  }},
                                ]);
                              }}
                            >
                              <Text style={{ fontFamily: FONTS.mono, fontSize: 10, color: THEME.error }}>Delete</Text>
                            </Pressable>
                          )}
                        </View>
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
                    </Pressable>
                  );
                })
              )}

              {/* ── Solana Ecosystem (Lu.ma) ─────────────────────────────── */}
              <View style={[styles.eventsHeader, { marginTop: 18 }]}>
                <Text style={styles.sectionLabel}>🌐 Solana Ecosystem</Text>
              </View>
              {solanaEventsLoading ? (
                <View style={{ paddingVertical: 12, alignItems: "center" }}>
                  <ActivityIndicator size="small" color={THEME.accent} />
                </View>
              ) : solanaEvents.length === 0 ? (
                <Text style={styles.emptyText}>
                  No upcoming Solana events. Pulled from Lu.ma every 6h.
                </Text>
              ) : (
                solanaEvents.map((evt) => {
                  const start = new Date(evt.startAt);
                  const dateStr = `${(start.getMonth() + 1)}/${start.getDate()}`;
                  const timeStr = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                  return (
                    <Pressable
                      key={`luma-${evt.id}`}
                      style={styles.eventRow}
                      onPress={() => Linking.openURL(evt.url).catch(() => {})}
                    >
                      <View style={styles.eventDateBadge}>
                        <Text style={styles.eventDateText}>{dateStr}</Text>
                      </View>
                      <View style={styles.eventInfo}>
                        <Text style={styles.eventTitle} numberOfLines={1}>{evt.name}</Text>
                        <Text style={styles.eventMeta}>{timeStr}{evt.location ? ` · ${evt.location}` : ""}</Text>
                        <Text style={styles.eventCreator}>via Lu.ma · tap to open</Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </>
          )}

          {/* Event RSVP modal */}
          <EventRsvpModal
            visible={!!rsvpEvent}
            event={rsvpEvent}
            onClose={() => setRsvpEvent(null)}
          />

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
                          {getCachedProfile(msg.senderAddress)?.username ?? msg.senderUsername ?? 'Monke'}
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

              {/* ── Chat Theme ────────────────────────────────────────── */}
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Chat Theme</Text>
              {shopThemeActive && (
                <View style={styles.shopThemeBanner}>
                  <Text style={styles.shopThemeBannerIcon}>🍌</Text>
                  <Text style={styles.shopThemeBannerText}>
                    Banana Shop theme is active — unequip it to use these
                  </Text>
                </View>
              )}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.themeRow}
              >
                {CHAT_THEMES.map((t) => {
                  const selected = themeId === t.id;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={async () => {
                        if (shopThemeActive) return;
                        setThemeId(t.id);
                        await saveThemeId(t.id);
                        Haptics.selectionAsync().catch(() => {});
                      }}
                      disabled={shopThemeActive}
                      style={[
                        styles.themeCard,
                        selected && styles.themeCardSelected,
                        shopThemeActive && styles.themeCardDimmed,
                      ]}
                    >
                      <View style={[styles.themeSwatch, { backgroundColor: t.ownBubble }]}>
                        <Text style={styles.themeEmoji}>{t.emoji}</Text>
                      </View>
                      <Text
                        style={[styles.themeName, selected && { color: "#FFD54F" }]}
                        numberOfLines={1}
                      >
                        {t.name}
                      </Text>
                      <View style={[styles.themeAccentBar, { backgroundColor: t.accentColor }]} />
                      {selected && <Text style={styles.themeCheck}>✓</Text>}
                    </Pressable>
                  );
                })}
              </ScrollView>

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
                        toast.success("Copied to clipboard");
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

              {/* ── Account Recovery ──────────────────────────────────── */}
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Account Recovery</Text>
              <View style={styles.settingsCard}>
                <Pressable
                  style={styles.settingRow}
                  onPress={() => setReclaimOpen(true)}
                >
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Restore from previous device</Text>
                    <Text style={styles.settingDesc}>
                      Sign with your wallet to recover bananas, shop items, marketplace history, and your hot wallet.
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              </View>

              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Legal</Text>
              <View style={styles.settingsCard}>
                <Pressable
                  style={styles.settingRow}
                  onPress={() => Linking.openURL("https://onlymonkes-actions.jumpstreet25.workers.dev/terms")}
                >
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Terms of Use & EULA</Text>
                    <Text style={styles.settingDesc}>End-user license agreement and terms of use</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
                <View style={styles.settingDivider} />
                <Pressable
                  style={styles.settingRow}
                  onPress={() => Linking.openURL("https://onlymonkes-actions.jumpstreet25.workers.dev/privacy")}
                >
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Privacy Policy</Text>
                    <Text style={styles.settingDesc}>What we collect, how it's stored, your rights</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
                <View style={styles.settingDivider} />
                <Pressable
                  style={styles.settingRow}
                  onPress={() => Linking.openURL("https://onlymonkes-actions.jumpstreet25.workers.dev/copyright")}
                >
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Copyright & DMCA</Text>
                    <Text style={styles.settingDesc}>Copyright notice and DMCA takedown procedure</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
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
                  onPress={() => setWebView({ url: tool.url, title: tool.name })}
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
      <ReclaimModal visible={reclaimOpen} onClose={() => setReclaimOpen(false)} />
      <WebViewModal
        visible={!!webView}
        url={webView?.url ?? null}
        title={webView?.title}
        onClose={() => setWebView(null)}
      />
    </Animated.View>
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
    top: 0,
    bottom: 0,
    // 2026-07-24: 0.96 -> 0.55 (fixed opacity hiding the new BlurView).
    // 2026-07-27: 0.55 -> 0.19, finally matching GLASS_BG/bubble tint/
    // header/toolbar — this was the one glass surface never brought in
    // line with the rest of the app's settled shade value. Known
    // remaining gap, unchanged by this: blur is still not visible when a
    // World theme is equipped (WorldLayer renders opaque on top by
    // design) — flagged in the 2026-07-24 session, not revisited here.
    backgroundColor: "rgba(8, 8, 16, 0.19)",
    borderRadius: 0,
    marginHorizontal: 0,
    borderWidth: 0,
    borderColor: "rgba(255, 255, 255, 0.06)",
    overflow: "hidden",
  },
  glassHighlight: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    height: 1.5,
    backgroundColor: HIGHLIGHT,
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
  navSectionLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "#FFD54F",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 10,
    marginTop: 4,
    opacity: 0.65,
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
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(6, 6, 14, 0.75)",
    borderRadius: 12,
    paddingVertical: 10,
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
    paddingHorizontal: 14,
    marginBottom: 6,
    borderRadius: 14,
    backgroundColor: "rgba(18,18,30,0.8)",
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.06)",
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
    paddingHorizontal: 12,
    marginBottom: 6,
    backgroundColor: "rgba(18,18,30,0.8)",
    borderRadius: 14,
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.06)",
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
    paddingHorizontal: 14,
    marginBottom: 6,
    backgroundColor: "rgba(18,18,30,0.8)",
    borderRadius: 14,
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.06)",
  },
  eventDateBadge: {
    backgroundColor: "rgba(124,58,237,0.12)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 42,
    borderWidth: 0.75,
    borderColor: "rgba(124,58,237,0.2)",
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
    backgroundColor: "rgba(239,68,68,0.1)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 6,
    alignSelf: "flex-start",
    borderWidth: 0.75,
    borderColor: "rgba(239,68,68,0.3)",
  },
  startLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#EF4444" },
  startLiveBtnText: { fontFamily: FONTS.bodySemi, fontSize: 12, color: "#EF4444" },

  // Links
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 6,
    backgroundColor: "rgba(18,18,30,0.8)",
    borderRadius: 14,
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.06)",
  },
  linkIcon: { fontSize: 16 },
  linkDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: THEME.accent },
  linkInfo: { flex: 1, gap: 2 },
  linkUrl: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.accent },
  linkMeta: { fontFamily: FONTS.body, fontSize: 11, color: THEME.textFaint },
  chevron: { fontSize: 18, color: THEME.textFaint },

  // Media
  mediaRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 6, backgroundColor: "rgba(18,18,30,0.8)", borderRadius: 14, borderWidth: 0.75, borderColor: "rgba(255,255,255,0.06)" },
  mediaThumb: { width: 60, height: 60, borderRadius: 10, borderWidth: 0.75, borderColor: "rgba(255,255,255,0.06)" },
  mediaInfo: { flex: 1, gap: 3 },
  mediaSender: { fontFamily: FONTS.displayMed, fontSize: 13, color: THEME.text },
  mediaTime: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textFaint },

  // App Settings
  fixBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(18,18,30,0.8)",
    borderRadius: 14,
    borderWidth: 0.75,
    borderColor: "rgba(124,58,237,0.2)",
    padding: 14,
    marginBottom: 10,
  },
  fixBannerIcon: { fontSize: 22 },
  fixBannerTitle: { fontFamily: FONTS.bodyMed, fontSize: 13, color: THEME.text, marginBottom: 2 },
  fixBannerDesc: { fontFamily: FONTS.body, fontSize: 11, color: THEME.textMuted, lineHeight: 15 },
  settingsCard: {
    backgroundColor: "rgba(18,18,30,0.8)",
    borderRadius: 14,
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.06)",
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
  settingDivider: { height: 0.75, backgroundColor: "rgba(255,255,255,0.06)", marginHorizontal: 16 },
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
    backgroundColor: "rgba(124,58,237,0.1)",
    borderWidth: 0.75,
    borderColor: "rgba(124,58,237,0.2)",
  },
  sportPillMuted: {
    backgroundColor: "rgba(18,18,30,0.6)",
    borderColor: "rgba(255,255,255,0.04)",
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
    backgroundColor: "rgba(18,18,30,0.8)",
    borderRadius: 14,
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.06)",
    padding: 14,
    gap: 10,
  },
  tokenText: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted, lineHeight: 16 },
  tokenButtons: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  tokenBtn: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    backgroundColor: "rgba(18,18,30,0.8)",
    borderRadius: 10,
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.06)",
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

  // Chat Theme picker
  themeRow: {
    paddingVertical: 4,
    paddingRight: 8,
    gap: 10,
  },
  themeCard: {
    width: 88,
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderRadius: 12,
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    gap: 6,
    overflow: "hidden",
  },
  themeCardSelected: {
    borderColor: "rgba(255,213,79,0.45)",
    backgroundColor: "rgba(255,213,79,0.06)",
    shadowColor: "#FFD54F",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  themeCardDimmed: {
    opacity: 0.4,
  },
  themeSwatch: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  themeEmoji: { fontSize: 22 },
  themeName: {
    fontFamily: FONTS.displayMed,
    fontSize: 11,
    color: THEME.text,
    textAlign: "center",
  },
  themeAccentBar: {
    width: 32,
    height: 3,
    borderRadius: 2,
    opacity: 0.7,
  },
  themeCheck: {
    position: "absolute",
    top: 4,
    right: 6,
    color: "#FFD54F",
    fontSize: 12,
    fontWeight: "700",
  },
  shopThemeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,213,79,0.06)",
    borderRadius: 10,
    borderWidth: 0.75,
    borderColor: "rgba(255,213,79,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  shopThemeBannerIcon: { fontSize: 14 },
  shopThemeBannerText: {
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textMuted,
    lineHeight: 15,
  },
});
