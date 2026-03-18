/**
 * MarketplaceScreen — P2P NFT trading for Saga Monkes.
 *
 * Tabs: Browse (active listings) | My Listings | List NFT
 *
 * Route: /marketplace
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  Image,
  Alert,
  TextInput,
  Modal,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { THEME, FONTS } from '@/lib/constants';
import { useAppStore } from '@/store/appStore';
import {
  getActiveListings,
  getMyListings,
  getBidsForListing,
  loadListings,
  type NftListing,
  type NftBid,
} from '@/lib/marketplace';
import { verifyNFTOwnership } from '@/lib/nftVerification';

type TabKey = 'browse' | 'mine' | 'list';

export default function MarketplaceScreen() {
  const insets = useSafeAreaInsets();
  const { width: SCREEN_W } = useWindowDimensions();
  const BANNER_H = Math.round(SCREEN_W * 0.28);
  const [tab, setTab] = useState<TabKey>('browse');
  const [listings, setListings] = useState<NftListing[]>([]);
  const [myListings, setMyListings] = useState<NftListing[]>([]);
  const [selectedListing, setSelectedListing] = useState<NftListing | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [listPrice, setListPrice] = useState('');

  const myInboxId = useAppStore(s => s.myInboxId);
  const allNfts = useAppStore(s => s.allNfts);
  const setAllNfts = useAppStore(s => s.setAllNfts);
  const username = useAppStore(s => s.username);
  const wallet = useAppStore(s => s.wallet);

  useEffect(() => {
    loadListings().then(() => {
      setListings(getActiveListings());
      if (myInboxId) setMyListings(getMyListings(myInboxId));
    });
  }, [myInboxId]);

  // Re-fetch full NFT list from Helius if allNfts is sparse (session restore only seeds 1)
  useEffect(() => {
    if (!wallet?.address || allNfts.length > 1) return;
    verifyNFTOwnership(wallet.address).then((result) => {
      if (result.verified && result.allNfts) {
        setAllNfts(result.allNfts);
      }
    }).catch(() => {});
  }, [wallet?.address]);

  const refreshListings = useCallback(() => {
    setListings(getActiveListings());
    if (myInboxId) setMyListings(getMyListings(myInboxId));
  }, [myInboxId]);

  const handleBid = useCallback(async (listing: NftListing) => {
    const price = parseFloat(bidAmount);
    if (isNaN(price) || price <= 0) {
      Alert.alert('Invalid Bid', 'Enter a valid SOL amount.');
      return;
    }
    if (!myInboxId || !wallet) {
      Alert.alert('Error', 'Wallet not connected.');
      return;
    }
    try {
      // Send bid message to group
      const { buildBidMessage } = require('@/lib/marketplace');
      const msg = buildBidMessage({
        listingId: listing.id,
        bidderInboxId: myInboxId,
        bidderUsername: username ?? undefined,
        bidderWallet: wallet.address,
        bidPrice: price,
      });
      // This will be sent via the group's send function
      // For now, show confirmation
      Alert.alert('Bid Placed', `You bid ${price} SOL on ${listing.name}`);
      setBidAmount('');
      setSelectedListing(null);
    } catch (err) {
      Alert.alert('Error', 'Failed to place bid.');
    }
  }, [bidAmount, myInboxId, username, wallet]);

  const handleList = useCallback(async (nft: { mint: string; name: string; image: string | null }) => {
    const price = parseFloat(listPrice);
    if (isNaN(price) || price <= 0) {
      Alert.alert('Invalid Price', 'Enter a valid SOL amount.');
      return;
    }
    if (!myInboxId || !wallet) return;
    try {
      const { buildListMessage } = require('@/lib/marketplace');
      const msg = buildListMessage({
        mint: nft.mint,
        name: nft.name,
        image: nft.image,
        sellerInboxId: myInboxId,
        sellerUsername: username ?? undefined,
        sellerWallet: wallet.address,
        askPrice: price,
      });
      Alert.alert('Listed!', `${nft.name} listed for ${price} SOL`);
      setListPrice('');
      refreshListings();
    } catch (err) {
      Alert.alert('Error', 'Failed to create listing.');
    }
  }, [listPrice, myInboxId, username, wallet, refreshListings]);

  const renderListing = useCallback(({ item }: { item: NftListing }) => {
    const bids = getBidsForListing(item.id);
    const topBid = bids.length > 0 ? bids[0].bidPrice : null;
    return (
      <Pressable
        style={styles.listingCard}
        onPress={() => setSelectedListing(item)}
      >
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.nftImage} />
        ) : (
          <View style={[styles.nftImage, styles.nftImageFallback]}>
            <Text style={{ fontSize: 28 }}>🐒</Text>
          </View>
        )}
        <View style={styles.listingInfo}>
          <Text style={styles.listingName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.listingSeller}>by {item.sellerUsername ?? 'anon'}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.askPrice}>{item.askPrice} SOL</Text>
            {topBid && (
              <Text style={styles.topBid}>Top bid: {topBid} SOL</Text>
            )}
          </View>
          {bids.length > 0 && (
            <Text style={styles.bidCount}>{bids.length} bid{bids.length !== 1 ? 's' : ''}</Text>
          )}
        </View>
      </Pressable>
    );
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Banner image */}
      <Image
        source={require("../../assets/Markets.png")}
        style={{ width: SCREEN_W, height: BANNER_H }}
        resizeMode="cover"
      />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backBtn}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Marketplace</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['browse', 'mine', 'list'] as TabKey[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => { setTab(t); refreshListings(); }}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'browse' ? 'Browse' : t === 'mine' ? 'My Listings' : 'List NFT'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Browse tab */}
      {tab === 'browse' && (
        <FlatList
          data={listings}
          renderItem={renderListing}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No active listings. Be the first to list!</Text>
          }
        />
      )}

      {/* My Listings tab */}
      {tab === 'mine' && (
        <FlatList
          data={myListings}
          renderItem={renderListing}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptyText}>You haven't listed any NFTs yet.</Text>
          }
        />
      )}

      {/* List NFT tab */}
      {tab === 'list' && (
        <ScrollView contentContainerStyle={styles.listTab}>
          <Text style={styles.sectionTitle}>Your Saga Monkes</Text>
          {allNfts.length === 0 ? (
            <Text style={styles.emptyText}>No Saga Monkes found in your wallet.</Text>
          ) : (
            allNfts.map((nft) => (
              <View key={nft.mint} style={styles.listNftRow}>
                {nft.image ? (
                  <Image source={{ uri: nft.image }} style={styles.listNftImg} />
                ) : (
                  <View style={[styles.listNftImg, styles.nftImageFallback]}>
                    <Text>🐒</Text>
                  </View>
                )}
                <View style={styles.listNftInfo}>
                  <Text style={styles.listNftName}>{nft.name}</Text>
                  <TextInput
                    style={styles.priceInput}
                    placeholder="Price (SOL)"
                    placeholderTextColor={THEME.textMuted}
                    keyboardType="decimal-pad"
                    value={listPrice}
                    onChangeText={setListPrice}
                  />
                </View>
                <Pressable
                  style={styles.listBtn}
                  onPress={() => handleList(nft)}
                >
                  <Text style={styles.listBtnText}>List</Text>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* Listing detail modal */}
      <Modal
        visible={!!selectedListing}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedListing(null)}
        statusBarTranslucent
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedListing(null)} />
        {selectedListing && (
          <View style={styles.modalSheet}>
            {selectedListing.image && (
              <Image source={{ uri: selectedListing.image }} style={styles.modalImage} />
            )}
            <Text style={styles.modalName}>{selectedListing.name}</Text>
            <Text style={styles.modalSeller}>
              Listed by {selectedListing.sellerUsername ?? 'anon'}
            </Text>
            <Text style={styles.modalAsk}>{selectedListing.askPrice} SOL</Text>

            {/* Bid input */}
            {selectedListing.sellerInboxId !== myInboxId && (
              <View style={styles.bidRow}>
                <TextInput
                  style={styles.bidInput}
                  placeholder="Your bid (SOL)"
                  placeholderTextColor={THEME.textMuted}
                  keyboardType="decimal-pad"
                  value={bidAmount}
                  onChangeText={setBidAmount}
                />
                <Pressable
                  style={styles.bidBtn}
                  onPress={() => handleBid(selectedListing)}
                >
                  <Text style={styles.bidBtnText}>Place Bid</Text>
                </Pressable>
              </View>
            )}

            {/* Existing bids */}
            {getBidsForListing(selectedListing.id).length > 0 && (
              <>
                <Text style={styles.bidsTitle}>Bids</Text>
                {getBidsForListing(selectedListing.id).map((bid, i) => (
                  <View key={i} style={styles.bidItem}>
                    <Text style={styles.bidder}>
                      {bid.bidderUsername ?? bid.bidderInboxId.slice(0, 8)}
                    </Text>
                    <Text style={styles.bidPrice}>{bid.bidPrice} SOL</Text>
                    {selectedListing.sellerInboxId === myInboxId && (
                      <Pressable style={styles.acceptBtn}>
                        <Text style={styles.acceptBtnText}>Accept</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </>
            )}
          </View>
        )}
      </Modal>

      <View style={{ height: insets.bottom }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  backBtn: { fontFamily: FONTS.mono, fontSize: 14, color: '#0096C7' },
  headerTitle: {
    fontFamily: FONTS.mono, fontSize: 18, fontWeight: '700',
    color: THEME.text, marginLeft: 12,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#0096C7' },
  tabText: { fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted },
  tabTextActive: { color: '#0096C7', fontWeight: '700' },
  list: { padding: 12 },
  listingCard: {
    flexDirection: 'row',
    backgroundColor: THEME.surface,
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: THEME.border,
  },
  nftImage: { width: 90, height: 90 },
  nftImageFallback: {
    backgroundColor: THEME.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listingInfo: { flex: 1, padding: 10 },
  listingName: { fontFamily: FONTS.mono, fontSize: 13, fontWeight: '700', color: THEME.text },
  listingSeller: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, marginTop: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  askPrice: { fontFamily: FONTS.mono, fontSize: 14, fontWeight: '700', color: '#22c55e' },
  topBid: { fontFamily: FONTS.mono, fontSize: 10, color: '#0096C7', marginLeft: 8 },
  bidCount: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.textMuted, marginTop: 2 },
  emptyText: {
    fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted,
    textAlign: 'center', paddingVertical: 40,
  },
  // List NFT tab
  listTab: { padding: 12 },
  sectionTitle: { fontFamily: FONTS.mono, fontSize: 14, fontWeight: '700', color: THEME.text, marginBottom: 10 },
  listNftRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: THEME.surface, borderRadius: 10,
    padding: 10, marginBottom: 8,
    borderWidth: 1, borderColor: THEME.border,
  },
  listNftImg: { width: 50, height: 50, borderRadius: 8 },
  listNftInfo: { flex: 1, marginLeft: 10 },
  listNftName: { fontFamily: FONTS.mono, fontSize: 12, fontWeight: '600', color: THEME.text },
  priceInput: {
    fontFamily: FONTS.mono, fontSize: 12, color: THEME.text,
    borderWidth: 1, borderColor: THEME.border, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4, marginTop: 4,
  },
  listBtn: {
    backgroundColor: '#0096C7', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8, marginLeft: 8,
  },
  listBtnText: { fontFamily: FONTS.mono, fontSize: 12, fontWeight: '700', color: '#fff' },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: {
    backgroundColor: THEME.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 16, maxHeight: '70%',
  },
  modalImage: { width: '100%', height: 200, borderRadius: 12, marginBottom: 12 },
  modalName: { fontFamily: FONTS.mono, fontSize: 18, fontWeight: '700', color: THEME.text },
  modalSeller: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted, marginTop: 2 },
  modalAsk: { fontFamily: FONTS.mono, fontSize: 20, fontWeight: '700', color: '#22c55e', marginTop: 8 },
  bidRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  bidInput: {
    flex: 1, fontFamily: FONTS.mono, fontSize: 14, color: THEME.text,
    borderWidth: 1, borderColor: THEME.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  bidBtn: {
    backgroundColor: '#0096C7', borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 10, marginLeft: 8,
  },
  bidBtnText: { fontFamily: FONTS.mono, fontSize: 13, fontWeight: '700', color: '#fff' },
  bidsTitle: {
    fontFamily: FONTS.mono, fontSize: 14, fontWeight: '700', color: THEME.text, marginTop: 16, marginBottom: 6,
  },
  bidItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: THEME.border,
  },
  bidder: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.text, flex: 1 },
  bidPrice: { fontFamily: FONTS.mono, fontSize: 12, fontWeight: '700', color: '#0096C7' },
  acceptBtn: {
    backgroundColor: '#22c55e', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8,
  },
  acceptBtnText: { fontFamily: FONTS.mono, fontSize: 10, fontWeight: '700', color: '#fff' },
});
