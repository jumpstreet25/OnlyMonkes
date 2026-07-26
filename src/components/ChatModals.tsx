import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  Modal,
  TextInput,
  ActivityIndicator,
} from "react-native";
// 2026-05-23: switched chat list to FlatList for stability — alias kept.
import type { FlatList as FlashListRef } from "react-native";
import { router } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { THEME, FONTS } from "@/lib/constants";
import { ConfettiView } from "@/components/ConfettiView";
import { BananaClaimModal } from "@/components/BananaClaimModal";
import { OnboardingOverlay } from "@/components/OnboardingOverlay";
import { BadgeNotificationBanner } from "@/components/BadgeNotificationBanner";
import { ScrollToBottomFab } from "@/components/ScrollToBottomFab";
import { UsernameModal } from "@/components/UsernameModal";
import { MenuDrawer } from "@/components/MenuDrawer";
import { SearchModal } from "@/components/SearchModal";
import { CalendarModal } from "@/components/CalendarModal";
import { TipModal } from "@/components/TipModal";
import { SwapConfirmModal } from "@/components/SwapConfirmModal";
import { GifPickerModal } from "@/components/GifPickerModal";
import { NftPickerModal } from "@/components/NftPickerModal";
import { SetMonkeImageModal } from "@/components/SetMonkeImageModal";
import ImageLightbox from "@/components/ImageLightbox";
import { ChartModal } from "@/components/ChartModal";
import { UserProfileModal, type ProfileTarget } from "@/components/UserProfileModal";
import { VideoCameraModal } from "@/components/VideoCameraModal";
import { PhotoReviewModal } from "@/components/PhotoReviewModal";
import { GlassBottomSheet } from "@/components/GlassBottomSheet";
import { MessageActionSheet } from "@/components/MessageActionSheet";
import { useAppStore } from "@/store/appStore";
import { addBananas } from "@/lib/bananaRewards";
import { saveSelectedNftMint } from "@/lib/userProfile";
import type { ChatMessage, ReactionEmoji } from "@/types";
import type { ClaimResult } from "@/lib/bananaRewards";
import type { SwapQuote } from "@/lib/jupiterSwap";
import type { Badge } from "@/lib/activityBadges";
import type { TipAmount } from "@/lib/constants";
import type { FlatList } from "react-native";

// 2026-07-22: was dynamically importing expo-av to defer its startup cost —
// no longer meaningful now that VideoCameraModal (imported statically just
// above) already pulls expo-video into this same file's module graph
// unconditionally. A dynamic import here would also make useVideoPlayer a
// conditionally-called hook, which Rules of Hooks disallows.
function LazyVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.play(); });
  return (
    <VideoView
      player={player}
      style={{ flex: 1 }}
      nativeControls
      contentFit="contain"
    />
  );
}

export interface ChatModalsProps {
  // Confetti
  showConfetti: boolean;
  setShowConfetti: (v: boolean) => void;

  // Banana claim
  bananaClaim: ClaimResult | null;
  setBananaClaim: (v: ClaimResult | null) => void;

  // Onboarding
  showOnboarding: boolean;
  setShowOnboarding: (v: boolean) => void;

  // Badge
  earnedBadge: Badge | null;
  setEarnedBadge: (v: Badge | null) => void;

  // Scroll FAB
  showScrollFab: boolean;
  unreadWhileScrolled: number;
  flatListRef: React.RefObject<FlashListRef<ChatMessage> | null>;
  setShowScrollFab: (v: boolean) => void;
  setUnreadWhileScrolled: (v: number) => void;

  // Username
  showUsernameModal: boolean;
  setShowUsernameModal: (v: boolean) => void;
  editingProfile: boolean;
  setEditingProfile: (v: boolean) => void;
  username: string | null;
  bio: string | null;
  xAccount: string | null;
  tipWallet: string | null;
  userLocation: string | null;
  broadcastProfile: () => Promise<void>;

  // Drawer
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
  handleStartAvatarRoom: () => void;
  handleStartVideoCall: () => void;
  handleConfirmDevTip: (amount: TipAmount) => Promise<void>;
  setSearchOpen: (v: boolean) => void;
  setCalendarOpen: (v: boolean) => void;
  setProfileTarget: (v: ProfileTarget | null) => void;
  setPfpPickerOpen: (v: boolean) => void;
  pfpImagePickerOpen: boolean;
  setPfpImagePickerOpen: (v: boolean) => void;

  // Search
  searchOpen: boolean;

  // Calendar
  calendarOpen: boolean;
  broadcastEvent: (...args: any[]) => Promise<void>;

  // Tips
  tipTarget: ChatMessage | null;
  setTipTarget: (v: ChatMessage | null) => void;
  handleConfirmTip: (amount: TipAmount) => Promise<void>;
  devTipOpen: boolean;
  setDevTipOpen: (v: boolean) => void;

  // Swap
  swapConfirmOpen: boolean;
  swapQuote: SwapQuote | null;
  swapExecuting: boolean;
  handleConfirmSwap: () => Promise<void>;
  handleCancelSwap: () => void;

  // GIF picker
  gifPickerOpen: boolean;
  setGifPickerOpen: (v: boolean) => void;
  pfpGifPickerOpen: boolean;
  setPfpGifPickerOpen: (v: boolean) => void;
  handleSendGif: (url: string) => void;

  // NFT picker
  pfpPickerOpen: boolean;
  allNfts: any[];
  setVerified: (verified: boolean, nft: any) => void;

  // Image lightbox
  lightboxUrl: string | null;
  setLightboxUrl: (v: string | null) => void;

  // Chart
  chartSymbol: string | null;
  setChartSymbol: (v: string | null) => void;

  // Profile
  profileTarget: ProfileTarget | null;
  myAddress: string;
  logout: () => Promise<void>;

  // Video camera
  videoModalOpen: boolean;
  setVideoModalOpen: (v: boolean) => void;
  handleVideoSend: (content: string) => void;

  // Video lightbox
  videoLightboxUrl: string | null;
  setVideoLightboxUrl: (v: string | null) => void;
  handleDownloadVideo: (uri: string) => void;

  // Edit message
  editTarget: ChatMessage | null;
  setEditTarget: (v: ChatMessage | null) => void;
  editText: string;
  setEditText: (v: string) => void;
  handleEditSubmit: () => void;

  // Share on X
  xShareImageUri: string | null;
  setXShareImageUri: (v: string | null) => void;
  handleShareToX: () => void;

  // Photo review (caption picker before send)
  photoReviewVisible: boolean;
  photoReviewImageUri: string | null;
  photoReviewRequestId: string | null;
  handlePhotoReviewSend: (caption: string) => void;
  handlePhotoReviewCancel: () => void;

  // Message action sheet (react/reply/copy/edit/delete/pin/thread/sticker)
  actionSheetTarget: ChatMessage | null;
  setActionSheetTarget: (v: ChatMessage | null) => void;
  handleReact: (emoji: ReactionEmoji, messageId: string) => void;
  setReplyingTo: (msg: ChatMessage | null) => void;
  handleEditMessage: (msg: ChatMessage) => void;
  handleDelete: (msg: ChatMessage) => void;
  handlePin: ((msg: ChatMessage) => void) | undefined;
  handleThread: (msg: ChatMessage) => void;
  handleStickerReact: (url: string, messageId: string) => void;
}

export function ChatModals(props: ChatModalsProps) {
  const {
    showConfetti, setShowConfetti,
    bananaClaim, setBananaClaim,
    showOnboarding, setShowOnboarding,
    earnedBadge, setEarnedBadge,
    showScrollFab, unreadWhileScrolled, flatListRef, setShowScrollFab, setUnreadWhileScrolled,
    showUsernameModal, setShowUsernameModal, editingProfile, setEditingProfile,
    username, bio, xAccount, tipWallet, userLocation, broadcastProfile,
    drawerOpen, setDrawerOpen, handleStartAvatarRoom, handleStartVideoCall,
    handleConfirmDevTip, setSearchOpen, setCalendarOpen, setProfileTarget, setPfpPickerOpen,
    pfpImagePickerOpen, setPfpImagePickerOpen,
    searchOpen, calendarOpen, broadcastEvent,
    tipTarget, setTipTarget, handleConfirmTip,
    devTipOpen, setDevTipOpen,
    swapConfirmOpen, swapQuote, swapExecuting, handleConfirmSwap, handleCancelSwap,
    gifPickerOpen, setGifPickerOpen, pfpGifPickerOpen, setPfpGifPickerOpen, handleSendGif,
    pfpPickerOpen, allNfts, setVerified,
    lightboxUrl, setLightboxUrl,
    chartSymbol, setChartSymbol,
    profileTarget, myAddress, logout,
    videoModalOpen, setVideoModalOpen, handleVideoSend,
    videoLightboxUrl, setVideoLightboxUrl, handleDownloadVideo,
    editTarget, setEditTarget, editText, setEditText, handleEditSubmit,
    xShareImageUri, setXShareImageUri, handleShareToX,
    photoReviewVisible, photoReviewImageUri, photoReviewRequestId,
    handlePhotoReviewSend, handlePhotoReviewCancel,
    actionSheetTarget, setActionSheetTarget, handleReact, setReplyingTo,
    handleEditMessage, handleDelete, handlePin, handleThread, handleStickerReact,
  } = props;

  const isGroupAdmin = useAppStore(s => s.isGroupAdmin);
  const wallet = useAppStore(s => s.wallet);
  const verifiedNft = useAppStore(s => s.verifiedNft);

  return (
    <>
      {showConfetti && <ConfettiView onDone={() => setShowConfetti(false)} />}

      <BananaClaimModal
        visible={!!bananaClaim}
        claim={bananaClaim}
        onDismiss={() => setBananaClaim(null)}
      />

      <OnboardingOverlay
        visible={showOnboarding}
        onComplete={async (bonus) => {
          setShowOnboarding(false);
          const newBalance = await addBananas(bonus);
          useAppStore.getState().setBananaBalance(newBalance);
        }}
      />

      <BadgeNotificationBanner
        badge={earnedBadge}
        onDismiss={() => setEarnedBadge(null)}
      />

      <ScrollToBottomFab
        visible={showScrollFab}
        unreadCount={unreadWhileScrolled}
        onPress={() => {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
          setShowScrollFab(false);
          setUnreadWhileScrolled(0);
        }}
      />

      <UsernameModal
        visible={showUsernameModal || editingProfile}
        onDone={async () => {
          setShowUsernameModal(false);
          setEditingProfile(false);
          await broadcastProfile();
        }}
        editMode={editingProfile}
        initialUsername={editingProfile ? (username ?? "") : ""}
        initialBio={editingProfile ? (bio ?? "") : ""}
        initialXAccount={editingProfile ? (xAccount ?? "") : ""}
        initialTipWallet={editingProfile ? (tipWallet ?? "") : ""}
        initialLocation={editingProfile ? (userLocation ?? "") : ""}
      />

      <MenuDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreateEvent={() => setCalendarOpen(true)}
        onStartLive={handleStartAvatarRoom}
        onStartVideo={handleStartVideoCall}
        onSearch={() => setSearchOpen(true)}
        onPressUser={(target) => { setDrawerOpen(false); setTimeout(() => setProfileTarget(target), 300); }}
        broadcastProfile={broadcastProfile}
        onDevTip={(amount) => {
          setDrawerOpen(false);
          handleConfirmDevTip(amount);
        }}
        onEditProfile={() => {
          setTimeout(() => { setEditingProfile(true); setShowUsernameModal(true); }, 300);
        }}
        onSwitchPfp={() => {
          setTimeout(() => setPfpPickerOpen(true), 300);
        }}
      />

      <SearchModal visible={searchOpen} onClose={() => setSearchOpen(false)} />

      <CalendarModal
        visible={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        onBroadcast={broadcastEvent}
      />

      <TipModal
        visible={!!tipTarget}
        recipientName={tipTarget?.senderUsername ?? "this monke"}
        onConfirm={handleConfirmTip}
        onClose={() => setTipTarget(null)}
      />

      <TipModal
        visible={devTipOpen}
        recipientName="Jump.skr"
        onConfirm={handleConfirmDevTip}
        onClose={() => setDevTipOpen(false)}
      />

      <SwapConfirmModal
        visible={swapConfirmOpen}
        quote={swapQuote}
        isExecuting={swapExecuting}
        onConfirm={handleConfirmSwap}
        onCancel={handleCancelSwap}
      />

      <GifPickerModal
        visible={gifPickerOpen}
        onClose={() => setGifPickerOpen(false)}
        onSelect={handleSendGif}
      />

      <GifPickerModal
        visible={pfpGifPickerOpen}
        onClose={() => setPfpGifPickerOpen(false)}
        onSelect={handleSendGif}
        sagaMonkesOnly
      />

      <NftPickerModal
        visible={pfpPickerOpen}
        nfts={allNfts}
        onCancel={() => setPfpPickerOpen(false)}
        onSelect={async (nft) => {
          setVerified(true, nft);
          await saveSelectedNftMint(nft.mint);
          const { syncPfpBindings, getEquippedStyles: getStyles } = await import("@/lib/bananaShop");
          const { applyThemeFromShop: applyTheme } = await import("@/lib/shopTheme");
          await syncPfpBindings(nft.mint);
          const s = await getStyles();
          useAppStore.getState().setShopStyles(s);
          applyTheme(s);
          setPfpPickerOpen(false);
          await broadcastProfile();
        }}
      />

      {/* Image Lightbox (pinch-to-zoom, swipe dismiss, watermark) */}
      <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />

      {/* GlassBottomSheet-based components must render AFTER KAV so they paint on top */}
      <ChartModal
        visible={!!chartSymbol}
        symbol={chartSymbol ?? ''}
        onClose={() => setChartSymbol(null)}
      />

      <SetMonkeImageModal
        visible={pfpImagePickerOpen}
        onSkip={() => setPfpImagePickerOpen(false)}
        onPicked={async (imageUrl) => {
          if (!wallet?.address) { setPfpImagePickerOpen(false); return; }
          const { setUserChosenNftImage } = await import("@/lib/nftVerification");
          const nft = await setUserChosenNftImage(wallet.address, imageUrl, verifiedNft);
          setVerified(true, nft);
          setPfpImagePickerOpen(false);
          await broadcastProfile();
        }}
      />

      <UserProfileModal
        visible={!!profileTarget}
        target={profileTarget}
        onClose={() => setProfileTarget(null)}
        onEditProfile={() => setEditingProfile(true)}
        onChangePfp={
          allNfts.length > 0
            ? () => (verifiedNft?.image ? setPfpPickerOpen(true) : setPfpImagePickerOpen(true))
            : undefined
        }
        onLogout={async () => { await logout(); router.replace("/"); }}
        onSwitchWallet={async () => { await logout(); router.replace("/"); }}
        onMessage={profileTarget && profileTarget.senderAddress !== myAddress
          ? () => router.push(`/dm/${profileTarget.senderAddress}`)
          : undefined
        }
      />

      <VideoCameraModal
        visible={videoModalOpen}
        onClose={() => setVideoModalOpen(false)}
        onSend={handleVideoSend}
      />

      {/* Video Lightbox */}
      <Modal
        visible={!!videoLightboxUrl}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setVideoLightboxUrl(null)}
      >
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <LazyVideo uri={videoLightboxUrl!} />
          {/* Watermark overlay */}
          <View style={{ position: 'absolute', bottom: 72, right: 16, opacity: 0.7 }} pointerEvents="none">
            <Image
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              source={require('../../assets/watermark.png')}
              style={{ width: 120, height: 40 }}
              resizeMode="contain"
            />
          </View>
          {/* Close button */}
          <Pressable
            onPress={() => setVideoLightboxUrl(null)}
            style={{ position: 'absolute', top: 52, right: 20, width: 36, height: 36,
                     borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)',
                     alignItems: 'center', justifyContent: 'center' }}
            hitSlop={10}
          >
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>✕</Text>
          </Pressable>
          {/* Download button */}
          <Pressable
            onPress={() => videoLightboxUrl && handleDownloadVideo(videoLightboxUrl)}
            style={{ position: 'absolute', top: 52, right: 66, width: 36, height: 36,
                     borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)',
                     alignItems: 'center', justifyContent: 'center' }}
            hitSlop={10}
          >
            <Text style={{ color: '#fff', fontSize: 16 }}>⬇</Text>
          </Pressable>
        </View>
      </Modal>

      {/* Edit Message Modal */}
      <Modal
        visible={!!editTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setEditTarget(null)}
      >
        <Pressable style={modalStyles.overlay} onPress={() => setEditTarget(null)}>
          <Pressable style={modalStyles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={modalStyles.title}>Edit Message</Text>
            <TextInput
              style={modalStyles.input}
              value={editText}
              onChangeText={setEditText}
              autoFocus
              multiline
              maxLength={2000}
              placeholderTextColor={THEME.textFaint}
            />
            <View style={modalStyles.btnRow}>
              <Pressable onPress={() => setEditTarget(null)} style={modalStyles.cancelBtn}>
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleEditSubmit} style={modalStyles.confirmBtn}>
                <Text style={modalStyles.confirmText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Share on X Popup */}
      <GlassBottomSheet
        visible={!!xShareImageUri}
        onClose={() => setXShareImageUri(null)}
        snapPoints={['55%']}
      >
        <View style={modalStyles.xShareContent}>
          <View style={modalStyles.xShareHeader}>
            <Text style={[modalStyles.title, { flex: 1 }]}>Share this Image on X?</Text>
            <Pressable
              onPress={() => setXShareImageUri(null)}
              style={modalStyles.xShareCloseBtn}
              hitSlop={10}
            >
              <Text style={modalStyles.closeXText}>✕</Text>
            </Pressable>
          </View>

          {xShareImageUri && (
            <View style={modalStyles.previewWrap}>
              <Image
                source={{ uri: xShareImageUri }}
                style={modalStyles.previewImg}
                resizeMode="cover"
              />
              <Image
                source={require("../../assets/watermark.png")}
                style={modalStyles.previewWatermark}
                resizeMode="contain"
              />
            </View>
          )}
          <Text style={modalStyles.caption}>Shot Using @xOnlyMonkes</Text>

          <Pressable onPress={handleShareToX} style={modalStyles.xBtn}>
            <Text style={modalStyles.xBtnText}>Share this Image on X</Text>
          </Pressable>
        </View>
      </GlassBottomSheet>

      <PhotoReviewModal
        visible={photoReviewVisible}
        imageUri={photoReviewImageUri}
        requestId={photoReviewRequestId}
        onSend={handlePhotoReviewSend}
        onCancel={handlePhotoReviewCancel}
      />

      <MessageActionSheet
        target={actionSheetTarget}
        onClose={() => setActionSheetTarget(null)}
        myAddress={myAddress}
        isGroupAdmin={isGroupAdmin}
        onReact={handleReact}
        onReply={setReplyingTo}
        onEdit={handleEditMessage}
        onDelete={handleDelete}
        onPin={isGroupAdmin ? handlePin : undefined}
        onThread={handleThread}
        onStickerReact={handleStickerReact}
      />
    </>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    backgroundColor: "#000",
    borderRadius: 20,
    padding: 20,
    width: "100%",
    maxWidth: 340,
    borderWidth: 1,
    borderColor: "#333",
    gap: 12,
    alignItems: "center",
  },
  title: {
    fontFamily: FONTS.displayMed,
    fontSize: 17,
    color: "#6CB4EE",
    textAlign: "center",
  },
  input: {
    fontFamily: FONTS.body,
    fontSize: 15,
    color: "#6CB4EE",
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 12,
    minHeight: 60,
    maxHeight: 140,
    alignSelf: "stretch",
    borderWidth: 1,
    borderColor: "#333",
    textAlignVertical: "top",
  },
  btnRow: {
    flexDirection: "row",
    gap: 10,
    alignSelf: "stretch",
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#111",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#333",
  },
  cancelText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: "#6CB4EE",
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#6CB4EE",
    alignItems: "center",
  },
  confirmText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 14,
    color: "#fff",
  },
  closeX: {
    position: "absolute",
    top: 12,
    left: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#6CB4EE",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  closeXText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
  xShareContent: {
    gap: 12,
    alignItems: "center",
  },
  xShareHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    alignSelf: "stretch",
  },
  xShareCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#6CB4EE",
    alignItems: "center",
    justifyContent: "center",
  },
  previewWrap: {
    width: 220,
    height: 220,
    borderRadius: 14,
    overflow: "hidden",
    alignSelf: "center",
  },
  previewImg: {
    width: 220,
    height: 220,
  },
  previewWatermark: {
    position: "absolute",
    bottom: 4,
    right: 4,
    width: 135,
    height: 68,
    opacity: 0.9,
  },
  caption: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: "#6CB4EE",
    textAlign: "center",
  },
  xBtn: {
    backgroundColor: "#6CB4EE",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignSelf: "stretch",
    alignItems: "center",
  },
  xBtnText: {
    fontFamily: FONTS.bodyMed,
    fontSize: 15,
    color: "#000",
  },
});
