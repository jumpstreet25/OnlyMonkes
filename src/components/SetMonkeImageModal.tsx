/**
 * SetMonkeImageModal
 *
 * Shown when a wallet is verified but no NFT image is available (the
 * on-chain-only verification fallback can confirm ownership but can't fetch
 * compressed-NFT metadata — see onchainCnftVerify.ts). Rather than trying to
 * trace the exact leaf's mint metadata on-chain (expensive, possibly
 * impractical without a real indexer), the user supplies their own image:
 * they can already see their Monke in their wallet app's own NFT gallery
 * (Phantom/Solflare), save it, and upload it here like any other photo.
 */

import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Image, ActivityIndicator, Alert } from "react-native";
import { GlassModal } from "@/components/GlassModal";
import { THEME, FONTS } from "@/lib/constants";

interface SetMonkeImageModalProps {
  visible: boolean;
  onPicked: (imageUrl: string) => void;
  onSkip: () => void;
}

export function SetMonkeImageModal({ visible, onPicked, onSkip }: SetMonkeImageModalProps) {
  const [uploading, setUploading] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const handlePick = async () => {
    try {
      const IP = await import("expo-image-picker");
      const { status } = await IP.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Photo access required", "Please allow photo library access in your device settings.");
        return;
      }
      const result = await IP.launchImageLibraryAsync({
        mediaTypes: IP.MediaTypeOptions.Images,
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setPreviewUri(asset.uri);
      setUploading(true);

      const { compressImage, uploadFile } = await import("@/lib/videoUpload");
      const compressedUri = await compressImage(asset.uri);
      const url = await uploadFile(compressedUri, "monke-pfp.jpg", "image/jpeg");
      onPicked(url);
    } catch (err: any) {
      Alert.alert("Upload failed", err?.message ?? "Could not upload image.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <GlassModal visible={visible} onClose={onSkip} cardStyle={styles.sheet}>
      <View style={styles.content}>
        <Text style={styles.emoji}>🐒</Text>
        <Text style={styles.title}>Set Your Monke PFP</Text>
        <Text style={styles.body}>
          We couldn't auto-detect your Monke's image this time. Open your wallet app
          (Phantom, Solflare) and find your Saga Monke in your NFT gallery, save the
          image, then upload it here.
        </Text>

        {previewUri && (
          <Image source={{ uri: previewUri }} style={styles.preview} />
        )}

        <Pressable
          onPress={handlePick}
          disabled={uploading}
          style={[styles.pickBtn, uploading && styles.pickBtnDisabled]}
        >
          {uploading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.pickBtnText}>
              {previewUri ? "Choose a Different Photo" : "Pick from Photos"}
            </Text>
          )}
        </Pressable>

        <Pressable onPress={onSkip} style={styles.skipBtn} disabled={uploading}>
          <Text style={styles.skipText}>Skip for now — set it later in Settings</Text>
        </Pressable>
      </View>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 0, overflow: "hidden" },
  content: {
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: "center",
    gap: 12,
  },
  emoji: { fontSize: 40 },
  title: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: THEME.text,
    textAlign: "center",
  },
  body: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textMuted,
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 4,
  },
  preview: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginVertical: 4,
  },
  pickBtn: {
    alignSelf: "stretch",
    backgroundColor: THEME.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  pickBtnDisabled: { opacity: 0.6 },
  pickBtnText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 15,
    color: "#fff",
  },
  skipBtn: { paddingVertical: 10 },
  skipText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textFaint,
  },
});
