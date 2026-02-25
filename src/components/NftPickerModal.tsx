/**
 * NftPickerModal
 *
 * Shown when a wallet owns more than one Saga Monke NFT.
 * The user picks which one to use as their in-chat PFP.
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  Image,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { THEME, FONTS } from "@/lib/constants";
import { loadMatricaSession } from "@/lib/session";
import { verifyNFTOwnership } from "@/lib/nftVerification";
import type { OwnedNFT } from "@/types";

interface NftPickerModalProps {
  visible: boolean;
  nfts: OwnedNFT[];
  onSelect: (nft: OwnedNFT) => void;
  onCancel?: () => void;
}

export function NftPickerModal({ visible, nfts, onSelect, onCancel }: NftPickerModalProps) {
  const [selected, setSelected] = useState<OwnedNFT | null>(null);
  const [allNfts, setAllNfts] = useState<OwnedNFT[]>(nfts);
  const [loadingMatrica, setLoadingMatrica] = useState(false);
  const [matricaLoaded, setMatricaLoaded] = useState(false);

  // Reset when modal opens with fresh nft list
  useEffect(() => {
    if (visible) {
      setAllNfts(nfts);
      setSelected(null);
      setMatricaLoaded(false);
    }
  }, [visible, nfts]);

  const handleLoadMatrica = async () => {
    setLoadingMatrica(true);
    try {
      const matricaWallet = await loadMatricaSession();
      if (!matricaWallet?.address) {
        setMatricaLoaded(true); // no session — hide button gracefully
        return;
      }
      const result = await verifyNFTOwnership(matricaWallet.address);
      if (result.allNfts && result.allNfts.length > 0) {
        // Merge without duplicates
        setAllNfts((prev) => {
          const existingMints = new Set(prev.map((n) => n.mint));
          const fresh = result.allNfts!.filter((n) => !existingMints.has(n.mint));
          return [...prev, ...fresh];
        });
      }
      setMatricaLoaded(true);
    } catch {
      setMatricaLoaded(true);
    } finally {
      setLoadingMatrica(false);
    }
  };

  const handleConfirm = () => {
    if (selected) onSelect(selected);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Choose Your Monke PFP</Text>
            <Text style={styles.subtitle}>
              {allNfts.length} Saga Monke{allNfts.length !== 1 ? "s" : ""} found. Pick one to show in chat.
            </Text>
          </View>

          {/* Matrica wallet loader */}
          {!matricaLoaded && (
            <Pressable
              style={[styles.matricaBtn, loadingMatrica && { opacity: 0.6 }]}
              onPress={handleLoadMatrica}
              disabled={loadingMatrica}
            >
              {loadingMatrica ? (
                <ActivityIndicator size="small" color={THEME.accent} />
              ) : (
                <Text style={styles.matricaBtnText}>🔗 Load Matrica Wallet NFTs</Text>
              )}
            </Pressable>
          )}

          {/* NFT grid */}
          <FlatList
            data={allNfts}
            keyExtractor={(item) => item.mint}
            numColumns={2}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.grid}
            renderItem={({ item }) => {
              const isSelected = selected?.mint === item.mint;
              return (
                <Pressable
                  style={[styles.card, isSelected && styles.cardSelected]}
                  onPress={() => setSelected(item)}
                >
                  {item.image ? (
                    <Image
                      source={{ uri: item.image }}
                      style={styles.nftImage}
                    />
                  ) : (
                    <View style={[styles.nftImage, styles.nftImageFallback]}>
                      <Text style={styles.nftFallbackGlyph}>🐒</Text>
                    </View>
                  )}
                  <Text style={styles.nftName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  {isSelected && (
                    <View style={styles.selectedBadge}>
                      <Text style={styles.selectedBadgeText}>✓</Text>
                    </View>
                  )}
                </Pressable>
              );
            }}
          />

          {/* Cancel button (when opened from within chat) */}
          {onCancel && (
            <Pressable onPress={onCancel} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          )}

          {/* Confirm button */}
          <Pressable
            onPress={handleConfirm}
            disabled={!selected}
            style={[styles.confirmBtn, !selected && styles.confirmBtnDisabled]}
          >
            <LinearGradient
              colors={selected ? ["#9c7cff", "#7c5cfc"] : [THEME.surface, THEME.surface]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.confirmGradient}
            >
              <Text style={[styles.confirmText, !selected && styles.confirmTextDisabled]}>
                Use as My PFP
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    padding: 20,
  },
  sheet: {
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: THEME.border,
    overflow: "hidden",
    maxHeight: "90%",
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 16,
    gap: 6,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: THEME.text,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textMuted,
    textAlign: "center",
    lineHeight: 18,
  },
  grid: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  row: {
    gap: 12,
    marginBottom: 12,
  },
  card: {
    flex: 1,
    backgroundColor: THEME.surface,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: THEME.border,
    padding: 10,
    alignItems: "center",
    gap: 8,
    position: "relative",
  },
  cardSelected: {
    borderColor: THEME.accent,
    backgroundColor: THEME.accentSoft,
  },
  nftImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 10,
  },
  nftImageFallback: {
    backgroundColor: THEME.surfaceHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  nftFallbackGlyph: { fontSize: 36 },
  nftName: {
    fontFamily: FONTS.bodyMed,
    fontSize: 12,
    color: THEME.textMuted,
    textAlign: "center",
  },
  selectedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: THEME.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedBadgeText: {
    fontSize: 12,
    color: "#fff",
    fontWeight: "700",
  },
  matricaBtn: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 10,
    backgroundColor: THEME.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.accent + "55",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
  },
  matricaBtnText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 13,
    color: THEME.accent,
  },
  cancelBtn: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  cancelText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textFaint,
  },
  confirmBtn: {
    margin: 16,
    marginTop: 0,
    borderRadius: 14,
    overflow: "hidden",
  },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmGradient: {
    paddingVertical: 16,
    alignItems: "center",
  },
  confirmText: {
    fontFamily: FONTS.bodySemi,
    fontSize: 16,
    color: "#fff",
  },
  confirmTextDisabled: {
    color: THEME.textFaint,
  },
});
