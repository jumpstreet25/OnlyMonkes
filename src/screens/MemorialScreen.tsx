/**
 * MemorialScreen — "In Memoriam": every Saga Monke ever burnt.
 *
 * Purely static/historical display, served from MonkeLedger's /burnt endpoint — no Helius call,
 * no live chain read. MonkeLedger captures a Monke's last-known name/image/traits the moment its
 * DAS entry first flips to burnt:true, so this list only ever grows and never needs re-verifying.
 */
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ActivityIndicator,
  Modal,
  ScrollView,
  Dimensions,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { THEME, FONTS } from "@/lib/constants";
import { fetchMonkeLedgerBurnt, type BurntMonke } from "@/lib/nftVerification";
import { WorldScreenShell, useWorldGlassCardStyle } from "@/components/worlds/WorldScreenShell";
import { LiquidGlass as BlurView } from "@/components/LiquidGlass";

const GRID_GAP = 10;
const COLUMNS = 2;
const SCREEN_W = Dimensions.get("window").width;
const CARD_W = (SCREEN_W - 16 * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

export default function MemorialScreen() {
  const [monkes, setMonkes] = useState<BurntMonke[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<BurntMonke | null>(null);
  const cardStyle = useWorldGlassCardStyle();

  const load = useCallback(async () => {
    setError(false);
    const data = await fetchMonkeLedgerBurnt();
    if (data === null) {
      setError(true);
      return;
    }
    setMonkes(data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const renderCard = useCallback(({ item }: { item: BurntMonke }) => (
    <Pressable
      style={[styles.card, cardStyle, { width: CARD_W }]}
      onPress={() => setSelected(item)}
    >
      {item.image ? (
        <Image source={{ uri: item.image }} style={[styles.cardImg, { width: CARD_W, height: CARD_W }]} />
      ) : (
        <View style={[styles.cardImg, styles.cardImgFallback, { width: CARD_W, height: CARD_W }]}>
          <Text style={{ fontSize: 40 }}>💀</Text>
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>
          {item.name ?? (item.number !== null ? `MONKE #${item.number}` : "Unknown Monke")}
        </Text>
        <Text style={styles.cardTag}>Fallen homie 🪦</Text>
      </View>
    </Pressable>
  ), [cardStyle]);

  return (
    <WorldScreenShell
      title="Memorial"
      onBack={() => router.back()}
      headerRight={monkes ? <Text style={styles.count}>{monkes.length} lost</Text> : undefined}
    >
      <Text style={styles.intro}>
        Gone but never forgotten — every Saga Monke lost to the burn, with its last-known look and traits preserved here.
      </Text>

      {monkes === null && !error ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={THEME.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Couldn't reach the Memorial right now.</Text>
          <Pressable style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlashList
          data={monkes!}
          renderItem={renderCard}
          keyExtractor={(item) => item.mint}
          numColumns={COLUMNS}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No losses yet — every Monke is still with us. 🐒</Text>
          }
        />
      )}

      <Modal
        visible={!!selected}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSelected(null)}>
          <Pressable style={styles.modalCardWrap} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.modalCard, cardStyle]}>
              {/* LiquidGlass never renders children — it's a background-only overlay, always an
                  absolutely-positioned sibling BEHIND the real content, never a wrapper. Using it
                  as a wrapper (as this modal originally did) silently discards everything inside
                  it, which is exactly why the modal appeared to open with nothing in it. */}
              <BlurView style={StyleSheet.absoluteFill} />
              {selected?.image ? (
                <Image source={{ uri: selected.image }} style={styles.modalImg} />
              ) : (
                <View style={[styles.modalImg, styles.cardImgFallback]}>
                  <Text style={{ fontSize: 56 }}>💀</Text>
                </View>
              )}
              <Text style={styles.modalName}>
                {selected?.name ?? (selected?.number !== null ? `MONKE #${selected?.number}` : "Unknown Monke")}
              </Text>
              <Text style={styles.modalEpitaph}>Rest easy, homie. 🍌</Text>
              <ScrollView style={styles.traitList}>
                {(selected?.traits ?? []).map((t, i) => (
                  <View key={i} style={styles.traitRow}>
                    <Text style={styles.traitType}>{t.trait_type}</Text>
                    <Text style={styles.traitValue}>{t.value}</Text>
                  </View>
                ))}
              </ScrollView>
              <Pressable style={styles.closeBtn} onPress={() => setSelected(null)}>
                <Text style={styles.closeBtnText}>Close</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </WorldScreenShell>
  );
}

const styles = StyleSheet.create({
  count: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted },
  intro: {
    fontFamily: FONTS.mono, fontSize: 11, color: THEME.textDim,
    paddingHorizontal: 16, paddingBottom: 10, lineHeight: 17,
  },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  card: { borderRadius: 14, overflow: "hidden", borderWidth: 1, marginRight: GRID_GAP },
  cardImg: { backgroundColor: "rgba(127,127,127,0.1)" },
  cardImgFallback: { alignItems: "center", justifyContent: "center" },
  cardBody: { padding: 8 },
  cardName: { fontFamily: FONTS.mono, fontSize: 12, fontWeight: "700", color: THEME.text },
  cardTag: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textDim, marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  emptyText: {
    fontFamily: FONTS.mono, fontSize: 13, color: THEME.textMuted,
    textAlign: "center", paddingVertical: 60, lineHeight: 22, paddingHorizontal: 24,
  },
  retryBtn: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
    backgroundColor: THEME.accent,
  },
  retryBtnText: { fontFamily: FONTS.mono, fontSize: 12, color: "#fff", fontWeight: "700" },
  modalBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  modalCardWrap: { width: "100%", maxWidth: 340, maxHeight: "80%" },
  modalCard: { borderRadius: 18, padding: 18, alignItems: "center", overflow: "hidden" },
  modalImg: { width: 140, height: 140, borderRadius: 14, marginBottom: 12 },
  modalName: { fontFamily: FONTS.mono, fontSize: 16, fontWeight: "700", color: THEME.text },
  modalEpitaph: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textDim, marginTop: 4, marginBottom: 12 },
  traitList: { alignSelf: "stretch", maxHeight: 220 },
  traitRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(127,127,127,0.25)",
  },
  traitType: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textDim },
  traitValue: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.text, fontWeight: "600" },
  closeBtn: {
    marginTop: 14, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
    backgroundColor: "rgba(127,127,127,0.2)",
  },
  closeBtnText: { fontFamily: FONTS.mono, fontSize: 12, color: THEME.text, fontWeight: "700" },
});
