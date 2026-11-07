/**
 * MiniChat — Main Chat floating over MonkeCaves (dApp and narrow website
 * windows), so holders can play and keep up with chat. Closed: one line with
 * the latest message and how many arrived since. Open: a see-through panel with
 * the last messages and a box to type. The corner button moves it around the
 * screen; the corner is remembered. Fresh DMs flash in for a few seconds
 * (gameFlash.ts). Slash commands go through the full Main Chat (swap quotes,
 * confirmations), so the box sends plain messages only.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Image, Platform, useWindowDimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { toast } from "sonner-native";
import { FONTS } from "@/lib/constants";
import { useChatStore } from "@/store/chatStore";
import { useAppStore } from "@/store/appStore";
import { useGameFlash } from "@/lib/gameFlash";
import { notificationPreviewText } from "@/lib/notifications";
import { sendMainChatText } from "@/hooks/useXmtp";
import type { ChatMessage } from "@/types";

type Corner = "tl" | "tr" | "bl" | "br";
const CORNERS: Corner[] = ["tl", "tr", "br", "bl"];
const CORNER_KEY = "minichat_corner_v1";
const SHOWN = 12;

const preview = (m: ChatMessage) => notificationPreviewText(m.editedContent ?? m.content);

export function MiniChat({ top = 0, bottom = 0 }: { top?: number; bottom?: number }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const messages = useChatStore((s) => s.messages);
  const myInboxId = useAppStore((s) => s.myInboxId);
  const username = useAppStore((s) => s.username);
  const verifiedNft = useAppStore((s) => s.verifiedNft);
  const flashes = useGameFlash((s) => s.flashes);
  const dismiss = useGameFlash((s) => s.dismiss);
  const [open, setOpen] = useState(false);
  const [corner, setCorner] = useState<Corner>("tl");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const seenId = useRef<string | null>(messages[0]?.id ?? null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(CORNER_KEY).then((c) => { if (c && CORNERS.includes(c as Corner)) setCorner(c as Corner); }).catch(() => {});
  }, []);

  // Count what arrived while closed (newest-first store; stop at the last one seen).
  useEffect(() => {
    if (open) { seenId.current = messages[0]?.id ?? null; setUnread(0); return; }
    const i = messages.findIndex((m) => m.id === seenId.current);
    setUnread(i < 0 ? Math.min(messages.length, 99) : i);
  }, [messages, open]);

  const recent = useMemo(() => messages.slice(0, SHOWN).reverse(), [messages]);
  const latest = messages[0];
  const panelW = Math.min(320, width - 24);

  const moveCorner = () => {
    const next = CORNERS[(CORNERS.indexOf(corner) + 1) % CORNERS.length];
    setCorner(next);
    AsyncStorage.setItem(CORNER_KEY, next).catch(() => {});
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    if (body.startsWith("/")) { toast(t("miniChat.commandsInMain")); return; }
    setSending(true);
    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`, senderAddress: myInboxId ?? "", senderUsername: username ?? undefined,
      senderNft: verifiedNft ?? undefined, content: body, sentAt: new Date(), reactions: {}, status: "sending",
    };
    useChatStore.getState().addMessage(optimistic);
    setText("");
    try {
      await sendMainChatText(body);
      useChatStore.getState().updateMessageStatus(optimistic.id, "sent");
    } catch {
      useChatStore.getState().updateMessageStatus(optimistic.id, "failed");
      toast.error(t("chatScreen.failedToSendMessage"));
    } finally {
      setSending(false);
    }
  };

  const pos = {
    ...(corner[0] === "t" ? { top: top + 52 } : { bottom: bottom + 96 }),
    ...(corner[1] === "l" ? { left: 10 } : { right: 10 }),
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, pos, { width: panelW, alignItems: corner[1] === "l" ? "flex-start" : "flex-end" }]}>
      {corner[0] === "b" && <Flashes flashes={flashes} dismiss={dismiss} />}
      {open ? (
        <View style={[styles.panel, { width: panelW }]}>
          <View style={styles.head}>
            <Text style={styles.headText}>{t("miniChat.title")}</Text>
            <Pressable onPress={moveCorner} hitSlop={6} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t("miniChat.move")}>
              <Text style={styles.iconText}>⤢</Text>
            </Pressable>
            <Pressable onPress={() => setOpen(false)} hitSlop={6} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t("miniChat.close")}>
              <Text style={styles.iconText}>–</Text>
            </Pressable>
          </View>
          <View style={styles.list}>
            {recent.map((m) => (
              <Text key={m.id} style={styles.line} numberOfLines={2}>
                <Text style={[styles.name, m.senderAddress === myInboxId && styles.me]}>{m.senderUsername || "Monke"}: </Text>
                {preview(m)}
              </Text>
            ))}
          </View>
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              onSubmitEditing={send}
              placeholder={t("miniChat.placeholder")}
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={styles.input}
              maxLength={500}
              returnKeyType="send"
              blurOnSubmit={false}
            />
            <Pressable onPress={send} disabled={!text.trim() || sending} style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel={t("miniChat.send")}>
              <Text style={styles.sendText}>➤</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setOpen(true)} style={[styles.pill, { maxWidth: panelW }]} accessibilityRole="button" accessibilityLabel={t("miniChat.open", { count: unread })}>
          <Text style={styles.pillIcon}>💬</Text>
          <Text style={styles.pillText} numberOfLines={1}>
            {latest ? <><Text style={styles.name}>{latest.senderUsername || "Monke"}: </Text>{preview(latest)}</> : t("miniChat.title")}
          </Text>
          {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text></View>}
        </Pressable>
      )}
      {corner[0] === "t" && <Flashes flashes={flashes} dismiss={dismiss} />}
    </View>
  );
}

function Flashes({ flashes, dismiss }: { flashes: ReturnType<typeof useGameFlash.getState>["flashes"]; dismiss: (id: string) => void }) {
  if (!flashes.length) return null;
  return (
    <View style={styles.flashes} pointerEvents="box-none">
      {flashes.map((f) => (
        <Pressable key={f.id} onPress={() => dismiss(f.id)} style={styles.flash} accessibilityRole="button">
          {f.image ? <Image source={{ uri: f.image }} style={styles.flashPfp} /> : <Text style={styles.pillIcon}>✉️</Text>}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.flashTitle} numberOfLines={1}>{f.title}</Text>
            <Text style={styles.flashBody} numberOfLines={2}>{notificationPreviewText(f.body)}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const glass = "rgba(10,10,16,0.82)";
const styles = StyleSheet.create({
  wrap: { position: "absolute", zIndex: 50, gap: 6 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: glass, borderRadius: 999, paddingVertical: 6, paddingLeft: 10, paddingRight: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  pillIcon: { fontSize: 14 },
  pillText: { flexShrink: 1, color: "#f2f2f5", fontFamily: FONTS.bodyMed, fontSize: 12 },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: "#ff5a5f", alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontFamily: FONTS.bodySemi, fontSize: 11 },
  panel: { backgroundColor: glass, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4, gap: 4 },
  headText: { flex: 1, color: "#f2f2f5", fontFamily: FONTS.bodySemi, fontSize: 13 },
  iconBtn: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  iconText: { color: "#f2f2f5", fontSize: 15, lineHeight: 17 },
  list: { paddingHorizontal: 10, paddingVertical: 4, gap: 3, maxHeight: 220 },
  line: { color: "#e6e6ea", fontFamily: FONTS.bodyMed, fontSize: 12, lineHeight: 16 },
  name: { color: "#ffd23f", fontFamily: FONTS.bodySemi },
  me: { color: "#6cb4ee" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  input: { flex: 1, color: "#fff", fontFamily: FONTS.bodyMed, fontSize: 13, paddingVertical: Platform.OS === "web" ? 6 : 4, paddingHorizontal: 8, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.08)" },
  sendBtn: { width: 32, height: 30, borderRadius: 8, backgroundColor: "#ffd23f", alignItems: "center", justifyContent: "center" },
  sendText: { color: "#111", fontSize: 14 },
  flashes: { gap: 6, width: "100%" },
  flash: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(22,18,40,0.92)", borderRadius: 12, padding: 8, borderWidth: 1, borderColor: "#8a5cf6" },
  flashPfp: { width: 30, height: 30, borderRadius: 7 },
  flashTitle: { color: "#fff", fontFamily: FONTS.bodySemi, fontSize: 12 },
  flashBody: { color: "#d9d9e0", fontFamily: FONTS.bodyMed, fontSize: 12 },
});
