/**
 * GifPickerModal
 *
 * Bottom-sheet GIF/sticker picker backed by the GIPHY REST API.
 *
 * Props:
 *   visible          — controls modal visibility
 *   onClose          — dismiss callback
 *   onSelect(url)    — called with the displayUrl of the chosen GIF
 *   sagaMonkesOnly   — when true: auto-searches "sagamonkes", hides search bar
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  FlatList,
  Image,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { THEME, FONTS } from "@/lib/constants";
import { searchGifs, trendingGifs, type GiphyItem } from "@/lib/giphy";

interface GifPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (displayUrl: string) => void;
  sagaMonkesOnly?: boolean;
}

export function GifPickerModal({
  visible,
  onClose,
  onSelect,
  sagaMonkesOnly,
}: GifPickerModalProps) {
  const { width: SCREEN_W } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GiphyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 2-column grid: total horizontal padding 48, gap 8
  const CELL_W = (SCREEN_W - 48 - 8) / 2;
  const CELL_H = Math.round(CELL_W * 0.6);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const results = q.trim() ? await searchGifs(q.trim()) : await trendingGifs();
      setItems(results);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // On open: fetch initial results
  useEffect(() => {
    if (!visible) return;
    if (sagaMonkesOnly) {
      load("sagamonkes");
    } else {
      setQuery("");
      load("");
    }
  }, [visible, sagaMonkesOnly]);

  // Debounce text search (skip in sagaMonkesOnly mode)
  useEffect(() => {
    if (sagaMonkesOnly) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(query), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, sagaMonkesOnly]);

  const handleSelect = useCallback(
    (url: string) => {
      onSelect(url);
      onClose();
    },
    [onSelect, onClose]
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={onClose} />

      <View style={styles.sheet}>
        <View style={styles.handle} />

        <Text style={styles.title}>
          {sagaMonkesOnly ? "🐒  Saga GIFs" : "GIF"}
        </Text>

        {!sagaMonkesOnly && (
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search GIFs…"
            placeholderTextColor={THEME.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={THEME.accent} />
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={styles.columnWrap}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handleSelect(item.displayUrl)}
                style={({ pressed }) => [
                  styles.cell,
                  { width: CELL_W },
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Image
                  source={{ uri: item.previewUrl }}
                  style={[styles.cellImage, { width: CELL_W, height: CELL_H }]}
                  resizeMode="cover"
                />
                <View style={styles.gifBadge}>
                  <Text style={styles.gifBadgeText}>GIF</Text>
                </View>
              </Pressable>
            )}
          />
        )}

        <Pressable onPress={onClose} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: THEME.surfaceHigh,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: THEME.border,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 36,
    maxHeight: "72%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: THEME.border,
    alignSelf: "center",
    marginBottom: 14,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 18,
    color: THEME.text,
    marginBottom: 12,
    textAlign: "center",
  },
  searchInput: {
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.text,
    marginBottom: 12,
  },
  loadingWrap: {
    paddingVertical: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    gap: 8,
    paddingBottom: 8,
  },
  columnWrap: {
    gap: 8,
    justifyContent: "space-between",
  },
  cell: {
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
  },
  cellImage: {
    borderRadius: 10,
  },
  gifBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  gifBadgeText: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: "#fff",
    letterSpacing: 0.5,
  },
  cancelBtn: {
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textFaint,
  },
});
