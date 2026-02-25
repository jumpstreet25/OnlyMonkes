/**
 * UserProfileModal
 *
 * Shows a user's OnlyMonkes profile when their PFP/username is tapped.
 *
 * Own profile: shows bio + X account, with an "Edit" button.
 * Others' profiles: shows bio + X account from PROFILE_UPDATE cache.
 */

import React from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  Image,
  Linking,
} from "react-native";
import { useAppStore } from "@/store/appStore";
import { THEME, FONTS } from "@/lib/constants";
import { shortenAddress } from "@/lib/nftVerification";
import { getCachedProfile } from "@/lib/userProfile";

export interface ProfileTarget {
  senderAddress: string;      // XMTP inboxId
  senderUsername?: string;
  senderNft?: { mint: string; name: string; image: string | null } | null;
}

interface UserProfileModalProps {
  visible: boolean;
  target: ProfileTarget | null;
  onClose: () => void;
  onEditProfile?: () => void;      // called when user taps "Edit Profile" on own card
  onChangePfp?: () => void;        // called when user taps "Change PFP" on own card
  onSwitchWallet?: () => void;     // called when user taps "Switch Wallet" on own card
  onLogout?: () => void;           // called when user taps "Log Out" on own card
}

export function UserProfileModal({ visible, target, onClose, onEditProfile, onChangePfp, onSwitchWallet, onLogout }: UserProfileModalProps) {
  const { myInboxId, username: myUsername, bio: myBio, xAccount: myXAccount, tipWallet: myTipWallet, verifiedNft } = useAppStore();

  if (!target) return null;

  const isOwnProfile = target.senderAddress === myInboxId;

  const displayName = isOwnProfile
    ? (myUsername ?? target.senderUsername ?? "Unknown Monke")
    : (target.senderUsername ?? shortenAddress(target.senderAddress));

  const nftImage = isOwnProfile ? verifiedNft?.image : target.senderNft?.image;
  const nftName  = isOwnProfile ? verifiedNft?.name  : target.senderNft?.name;

  // Bio + X + tipWallet: own from store, others from profile cache
  const cached    = !isOwnProfile ? getCachedProfile(target.senderAddress) : null;
  const bio       = isOwnProfile ? myBio       : (cached?.bio       || null);
  const xAccount  = isOwnProfile ? myXAccount  : (cached?.xAccount  || null);
  const tipWallet = isOwnProfile ? myTipWallet : (cached?.tipWallet || null);

  const handleOpenX = () => {
    if (!xAccount) return;
    const handle = xAccount.replace(/^@/, "");
    Linking.openURL(`https://x.com/${handle}`);
  };

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
          {bio ? (
            <View style={styles.bioBox}>
              <Text style={styles.bioLabel}>Bio</Text>
              <Text style={styles.bioText}>{bio}</Text>
            </View>
          ) : null}

          {/* X account */}
          {xAccount ? (
            <Pressable style={styles.xRow} onPress={handleOpenX}>
              <Text style={styles.xIcon}>𝕏</Text>
              <Text style={styles.xHandle}>@{xAccount.replace(/^@/, "")}</Text>
            </Pressable>
          ) : null}

          {/* Tipping wallet */}
          {tipWallet ? (
            <View style={styles.tipRow}>
              <Text style={styles.tipIcon}>💰</Text>
              <Text style={styles.tipAddress} numberOfLines={1}>
                {tipWallet.slice(0, 6)}…{tipWallet.slice(-4)}
              </Text>
            </View>
          ) : null}

          {/* Edit + Change PFP buttons (own profile only) */}
          {isOwnProfile && (
            <View style={styles.ownActions}>
              {onEditProfile && (
                <Pressable
                  onPress={() => { onClose(); setTimeout(onEditProfile, 300); }}
                  style={styles.editBtn}
                >
                  <Text style={styles.editBtnText}>Edit Profile</Text>
                </Pressable>
              )}
              {onChangePfp && (
                <Pressable
                  onPress={() => { onClose(); setTimeout(onChangePfp, 300); }}
                  style={styles.changePfpBtn}
                >
                  <Text style={styles.changePfpText}>🎨 Change PFP</Text>
                </Pressable>
              )}
              {onSwitchWallet && (
                <Pressable
                  onPress={() => { onClose(); setTimeout(onSwitchWallet!, 300); }}
                  style={styles.switchBtn}
                >
                  <Text style={styles.switchBtnText}>🔄 Switch Wallet</Text>
                </Pressable>
              )}
              {onLogout && (
                <Pressable
                  onPress={() => { onClose(); setTimeout(onLogout!, 300); }}
                  style={styles.logoutBtn}
                >
                  <Text style={styles.logoutBtnText}>🚪 Log Out</Text>
                </Pressable>
              )}
            </View>
          )}

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
  xRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: THEME.surface,
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  xIcon: {
    fontFamily: FONTS.display,
    fontSize: 13,
    color: THEME.text,
  },
  xHandle: {
    fontFamily: FONTS.mono,
    fontSize: 13,
    color: THEME.accent,
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: THEME.surface,
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  tipIcon: { fontSize: 13 },
  tipAddress: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: THEME.textMuted,
  },
  ownActions: {
    alignSelf: "stretch",
    gap: 8,
    marginTop: 4,
  },
  editBtn: {
    alignSelf: "stretch",
    backgroundColor: THEME.accentSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.accent + "55",
    paddingVertical: 12,
    alignItems: "center",
  },
  editBtnText: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: THEME.accent,
  },
  changePfpBtn: {
    alignSelf: "stretch",
    backgroundColor: THEME.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingVertical: 12,
    alignItems: "center",
  },
  changePfpText: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: THEME.textMuted,
  },
  switchBtn: {
    alignSelf: "stretch",
    backgroundColor: THEME.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingVertical: 12,
    alignItems: "center",
  },
  switchBtnText: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: THEME.textMuted,
  },
  logoutBtn: {
    alignSelf: "stretch",
    backgroundColor: "transparent",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ff444455",
    paddingVertical: 12,
    alignItems: "center",
  },
  logoutBtnText: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: "#ff6666",
  },
  closeBtn: {
    marginTop: 4,
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
