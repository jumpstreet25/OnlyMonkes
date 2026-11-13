/**
 * Games tab of the Leaderboard: Monke RC's daily board and MonkeCaves' weekly speed-run
 * board, read from the public GETs in worker-actions/src/racer.ts and caves.ts
 * (each answers 404 "not released" until its board is "on"). Read-only, no proof needed.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Image, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { FONTS, THEME } from "@/lib/constants";
import { monkeImageForNumber } from "@/lib/monkeMeme/monkeNumbers";
import { useWorldGlassCardStyle } from "@/components/worlds/WorldScreenShell";
import { cleanRows, fmtCave, fmtRace, utcDay, type BoardRow } from "@/lib/gameBoards";

// Web is served from onlymonkes.app (same origin); the phone calls it directly.
const BASE = Platform.OS === "web" ? "" : "https://onlymonkes.app";
const MEDALS = ["🥇", "🥈", "🥉"];

type Racer = { day: string; top: BoardRow[] } | null;
type Caves = { week: string; caves: Record<string, BoardRow[]> } | null;

async function getJson(path: string): Promise<any | null> {
  try {
    const res = await fetch(`${BASE}${path}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function Row({ r, i, time, cardStyle }: { r: BoardRow; i: number; time: string; cardStyle: object }) {
  const img = r.n != null ? monkeImageForNumber(r.n) : null;
  return (
    <View style={[styles.row, cardStyle]}>
      <Text style={styles.rank}>{i < 3 ? MEDALS[i] : `${i + 1}.`}</Text>
      {img ? <Image source={{ uri: img }} style={styles.pfp} /> : <View style={[styles.pfp, styles.pfpFallback]}><Text>🐒</Text></View>}
      <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
      <Text style={styles.time}>{time}</Text>
    </View>
  );
}

export function GamesBoardView() {
  const cardStyle = useWorldGlassCardStyle();
  const [racer, setRacer] = useState<Racer>(null);
  const [caves, setCaves] = useState<Caves>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const day = utcDay();
    const [r, c] = await Promise.all([getJson(`/api/racer/board?day=${day}`), getJson("/api/caves/board")]);
    setRacer(r && Array.isArray(r.top) ? { day: String(r.day ?? day), top: cleanRows(r.top, 10) } : null);
    setCaves(c && c.caves && typeof c.caves === "object"
      ? { week: String(c.week ?? ""), caves: Object.fromEntries(Object.entries(c.caves).map(([k, v]) => [k, cleanRows(v, 5)])) }
      : null);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={THEME.textMuted} />}
    >
      <Text style={styles.header}>GAME BOARDS</Text>
      <Text style={styles.subheader}>Fastest holders · Monke RC resets daily, MonkeCaves weekly (UTC)</Text>

      <Text style={styles.section}>⚡ MONKE RC · {racer?.day ?? utcDay()}</Text>
      {loading ? <Text style={styles.empty}>Loading…</Text>
        : !racer ? <Text style={styles.empty}>Board opens soon</Text>
        : racer.top.length === 0 ? <Text style={styles.empty}>No times yet today. Be the first.</Text>
        : racer.top.map((r, i) => <Row key={`r${i}`} r={r} i={i} time={fmtRace(r.t)} cardStyle={cardStyle} />)}

      <Text style={[styles.section, styles.spaced]}>🎯 MONKECAVES{caves?.week ? ` · ${caves.week}` : ""}</Text>
      {loading ? <Text style={styles.empty}>Loading…</Text>
        : !caves ? <Text style={styles.empty}>Board opens soon</Text>
        : Object.keys(caves.caves).sort((a, b) => Number(a) - Number(b)).map((k) => (
          <View key={`c${k}`}>
            <Text style={styles.cave}>CAVE {k}</Text>
            {caves.caves[k].length === 0
              ? <Text style={styles.empty}>No clears yet this week</Text>
              : caves.caves[k].map((r, i) => <Row key={`c${k}-${i}`} r={r} i={i} time={fmtCave(r.t)} cardStyle={cardStyle} />)}
          </View>
        ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: 16 },
  header: { fontFamily: FONTS.mono, fontSize: 12, color: "#FFD54F", fontWeight: "700", letterSpacing: 2, textAlign: "center", marginBottom: 4 },
  subheader: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted, textAlign: "center", marginBottom: 12 },
  section: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8 },
  spaced: { marginTop: 16 },
  cave: { fontFamily: FONTS.mono, fontSize: 10, color: "#FFD54F", letterSpacing: 1.2, marginTop: 6, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, marginBottom: 6, overflow: "hidden" },
  rank: { fontFamily: FONTS.display, fontSize: 16, width: 28, color: THEME.text, textAlign: "center" },
  pfp: { width: 34, height: 34, borderRadius: 17 },
  pfpFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  name: { flex: 1, fontFamily: FONTS.bodySemi, fontSize: 14, color: THEME.text },
  time: { fontFamily: FONTS.mono, fontSize: 14, color: "#FFD54F", fontWeight: "700" },
  empty: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted, textAlign: "center", paddingVertical: 10 },
});
