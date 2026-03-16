/**
 * LinkPreviewCard — renders an OpenGraph preview card below a message
 * that contains a URL. Shows title, description, and image thumbnail.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { THEME, FONTS } from '@/lib/constants';
import {
  extractUrl,
  fetchLinkPreview,
  getCachedPreview,
  type LinkPreviewData,
} from '@/lib/linkPreview';

interface LinkPreviewCardProps {
  content: string;
}

export function LinkPreviewCard({ content }: LinkPreviewCardProps) {
  const [preview, setPreview] = useState<LinkPreviewData | null>(null);
  const url = extractUrl(content);

  useEffect(() => {
    if (!url) return;

    // Check cache first
    const cached = getCachedPreview(url);
    if (cached !== undefined) {
      setPreview(cached);
      return;
    }

    let mounted = true;
    fetchLinkPreview(url).then((data) => {
      if (mounted) setPreview(data);
    });
    return () => { mounted = false; };
  }, [url]);

  if (!url || !preview) return null;

  return (
    <Pressable
      style={styles.card}
      onPress={() => Linking.openURL(url).catch(() => {})}
    >
      {preview.image && (
        <ExpoImage
          source={{ uri: preview.image }}
          style={styles.image}
          contentFit="cover"
          transition={200}
        />
      )}
      <View style={styles.textWrap}>
        {preview.siteName && (
          <Text style={styles.siteName}>{preview.siteName}</Text>
        )}
        <Text style={styles.title} numberOfLines={2}>
          {preview.title}
        </Text>
        {preview.description && (
          <Text style={styles.description} numberOfLines={2}>
            {preview.description}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 6,
    borderRadius: 10,
    backgroundColor: THEME.surfaceHigh,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: THEME.border,
    maxWidth: 280,
  },
  image: {
    width: '100%',
    height: 120,
  },
  textWrap: {
    padding: 8,
  },
  siteName: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  title: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: THEME.text,
    fontWeight: '600',
  },
  description: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textMuted,
    marginTop: 2,
    lineHeight: 14,
  },
});
