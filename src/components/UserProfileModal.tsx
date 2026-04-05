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
  Pressable,
  StyleSheet,
  Image,
  Linking,
} from "react-native";
import { GlassModal } from "@/components/GlassModal";
import { useAppStore } from "@/store/appStore";
import { THEME, FONTS } from "@/lib/constants";
import { shortenAddress } from "@/lib/nftVerification";
import { getCachedProfile } from "@/lib/userProfile";
import { getLastSeenText, isUserOnline } from "@/lib/presence";
import { OnlineDot } from "@/components/OnlineDot";
import { getEarnedBadges, getBadgeDef, BADGE_DEFS, getProgress } from "@/lib/badges";
import { loadBananaState, type BananaState } from "@/lib/bananaRewards";

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
  onMessage?: () => void;          // called when user taps "Message" on another user's card
}

export function UserProfileModal({ visible, target, onClose, onEditProfile, onChangePfp, onSwitchWallet, onLogout, onMessage }: UserProfileModalProps) {
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
    <GlassModal visible={visible} onClose={onClose} cardStyle={styles.card}>
          {/* NFT Avatar */}
          <View style={styles.avatarArea}>
            {nftImage ? (
              <Image source={{ uri: nftImage }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback} />
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

          {/* Online / Last seen */}
          {(() => {
            const lastSeen = getLastSeenText(target.senderAddress);
            if (!lastSeen) return null;
            const online = isUserOnline(target.senderAddress);
            return (
              <Text style={[styles.lastSeenText, online && { color: '#22c55e' }]}>
                {online ? '● Online' : `Last seen ${lastSeen}`}
              </Text>
            );
          })()}

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
              <Text style={styles.tipAddress} numberOfLines={1}>
                {tipWallet.slice(0, 6)}…{tipWallet.slice(-4)}
              </Text>
            </View>
          ) : null}

          {/* Earned badges (own profile only — cosmetic achievements) */}
          {isOwnProfile && (() => {
            const earned = getEarnedBadges();
            if (earned.length === 0) return null;
            return (
              <View style={styles.badgeSection}>
                <Text style={styles.badgeSectionTitle}>Achievements</Text>
                <View style={styles.badgeGrid}>
                  {earned.map(id => {
                    const def = getBadgeDef(id);
                    if (!def) return null;
                    return (
                      <View key={id} style={styles.badgePill}>
                        <Text style={styles.badgeEmoji}>{def.emoji}</Text>
                        <Text style={styles.badgeName}>{def.name}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })()}

          {/* Profile stats (own profile only) */}
          {isOwnProfile && (() => {
            const p = getProgress();
            const streak = useAppStore.getState().loginStreak;
            const bestStreak = useAppStore.getState().bestStreak;
            return (
              <View style={styles.badgeSection}>
                <Text style={styles.badgeSectionTitle}>Stats</Text>
                <View style={styles.statsGrid}>
                  <StatPill label="Messages" value={p.messages_sent} />
                  <StatPill label="Reactions" value={p.reactions_given} />
                  <StatPill label="Streak" value={streak} suffix="d" />
                  <StatPill label="Best" value={bestStreak} suffix="d" />
                  <StatPill label="Badges" value={getEarnedBadges().length} />
                </View>
              </View>
            );
          })()}

          {/* Message button (other profiles only) */}
          {!isOwnProfile && onMessage && (
            <Pressable
              onPress={() => { onClose(); setTimeout(onMessage!, 300); }}
              style={styles.messageBtn}
            >
              <Text style={styles.messageBtnText}>Message</Text>
            </Pressable>
          )}

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
                  <Text style={styles.changePfpText}>Change PFP</Text>
                </Pressable>
              )}
              {onSwitchWallet && (
                <Pressable
                  onPress={() => { onClose(); setTimeout(onSwitchWallet!, 300); }}
                  style={styles.switchBtn}
                >
                  <Text style={styles.switchBtnText}>Switch Wallet</Text>
                </Pressable>
              )}
              {onLogout && (
                <Pressable
                  onPress={() => { onClose(); setTimeout(onLogout!, 300); }}
                  style={styles.logoutBtn}
                >
                  <Text style={styles.logoutBtnText}>Log Out</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* Close */}
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
    </GlassModal>
  );
}

function StatPill({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statValue}>{value}{suffix ?? ""}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    gap: 10,
  },
  avatarArea: {
    position: "relative",
    marginBottom: 4,
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  avatarFallback: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "rgba(108, 180, 238, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarGlyph: { fontSize: 44 },
  ownBadge: {
    position: "absolute",
    bottom: -6,
    right: -6,
    backgroundColor: "#6CB4EE",
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
    color: "#6CB4EE",
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
  lastSeenText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: THEME.textMuted,
    marginTop: 4,
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
    color: "#6CB4EE",
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
    backgroundColor: "rgba(108, 180, 238, 0.15)",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  editBtnText: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: "#6CB4EE",
  },
  changePfpBtn: {
    alignSelf: "stretch",
    backgroundColor: THEME.surface,
    borderRadius: 12,
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
    backgroundColor: THEME.surface,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  logoutBtnText: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: "#ff6666",
  },
  messageBtn: {
    alignSelf: 'stretch',
    backgroundColor: "#6CB4EE",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  messageBtnText: {
    fontFamily: FONTS.displayMed,
    fontSize: 14,
    color: '#fff',
  },
  closeBtn: {
    marginTop: 4,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: THEME.surface,
  },
  closeBtnText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: THEME.textMuted,
  },
  // ── Badge achievements ──────────────────────────────────────────────────────
  badgeSection: {
    alignSelf: "stretch",
    marginTop: 4,
  },
  badgeSectionTitle: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textFaint,
    marginBottom: 6,
    textAlign: "center",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  badgeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
  },
  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  badgeEmoji: {
    fontSize: 13,
  },
  badgeName: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: THEME.textMuted,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
  },
  statPill: {
    alignItems: "center",
    backgroundColor: "rgba(108,180,238,0.08)",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(108,180,238,0.12)",
    minWidth: 60,
  },
  statValue: {
    fontFamily: FONTS.display,
    fontSize: 18,
    color: THEME.text,
  },
  statLabel: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: THEME.textMuted,
    marginTop: 2,
  },
});
