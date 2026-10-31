/**
 * OldHistoryScreen — "Before the move": chats from the old XMTP network, imported once by
 * xmtpHistoryImport.ts. Read-only: no composer, no reactions, nothing is sent. Group names come
 * from the old network's frozen group IDs (old config/app-config.json); DMs show the peer's
 * cached profile name. Messages go through the normal decodeMessage, so system traffic
 * (PRESENCE:, TYPING:, …) stays hidden.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { THEME, FONTS } from "@/lib/constants";
import { WorldScreenShell, useWorldGlassCardStyle } from "@/components/worlds/WorldScreenShell";
import { getXmtpClient } from "@/hooks/useXmtp";
import { decodeMessage } from "@/lib/xmtp";
import { getCachedProfile, useProfileVersion } from "@/lib/userProfile";
import { useAppStore } from "@/store/appStore";
import type { ChatMessage } from "@/types";

const OLD_GROUP_NAMES: Record<string, string> = {
  "8683255a7e4af637917b7abd33b58d46": "Main Chat",
  "8700f7559b1ad28498c04d7af0db1465": "MonkeTrades",
  "5c2140ab6ba5ec5eb155fdbdcaf63afb": "Genesis Chat",
};
const PAGE = 50;

type OldConversation = {
  id: string;
  isGroup: boolean;
  peerInboxId?: string;
  name?: string;
  conv: any;
  lastAt?: number;
};

function titleFor(c: OldConversation): string {
  if (OLD_GROUP_NAMES[c.id]) return OLD_GROUP_NAMES[c.id];
  if (c.isGroup) return c.name || "Group";
  const p = c.peerInboxId ? getCachedProfile(c.peerInboxId) : null;
  return p?.username || "Direct message";
}

function when(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function OldHistoryScreen() {
  const { t } = useTranslation();
  useProfileVersion();
  const cardStyle = useWorldGlassCardStyle();
  const myInboxId = useAppStore((s) => s.myInboxId) ?? "";
  const [convs, setConvs] = useState<OldConversation[] | null>(null);
  const [open, setOpen] = useState<OldConversation | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const client: any = getXmtpClient();
      if (!client?.conversations?.listImported) { setConvs([]); return; }
      const list: any[] = await client.conversations.listImported().catch(() => []);
      const rows = await Promise.all(list.map(async (c): Promise<OldConversation> => ({
        id: c.id,
        isGroup: c.isGroup,
        name: c.name,
        peerInboxId: c.isGroup ? undefined : await c.peerInboxId().catch(() => undefined),
        conv: c,
        lastAt: (await c.lastMessage().catch(() => undefined))?.sentNs / 1e6 || undefined,
      })));
      const rank = (r: OldConversation) => (OLD_GROUP_NAMES[r.id] ? 0 : 1);
      rows.sort((a, b) => rank(a) - rank(b) || (b.lastAt ?? 0) - (a.lastAt ?? 0));
      if (!cancelled) setConvs(rows);
    })();
    return () => { cancelled = true; };
  }, []);

  if (open) {
    return <OldThread conv={open} myInboxId={myInboxId} onBack={() => setOpen(null)} />;
  }

  return (
    <WorldScreenShell title={t("oldHistory.title")} onBack={() => router.back()}>
      <Text style={styles.note}>{t("oldHistory.note")}</Text>
      {convs === null ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={THEME.accent} />
      ) : convs.length === 0 ? (
        <Text style={styles.empty}>{t("oldHistory.empty")}</Text>
      ) : (
        <FlashList
          data={convs}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <Pressable style={[styles.row, cardStyle]} onPress={() => setOpen(item)}>
              <Text style={styles.rowTitle} numberOfLines={1}>{titleFor(item)}</Text>
              <Text style={styles.rowMeta}>{when(item.lastAt)}</Text>
            </Pressable>
          )}
        />
      )}
    </WorldScreenShell>
  );
}

function OldThread({ conv, myInboxId, onBack }: { conv: OldConversation; myInboxId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [oldestNs, setOldestNs] = useState<number | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadMore = useCallback(async () => {
    if (loading || done) return;
    setLoading(true);
    try {
      const raw: any[] = await conv.conv.messages({ limit: PAGE, direction: "DESCENDING", beforeNs: oldestNs });
      if (raw.length < PAGE) setDone(true);
      if (raw.length) setOldestNs(Number(raw[raw.length - 1].sentNs));
      const decoded = raw.map((m) => decodeMessage(m, myInboxId)).filter((m): m is ChatMessage => !!m);
      setMsgs((prev) => [...prev, ...decoded]);
    } catch {
      setDone(true);
    } finally {
      setLoading(false);
    }
  }, [conv, myInboxId, oldestNs, loading, done]);

  useEffect(() => { void loadMore(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <WorldScreenShell title={titleFor(conv)} onBack={onBack}>
      <Text style={styles.note}>{t("oldHistory.readOnly")}</Text>
      <FlashList
        data={msgs}
        inverted
        keyExtractor={(m) => m.id}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
        ListFooterComponent={loading ? <ActivityIndicator style={{ margin: 16 }} color={THEME.accent} /> : null}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>{t("oldHistory.noMessages")}</Text> : null}
        renderItem={({ item }) => {
          const mine = item.senderAddress === myInboxId;
          const name = mine ? null : item.senderUsername || getCachedProfile(item.senderAddress)?.username;
          return (
            <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              {name ? <Text style={styles.sender}>{name}</Text> : null}
              <Text style={styles.body} selectable>{item.editedContent ?? item.content}</Text>
              <Text style={styles.time}>{item.sentAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</Text>
            </View>
          );
        }}
      />
    </WorldScreenShell>
  );
}

const styles = StyleSheet.create({
  note: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted, paddingHorizontal: 16, paddingVertical: 10 },
  empty: { fontFamily: FONTS.body, fontSize: 14, color: THEME.textMuted, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 14, marginBottom: 10 },
  rowTitle: { flex: 1, fontFamily: FONTS.bodyMed, fontSize: 15, color: THEME.text, marginRight: 12 },
  rowMeta: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted },
  bubble: { maxWidth: "85%", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 4 },
  mine: { alignSelf: "flex-end", backgroundColor: THEME.accent + "33" },
  theirs: { alignSelf: "flex-start", backgroundColor: THEME.surface ?? "#ffffff14" },
  sender: { fontFamily: FONTS.bodyMed, fontSize: 12, color: THEME.accent, marginBottom: 2 },
  body: { fontFamily: FONTS.body, fontSize: 14, color: THEME.text },
  time: { fontFamily: FONTS.body, fontSize: 10, color: THEME.textMuted, marginTop: 4, alignSelf: "flex-end" },
});
