/**
 * UserProfileModal
 *
 * Shows a user's OnlyMonkes profile when their username is tapped
 * in a message bubble.
 *
 * For the local user: shows their full bio.
 * For other users: shows username + XMTP address (bio is device-local
 * and not transmitted over the wire protocol).
 */

import React from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  Image,
} from "react-native";
import { useAppStore } from "@/store/appStore";
import { THEME, FONTS } from "@/lib/constants";
import { shortenAddress } from "@/lib/nftVerification";

export interface ProfileTarget {
  senderAddress: string;      // XMTP inboxId
  senderUsername?: string;
  senderNft?: { mint: string; name: string; image: string | null } | null;
}

interface UserProfileModalProps {
  visible: boolean;
  target: ProfileTarget | null;
  onClose: () => void;
}

export function UserProfileModal({ visible, target, onClose }: UserProfileModalProps) {
  const { myInboxId, username: myUsername, bio: myBio, verifiedNft } = useAppStore();

  if (!target) return null;

  const isOwnProfile = target.senderAddress === myInboxId;

  const displayName = isOwnProfile
    ? (myUsername ?? target.senderUsername ?? "Unknown Monke")
    : (target.senderUsername ?? shortenAddress(target.senderAddress));

  const nftImage = isOwnProfile
    ? verifiedNft?.image
    : target.senderNft?.image;

  const nftName = isOwnProfile
    ? verifiedNft?.name
    : target.senderNft?.name;

  const bio = isOwnProfile ? myBio : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          {/* NFT Avatar */}
          <View style={styles.avatarArea}>
            {nftImage ? (
              <Image source={{ uri: nftImage }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarGlyph}>🐒</Text>
              </View>
            )}
            {isOwnProfile && (
              <View style={styles.ownBadge}>
                <Text style={styles.ownBadgeText}>You</Text>
              </View>
            )}
          </View>

          {/* Name */}
          <Text style={styles.username}>{displayName}</Text>

          {/* NFT name */}
          {nftName && (
            <Text style={styles.nftName}>{nftName}</Text>
          )}

          {/* Address pill */}
          <View style={styles.addressPill}>
            <Text style={styles.addressText}>
              {shortenAddress(target.senderAddress, 6)}
            </Text>
          </View>

          {/* Bio */}
          {isOwnProfile && bio ? (
            <View style={styles.bioBox}>
              <Text style={styles.bioLabel}>Bio</Text>
              <Text style={styles.bioText}>{bio}</Text>
            </View>
          ) : !isOwnProfile ? (
            <View style={styles.bioBox}>
              <Text style={styles.bioUnavailable}>
                Bio not available
              </Text>
            </View>
          ) : null}

          {/* Close */}
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  card: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: THEME.surfaceHigh,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: THEME.border,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
    gap: 10,
  },
  avatarArea: {
    position: "relative",
    marginBottom: 4,
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: THEME.accent + "66",
  },
  avatarFallback: {
    width: 90,
    height: 90,
    borderRadius: 20,
    backgroundColor: THEME.accentSoft,
    borderWidth: 2,
    borderColor: THEME.accent + "44",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarGlyph: { fontSize: 44 },
  ownBadge: {
    position: "absolute",
    bottom: -6,
    right: -6,
    backgroundColor: THEME.accent,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ownBadgeText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: "#fff",
  },
  username: {
    fontFamily: FONTS.display,
    fontSize: 20,
    color: THEME.text,
    textAlign: "center",
  },
  nftName: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.accent,
    textAlign: "center",
  },
  addressPill: {
    backgroundColor: THEME.surface,
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  addressText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: THEME.textFaint,
  },
  bioBox: {
    alignSelf: "stretch",
    backgroundColor: THEME.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 14,
    gap: 4,
    marginTop: 4,
  },
  bioLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  bioText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: THEME.textMuted,
    lineHeight: 20,
  },
  bioUnavailable: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: THEME.textFaint,
    fontStyle: "italic",
    textAlign: "center",
  },
  closeBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
  },
  closeBtnText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.textMuted,
  },
});
