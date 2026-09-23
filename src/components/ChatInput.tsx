/**
 * ChatInput
 *
 * Message composer with:
 *  - Reply-to preview strip
 *  - Auto-growing text input (capped at 4 lines)
 *  - Character counter
 *  - Send button (gradient, disabled when empty)
 */

import React, { memo, useRef, useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Keyboard,
  Image,
  Animated,
} from "react-native";
import { showGlassAlert } from "@/lib/glassAlert";
import { useTranslation } from "react-i18next";
import { LinearGradient } from "expo-linear-gradient";
import { LiquidGlass as BlurView } from "@/components/LiquidGlass";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { THEME, FONTS, MAX_MESSAGE_LENGTH, getWorldBarTint, chromeAccentColor, surfaceToBarTint, resolveBarTint } from "@/lib/constants";
import { getBlurProps } from "@/lib/glassTheme";
import { useThemeColor } from "@/lib/shopTheme";
import { shortenAddress } from "@/lib/nftVerification";
import { getCachedProfile, searchUsersByPrefix } from "@/lib/userProfile";
import { useAppStore } from "@/store/appStore";
import { markChannelRead } from "@/lib/messageCache";
import { BotChannelIcon } from "@/components/BotChannelIcon";
import { MenuIcon } from "@/components/MenuIcon";
import { toast } from "sonner-native";
import type { ChatMessage } from "@/types";

function getActiveMention(text: string): { start: number; query: string } | null {
  const match = text.match(/@(\w*)$/);
  if (!match) return null;
  return { start: text.length - match[0].length, query: match[1] };
}

// Main chat autocomplete — must match CHAT_COMMANDS in BotCommandTicker.tsx.
// DM-only commands live in DM_BOT_COMMANDS below.
// `descKey` resolves against chatInput.commands.<descKey> in locales/{en,es}.json.
const BOT_COMMANDS = [
  // Market intel
  { cmd: "/price",      args: "$TOKEN",           descKey: "price" },
  { cmd: "/ta",         args: "$TOKEN",           descKey: "ta" },
  { cmd: "/hottest",    args: "",                 descKey: "hottest" },
  { cmd: "/coldest",    args: "",                 descKey: "coldest" },
  { cmd: "/alerts",     args: "",                 descKey: "alerts" },
  // Watchlist
  { cmd: "/watchlist",  args: "",                 descKey: "watchlist" },
  { cmd: "/watch",      args: "$TOKEN",           descKey: "watch" },
  { cmd: "/unwatch",    args: "$TOKEN",           descKey: "unwatch" },
  { cmd: "/mywatchlist", args: "",                descKey: "mywatchlist" },
  // Trading (group → Jupiter URL)
  { cmd: "/buy",        args: "$TOKEN [SOL]",     descKey: "buyGroup" },
  { cmd: "/sell",       args: "$TOKEN [%]",       descKey: "sellGroup" },
  { cmd: "/swap",       args: "$A for $B",        descKey: "swapGroup" },
  { cmd: "/tip",        args: "@Username [amt]",  descKey: "tip" },
  // Meta
  { cmd: "/identity",   args: "",                 descKey: "identity" },
  { cmd: "/globe",      args: "",                 descKey: "globe" },
  { cmd: "/help",       args: "",                 descKey: "helpGroup" },
];

// DM autocomplete — must match DM_COMMANDS in BotCommandTicker.tsx.
const DM_BOT_COMMANDS = [
  // Quick intel
  { cmd: "/hottest",              args: "",              descKey: "hottest" },
  { cmd: "/coldest",              args: "",              descKey: "coldest" },
  { cmd: "/price",                args: "$TOKEN",        descKey: "price" },
  { cmd: "/ta",                   args: "$TOKEN",        descKey: "ta" },
  { cmd: "/whale",                args: "$TOKEN",        descKey: "whale" },
  { cmd: "/chart",                args: "$TOKEN",        descKey: "chart" },
  { cmd: "/compare",              args: "$A $B",         descKey: "compare" },
  { cmd: "/backtest",             args: "$TOKEN",        descKey: "backtest" },
  // Trading (DM → bot executes via hot wallet)
  { cmd: "/buy",                  args: "$TOKEN [SOL]",  descKey: "buyDm" },
  { cmd: "/sell",                 args: "$TOKEN [%]",    descKey: "sellDm" },
  { cmd: "/swap",                 args: "$A for $B",     descKey: "swapDm" },
  { cmd: "/limit",                args: "",              descKey: "limit" },
  { cmd: "/dca",                  args: "",              descKey: "dca" },
  // Portfolio & positions
  { cmd: "/portfolio",            args: "",              descKey: "portfolio" },
  { cmd: "/positions",            args: "",              descKey: "positions" },
  // Reports
  { cmd: "/ratchet-report",       args: "[days]",        descKey: "ratchetReport" },
  { cmd: "/smart-wallet-report",  args: "",              descKey: "smartWalletReport" },
  // AutonoMonke (2026-09-03: was the misspelled "/automonke" — bot still
  // accepts that as a legacy alias, but this UI should surface the correct
  // canonical spelling)
  { cmd: "/autonomonke",            args: "",              descKey: "autonomonke" },
  { cmd: "/autonomonke start",      args: "",              descKey: "autonomonkeStart" },
  { cmd: "/autonomonke stop",       args: "",              descKey: "autonomonkeStop" },
  { cmd: "/autonomonke positions",  args: "",              descKey: "autonomonkePositions" },
  { cmd: "/autonomonke fund",       args: "",              descKey: "autonomonkeFund" },
  { cmd: "/autonomonke withdraw",   args: "",              descKey: "autonomonkeWithdraw" },
  { cmd: "/autonomonke limits",     args: "",              descKey: "autonomonkeLimits" },
  // Risk
  { cmd: "/risk",                 args: "",              descKey: "risk" },
  { cmd: "/risk size",            args: "1-25",          descKey: "riskSize" },
  { cmd: "/risk stop",            args: "1-50",          descKey: "riskStop" },
  { cmd: "/risk conviction",      args: "50-100",        descKey: "riskConviction" },
  { cmd: "/risk blacklist",       args: "$TOKEN",        descKey: "riskBlacklist" },
  // Hermes memory
  { cmd: "/hermes stats",         args: "",              descKey: "hermesStats" },
  { cmd: "/hermes best",          args: "",              descKey: "hermesBest" },
  { cmd: "/hermes worst",         args: "",              descKey: "hermesWorst" },
  { cmd: "/hermes achievements",  args: "",              descKey: "hermesAchievements" },
  // Recovery & meta
  { cmd: "/reclaim",              args: "",              descKey: "reclaim" },
  { cmd: "/myid",                 args: "",              descKey: "myid" },
  { cmd: "/help",                 args: "",              descKey: "helpDm" },
];

function getSlashSuggestions(text: string, isDmWithBot?: boolean) {
  if (!text.startsWith("/")) return [];
  const query = text.slice(1).toLowerCase();
  const commands = isDmWithBot ? DM_BOT_COMMANDS : BOT_COMMANDS;
  return commands.filter(c => c.cmd.slice(1).startsWith(query));
}

// ── Bot channel button with badge ─────────────────────────────────────────────
function ChannelButton({ channelId, disabled, disabledMessage }: { channelId: 'trades'; disabled?: boolean; disabledMessage?: string }) {
  const { t } = useTranslation();
  const count = useAppStore((s) => s.botChannelCounts[channelId]);
  const muted = useAppStore((s) => s.mutedBotChannels[channelId]);
  const clearCount = useAppStore((s) => s.clearBotChannelCount);
  const shopStyles = useAppStore(s => s.shopStyles);
  const nftDominantColor = useAppStore(s => s.nftDominantColor);
  // Contrast-safe chrome: dark NFT PFP colors used to paint channel icons
  // nearly black on Tech Noir / Deep Space bars (user-visible "blacked out"
  // bottom). chromeAccentColor falls back to world cyan/etc when too dark.
  const iconColor = chromeAccentColor(
    !!shopStyles?.pfpFullTheme,
    nftDominantColor,
    shopStyles?.worldId as string | undefined,
  );
  const pfpTint = shopStyles?.pfpFullTheme && nftDominantColor && iconColor === nftDominantColor
    ? nftDominantColor
    : null;

  if (disabled) {
    return (
      <Pressable
        onPress={() => toast.info(disabledMessage ?? t("chatInput.notAvailableHere"))}
        accessibilityLabel={t("chatInput.channelUnavailable", { channelId })}
        accessibilityRole="button"
        style={[styles.toolbarBtn, styles.toolbarChannel, styles.toolbarBtnDisabled]}
      >
        <BotChannelIcon channel={channelId} size={49} color={THEME.textFaint} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        clearCount(channelId);
        markChannelRead(channelId).catch(() => {});
        router.push(`/bot-channel?channelId=${channelId}`);
      }}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        clearCount(channelId);
        markChannelRead(channelId).catch(() => {});
      }}
      accessibilityLabel={t("chatInput.channelLabel", { channelId })}
      accessibilityRole="button"
      style={({ pressed }) => [styles.toolbarBtn, styles.toolbarChannel, pressed && { opacity: 0.7 }]}
    >
      <BotChannelIcon channel={channelId} size={49} color={iconColor} />
      {/* Muted channels never show a badge — the user explicitly opted out of
          alerts for this channel; surfacing a count would re-introduce the
          notification noise they muted to escape. */}
      {!muted && count > 0 && (
        <View style={styles.badge}>
          <Text style={[styles.badgeText, pfpTint ? { color: pfpTint } : null]}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

function MessagesButton() {
  const { t } = useTranslation();
  const dmUnread = useAppStore((s) =>
    Object.values(s.dmUnreadCounts ?? {}).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0),
  );
  const clearCommunityBadge = useAppStore((s) => s.clearCommunityBadge);
  const shopStyles = useAppStore((s) => s.shopStyles);
  const nftDominantColor = useAppStore((s) => s.nftDominantColor);
  const iconColor = chromeAccentColor(
    !!shopStyles?.pfpFullTheme,
    nftDominantColor,
    shopStyles?.worldId as string | undefined,
  );
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        clearCommunityBadge("dms");
        markChannelRead("dms").catch(() => {});
        router.push("/dms" as any);
      }}
      accessibilityLabel={dmUnread > 0 ? t("chatInput.unreadMessages", { count: dmUnread }) : t("chatInput.messages")}
      accessibilityRole="button"
      style={({ pressed }) => [styles.toolbarBtn, styles.toolbarChannel, pressed && { opacity: 0.7 }]}
    >
      <MenuIcon name="messages" size={32} color={iconColor} />
      {dmUnread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{dmUnread > 99 ? "99+" : dmUnread}</Text>
        </View>
      )}
    </Pressable>
  );
}

interface TypingUser { inboxId: string; username?: string; }

interface ChatInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  replyingTo: ChatMessage | null;
  onCancelReply: () => void;
  isSending?: boolean;
  onGifPicker?: () => void;
  pfpUri?: string | null;
  onPfpGifPicker?: () => void;
  onTyping?: () => void;
  onCamera?: () => void;
  typingUsers?: TypingUser[];
  onLiveVideo?: () => void;
  onAvatarRoom?: () => void;
  onOpenLivePicker?: () => void;
  isDmWithBot?: boolean;
  /** Main Chat only, dual (Saga Monke + Genesis Token) holders — the Main/
   *  Genesis switcher, centered in the toolbar between CAM/LIVE/GIF and the
   *  Messages/MonkeTrades icons. Pass `<ChatModeTabs active="main" />` or
   *  omit entirely (no other screen using ChatInput has anywhere to switch
   *  to, so this stays undefined there). */
  chatModeTabs?: React.ReactNode;
  /** Genesis Chat: renders CAM/LIVE/GIF/MonkeTrades greyed-out and
   *  non-functional instead of omitting them, so the toolbar visually
   *  matches Main Chat's — those features just aren't part of the Genesis
   *  tier. Tapping one shows `disabledMessage`. Main Chat and every other
   *  screen omit this (features stay fully hidden/functional as before). */
  disabledButtons?: { cam?: boolean; live?: boolean; gif?: boolean; trades?: boolean };
  disabledMessage?: string;
}

export const ChatInput = memo(function ChatInput({
  value,
  onChangeText,
  onSend,
  replyingTo,
  onCancelReply,
  isSending,
  onGifPicker,
  pfpUri,
  onPfpGifPicker,
  onTyping,
  onCamera,
  typingUsers,
  onLiveVideo,
  onAvatarRoom,
  onOpenLivePicker,
  isDmWithBot,
  chatModeTabs,
  disabledButtons,
  disabledMessage,
}: ChatInputProps) {
  const { t } = useTranslation();
  const inputRef = useRef<TextInput>(null);
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const hasTypers = !!(typingUsers && typingUsers.length > 0);
  const myInboxId = useAppStore(s => s.myInboxId);

  // Theme overrides for Banana Shop Tier 4 themes
  const themeBorder = useThemeColor('border');
  const themeSurface = useThemeColor('surface');

  // Toolbar (CAM / LIVE / GIF): World owns chrome when equipped — same
  // Tech Noir cyan for every monke on that world. PFP Full Theme only
  // tints chrome when NO world is equipped (and NFT color is readable).
  const shopStyles = useAppStore(s => s.shopStyles);
  const nftDominantColor = useAppStore(s => s.nftDominantColor);
  const toolbarColor = chromeAccentColor(
    !!shopStyles?.pfpFullTheme,
    nftDominantColor,
    shopStyles?.worldId as string | undefined,
  );
  // World-aware transparency: when a Chat World is equipped, drop the input
  // bar background so falling bananas / candles can be seen piling up behind
  // it. 2026-07-24: always-on glass — was opaque themeSurface when no world
  // is set, which fully hid the BlurView now rendered behind this bar.
  // 2026-08-22: was a flat GLASS_CHROME_BG regardless of an equipped Tier 4
  // theme — surfaceToBarTint keeps this bar in sync with the rest of the
  // app's background while staying just as translucent.
  const worldId = shopStyles?.worldId as string | undefined;
  const hasThemeOverride = useAppStore(s => !!s.themeOverrides);
  const inputBarBg = resolveBarTint(worldId, hasThemeOverride, themeSurface, 0.20);

  const slashSuggestions = useMemo(() => getSlashSuggestions(value, isDmWithBot), [value, isDmWithBot]);

  const activeMention = getActiveMention(value);
  const suggestions: { inboxId: string; username: string }[] = useMemo(() => {
    if (!activeMention) return [];
    return searchUsersByPrefix(activeMention.query, myInboxId ?? undefined, 6);
  }, [activeMention?.query, value]);

  const insertSlashCommand = useCallback((cmd: string, args: string) => {
    onChangeText(args ? `${cmd} ` : cmd);
  }, [onChangeText]);

  const insertMention = useCallback((username: string) => {
    const match = value.match(/@(\w*)$/);
    if (!match) return;
    const newText = value.slice(0, value.length - match[0].length) + `@${username} `;
    onChangeText(newText);
  }, [value, onChangeText]);

  // Bounce animation — runs while any remote user is typing
  useEffect(() => {
    if (!hasTypers) {
      bounceAnim.stopAnimation();
      bounceAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, { toValue: -5, duration: 280, useNativeDriver: true }),
        Animated.timing(bounceAnim, { toValue: 0,  duration: 280, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [hasTypers]);

  const canSend = value.trim().length > 0 && value.length <= MAX_MESSAGE_LENGTH && !isSending;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    // Client-side guard: validate /buy and /sell amounts before sending to bot
    const trimmed = value.trim();
    if (/^\/buy\s/i.test(trimmed)) {
      const parts = trimmed.split(/\s+/);
      const amt = parts[2] ? parseFloat(parts[2]) : NaN;
      if (!isNaN(amt) && (amt <= 0 || amt > 100)) {
        showGlassAlert(t("chatInput.invalidAmount"), t("chatInput.buyAmountRange"));
        return;
      }
    }
    if (/^\/sell\s/i.test(trimmed)) {
      const parts = trimmed.split(/\s+/);
      const pct = parts[2] ? parseFloat(parts[2]) : NaN;
      if (!isNaN(pct) && (pct <= 0 || pct > 100)) {
        showGlassAlert(t("chatInput.invalidAmount"), t("chatInput.sellPercentRange"));
        return;
      }
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSend();
    inputRef.current?.blur();
  }, [canSend, onSend, value, t]);

  const handleChangeText = useCallback((text: string) => {
    onChangeText(text);
    if (text.length > 0) onTyping?.();
  }, [onChangeText, onTyping]);

  const charsLeft = MAX_MESSAGE_LENGTH - value.length;
  const isNearLimit = charsLeft <= 50;

  return (
    <View style={[styles.container, { borderTopColor: themeBorder }]}>
      {/* MonkeGlass — blur layer behind the world/theme tint, same treatment
          as ChatHeader. Not in an RN <Modal>, so safe from the cross-window
          blur gap documented in glassTheme.ts. Blurs the message list
          scrolling behind the bottom toolbar, world-equipped or not. */}
      <BlurView {...getBlurProps()} style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: inputBarBg }]} pointerEvents="none" />
      {/* Slash command suggestions */}
      {slashSuggestions.length > 0 && (
        <View style={styles.mentionList}>
          {slashSuggestions.map(({ cmd, args, descKey }) => (
            <Pressable key={cmd} style={styles.mentionRow} onPress={() => insertSlashCommand(cmd, args)}>
              <View style={styles.slashCmdIcon}>
                <Text style={styles.slashCmdSlash}>/</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.slashCmdName}>{cmd}{args ? ` ${args}` : ""}</Text>
                <Text style={styles.slashCmdDesc}>{t(`chatInput.commands.${descKey}`)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {/* Mention suggestions */}
      {suggestions.length > 0 && (
        <View style={styles.mentionList}>
          {suggestions.map(({ inboxId, username }) => {
            const avatar = getCachedProfile(inboxId)?.nftImage;
            return (
              <Pressable key={inboxId} style={styles.mentionRow} onPress={() => insertMention(username)}>
                {avatar
                  ? <Image source={{ uri: avatar }} style={styles.mentionAvatar} />
                  : <View style={[styles.mentionAvatar, styles.mentionAvatarFallback]} />
                }
                <Text style={styles.mentionUsername}>@{username}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Typing indicator */}
      {hasTypers && (
        <Animated.View
          style={[styles.typingRow, { transform: [{ translateY: bounceAnim }] }]}
          pointerEvents="none"
        >
          <Text style={styles.typingDots}>●●●</Text>
          <Text style={styles.typingText}>
            {typingUsers!.length === 1
              ? t("chatInput.typingOne", { name: typingUsers![0].username ?? t("chatInput.aMonke") })
              : typingUsers!.length === 2
              ? t("chatInput.typingTwo", { name1: typingUsers![0].username ?? t("chatInput.monke"), name2: typingUsers![1].username ?? t("chatInput.monke") })
              : t("chatInput.typingMany", { count: typingUsers!.length })}
          </Text>
        </Animated.View>
      )}

      {/* Reply preview */}
      {replyingTo && (
        <View style={styles.replyBanner}>
          <View style={styles.replyBannerBar} />
          <View style={styles.replyBannerContent}>
            <Text style={styles.replyBannerLabel}>
              {t("chatInput.replyingTo", { name: replyingTo.senderUsername ?? getCachedProfile(replyingTo.senderAddress)?.username ?? t("chatInput.monke") })}
            </Text>
            <Text style={styles.replyBannerText} numberOfLines={1}>
              {replyingTo.content}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} style={styles.cancelReply} hitSlop={8}>
            <Text style={styles.cancelReplyText}>✕</Text>
          </Pressable>
        </View>
      )}

      {/* Input row */}
      <View style={styles.inputRow}>
        {/* PFP button — opens sagaMonkes GIF picker */}
        {onPfpGifPicker && (
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPfpGifPicker(); }}
            hitSlop={6}
            accessibilityLabel={t("chatInput.changeProfilePicture")}
            accessibilityRole="button"
            style={({ pressed }) => [styles.pfpBtn, pressed && { opacity: 0.7 }]}
          >
            {pfpUri ? (
              <Image source={{ uri: pfpUri }} style={styles.pfpImg} />
            ) : (
              <View style={styles.pfpFallback}>
                <Text style={styles.pfpGlyph}>🐒</Text>
              </View>
            )}
          </Pressable>
        )}

        <View style={styles.inputWrap}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={value}
            onChangeText={handleChangeText}
            placeholder={t("chatInput.messagePlaceholder")}
            placeholderTextColor={THEME.textFaint}
            multiline
            maxLength={MAX_MESSAGE_LENGTH + 10} // soft limit via UI
            returnKeyType="default"
            blurOnSubmit={false}
            accessibilityLabel={t("chatInput.messageInput")}
            accessibilityRole="text"
          />
          {isNearLimit && (
            <Text style={[styles.charCount, charsLeft < 0 && styles.charCountOver]}>
              {charsLeft}
            </Text>
          )}
        </View>

        <Pressable onPress={handleSend} disabled={!canSend}
          accessibilityLabel={t("chatInput.sendMessage")}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.sendButton,
            pressed && styles.sendButtonPressed,
            !canSend && styles.sendButtonDisabled,
          ]}
        >
          <LinearGradient
            colors={canSend ? ["#9c7cff", "#7c5cfc"] : [THEME.surfaceHigh, THEME.surfaceHigh]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.sendGradient}
          >
            <Text style={[styles.sendArrow, !canSend && styles.sendArrowDisabled]}>↑</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Left: CAM / LIVE / GIF packed like pre-4-channel layout.
          Right: Messages + MonkeTrades (sales merged). Center: Main/Genesis
          switcher (dual holders only) — a real flex sibling between left
          and right (NOT absolutely centered on the whole row), since
          toolbarLeft (3 buttons) and toolbarRight (2 icons) are different
          widths — centering on the full row put the switcher pill
          overlapping the wider CAM/LIVE/GIF group instead of sitting in
          the actual gap between them (confirmed via on-device screenshot,
          2026-08-24). flex:1 on this middle column claims exactly
          whatever space toolbarLeft/toolbarRight don't, then centers its
          own content within that. 2026-08-24: moved down from the header
          per explicit request — was ChatHeader's own row before this. */}
      <View style={styles.toolbarRow}>
        <View style={styles.toolbarLeft}>
          {(onCamera || disabledButtons?.cam) && (
            <Pressable
              onPress={() => {
                if (disabledButtons?.cam) { toast.info(disabledMessage ?? t("chatInput.notAvailableHere")); return; }
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onCamera?.();
              }}
              accessibilityLabel={disabledButtons?.cam ? t("chatInput.openCameraUnavailable") : t("chatInput.openCamera")}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.toolbarBtn, styles.toolbarCamera,
                toolbarColor !== "#6CB4EE" && !disabledButtons?.cam && { borderColor: toolbarColor + "1F" },
                disabledButtons?.cam && styles.toolbarBtnDisabled,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.toolbarCamText, { color: disabledButtons?.cam ? THEME.textFaint : toolbarColor }]}>CAM</Text>
            </Pressable>
          )}
          {(onLiveVideo || onAvatarRoom || disabledButtons?.live) && (
            <Pressable
              onPress={() => {
                if (disabledButtons?.live) { toast.info(disabledMessage ?? t("chatInput.notAvailableHere")); return; }
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onOpenLivePicker?.();
              }}
              accessibilityLabel={disabledButtons?.live ? t("chatInput.goLiveUnavailable") : t("chatInput.goLive")}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.toolbarBtn, styles.toolbarLive,
                toolbarColor !== "#6CB4EE" && !disabledButtons?.live && { borderColor: toolbarColor + "1F" },
                disabledButtons?.live && styles.toolbarBtnDisabled,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={[styles.liveDot, { backgroundColor: disabledButtons?.live ? THEME.textFaint : toolbarColor }]} />
              <Text style={[styles.toolbarLiveText, { color: disabledButtons?.live ? THEME.textFaint : toolbarColor }]}>LIVE</Text>
            </Pressable>
          )}
          {(onGifPicker || disabledButtons?.gif) && (
            <Pressable
              onPress={() => {
                if (disabledButtons?.gif) { toast.info(disabledMessage ?? t("chatInput.notAvailableHere")); return; }
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onGifPicker?.();
              }}
              accessibilityLabel={disabledButtons?.gif ? t("chatInput.openGifPickerUnavailable") : t("chatInput.openGifPicker")}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.toolbarBtn, styles.toolbarGif,
                toolbarColor !== "#6CB4EE" && !disabledButtons?.gif && { borderColor: toolbarColor + "1F" },
                disabledButtons?.gif && styles.toolbarBtnDisabled,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.toolbarGifText, { color: disabledButtons?.gif ? THEME.textFaint : toolbarColor }]}>GIF</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.toolbarCenter} pointerEvents={chatModeTabs ? "auto" : "none"}>
          {chatModeTabs}
        </View>
        <View style={styles.toolbarRight}>
          <MessagesButton />
          <ChannelButton channelId="trades" disabled={disabledButtons?.trades} disabledMessage={disabledMessage} />
        </View>
      </View>

    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    // Background is now the BlurView + tint View layered as the first two
    // children (MonkeGlass, 2026-08-03) instead of a static color here —
    // was THEME.surface (opaque) before that, which sat behind the BlurView
    // and blocked it from sampling real content.
    // No borderTop — separator removed per design pass 2026-05-06.
    // 2026-07-23: 8 -> 4 -> 2, a bar-wide compaction pass to reclaim
    // chat viewport height post-edge-to-edge. Tap targets (toolbarBtn
    // height, inputWrap minHeight) deliberately untouched.
    paddingBottom: 2,
  },
  replyBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 8,
  },
  replyBannerBar: {
    width: 3,
    height: 36,
    backgroundColor: THEME.accent,
    borderRadius: 2,
  },
  replyBannerContent: { flex: 1, gap: 2 },
  replyBannerLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.accent,
  },
  replyBannerText: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: THEME.textMuted,
  },
  cancelReply: { padding: 4 },
  cancelReplyText: {
    fontSize: 14,
    color: THEME.textFaint,
  },

  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 6,
    gap: 8,
  },
  inputWrap: {
    flex: 1,
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: "center",
  },
  input: {
    fontFamily: FONTS.body,
    fontSize: 15,
    color: THEME.text,
    maxHeight: 100,
    padding: 0,
    margin: 0,
  },
  charCount: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    alignSelf: "flex-end",
    marginTop: 2,
  },
  charCountOver: { color: "#ff4444" },

  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 13,
    overflow: "hidden",
    shadowColor: THEME.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  sendButtonPressed: { opacity: 0.8, transform: [{ scale: 0.95 }] },
  sendButtonDisabled: { shadowOpacity: 0, elevation: 0 },
  sendGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sendArrow: {
    fontSize: 20,
    color: "#fff",
    fontWeight: "700",
  },
  sendArrowDisabled: { color: THEME.textFaint },

  // ── Typing indicator ──────────────────────────────────────────────────────
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 2,
  },
  typingDots: {
    fontSize: 8,
    color: THEME.accent,
    letterSpacing: 2,
  },
  typingText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textMuted,
    fontStyle: "italic",
  },

  // ── PFP button (left of input) ─────────────────────────────────────────────
  pfpBtn: {
    alignSelf: "flex-end",
    marginBottom: 2,
  },
  pfpImg: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  pfpFallback: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: THEME.accentSoft,
    borderWidth: 1,
    borderColor: THEME.accent + "44",
    alignItems: "center",
    justifyContent: "center",
  },
  pfpGlyph: { fontSize: 16 },

  // ── Toolbar row (below input) ──────────────────────────────────────────────
  toolbarRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingTop: 2,
  },
  toolbarCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  toolbarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  toolbarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  toolbarBtn: {
    height: 31,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  toolbarBtnDisabled: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderColor: "rgba(255,255,255,0.06)",
    opacity: 0.45,
  },
  toolbarCamera: {
    backgroundColor: "rgba(10, 10, 15, 0.8)",
    borderWidth: 1,
    borderColor: "rgba(108, 180, 238, 0.12)",
    paddingHorizontal: 7,
  },
  toolbarCamText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "#6CB4EE",
    letterSpacing: 0.5,
  },
  toolbarLive: {
    borderWidth: 1,
    borderColor: "rgba(108, 180, 238, 0.12)",
    backgroundColor: "rgba(10, 10, 15, 0.8)",
    paddingHorizontal: 7,
    flexDirection: "row",
    gap: 3,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#6CB4EE",
  },
  toolbarLiveText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "#6CB4EE",
    letterSpacing: 0.5,
  },
  toolbarGif: {
    borderWidth: 1,
    borderColor: "rgba(108, 180, 238, 0.12)",
    backgroundColor: "rgba(10, 10, 15, 0.8)",
    paddingHorizontal: 7,
  },
  toolbarGifText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "#6CB4EE",
    letterSpacing: 0.5,
  },
  toolbarChannel: {
    width: 49,
    height: 49,
    borderRadius: 13,
  },
  toolbarChannelImg: {
    width: 49,
    height: 49,
    borderRadius: 13,
    resizeMode: "cover",
    overflow: "hidden",
  },
  badge: {
    position: "absolute",
    top: -8,
    right: -6,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: THEME.bg,
    zIndex: 10,
  },
  badgeText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "#6CB4EE",
    fontWeight: "800",
    lineHeight: 13,
  },

  // ── Slash command suggestion list ─────────────────────────────────────────
  slashCmdIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: THEME.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  slashCmdSlash: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    color: THEME.accent,
    fontWeight: "700",
  },
  slashCmdName: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: THEME.text,
  },
  slashCmdDesc: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: THEME.textMuted,
    marginTop: 1,
  },

  // ── @mention suggestion list ────────────────────────────────────────────────
  mentionList: {
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 12,
    marginHorizontal: 8,
    marginBottom: 6,
    overflow: "hidden",
  },
  mentionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  mentionAvatar: { width: 28, height: 28, borderRadius: 14 },
  mentionAvatarFallback: { backgroundColor: THEME.border },
  mentionUsername: { fontFamily: FONTS.bodyMed, fontSize: 14, color: THEME.text },

  // ── Live picker popup ───────────────────────────────────────────────────────
});
