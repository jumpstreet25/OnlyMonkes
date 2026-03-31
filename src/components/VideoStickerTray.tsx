/**
 * VideoStickerTray — Monke sticker reaction picker for video calls.
 *
 * Horizontal scrollable row of SagaMonkes stickers at the bottom of the
 * video call screen, above the controls. Tap a sticker to broadcast it
 * to all participants via LiveKit data channel.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { searchStickers, type GiphyItem } from '@/lib/giphy';
import { sendVideoReaction } from '@/lib/liveVideo';
import { THEME } from '@/lib/constants';

interface VideoStickerTrayProps {
  senderName: string;
  senderId: string;
  /** Optional custom send function (e.g., avatarRoom.sendReaction). Defaults to liveVideo.sendVideoReaction. */
  onSend?: (stickerUrl: string) => void;
}

export function VideoStickerTray({ senderName, senderId, onSend }: VideoStickerTrayProps) {
  const [stickers, setStickers] = useState<GiphyItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    searchStickers('SagaMonkes', 20)
      .then(setStickers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handlePress = (item: GiphyItem) => {
    if (onSend) {
      onSend(item.displayUrl);
    } else {
      sendVideoReaction(item.displayUrl, senderName, senderId).catch(() => {});
    }
  };

  if (loading) {
    return (
      <View style={styles.tray}>
        <ActivityIndicator size="small" color="#0096C7" />
      </View>
    );
  }

  return (
    <View style={styles.tray}>
      <FlatList
        data={stickers}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => handlePress(item)}
            style={({ pressed }) => [styles.cell, pressed && { opacity: 0.6, transform: [{ scale: 1.15 }] }]}
          >
            <Image
              source={{ uri: item.previewUrl }}
              style={styles.stickerImg}
              contentFit="contain"
            />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    height: 56,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: 8,
    gap: 6,
    alignItems: 'center',
  },
  cell: {
    width: 44,
    height: 44,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  stickerImg: {
    width: 44,
    height: 44,
  },
});
