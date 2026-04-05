/**
 * MarketplaceScreen — Magic Eden-style P2P NFT marketplace for Saga Monkes.
 *
 * 2-column grid of NFT cards. Tap → detail sheet with Buy Now / Place Bid /
 * Offer Monke Swap. All offers/bids are private — only the seller sees them
 * (notified via bot DM). Completed sales broadcast to MonkeSales channel.
 *
 * Route: /marketplace
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  Image,
  ImageBackground,
  Alert,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { THEME, FONTS, NFT_SALE_FEE_PCT } from '@/lib/constants';

const MAGIC_EDEN_URL = "https://magiceden.us/marketplace/sagamonkes";
import { useAppStore } from '@/store/appStore';
import {
  getActiveListings,
  getMyListings,
  getBidsForListing,
  getListingById,
  loadListings,
  addListing,
  markPendingSwap,
  markSold,
  revertPendingSwap,
  delistNft,
  buildListMessage,
  buildBidMessage,
  buildOfferMessage,
  buildAcceptMessage,
  buildDelistMessage,
  buildSwapMessage,
  buildCompleteMessage,
  type NftListing,
  type NftBid,
  type NftSwapMessage,
} from '@/lib/marketplace';
import {
  verifyCurrentOwner,
  sellerSignSwap,
  buyerCompleteSwap,
  validateSwapTransaction,
} from '@/lib/nftSwap';
import { verifyNFTOwnership } from '@/lib/nftVerification';
import { sendRawToGroup } from '@/hooks/useXmtp';
import {
  fetchTraitFloors,
  getTraitTypes,
  getTopTrait,
  getTraitValues,
} from '@/lib/traitFloor';
import type { OwnedNFT } from '@/types';
import MarketplaceFeeModal, {
  hasAcceptedMarketplaceFee,
  acceptMarketplaceFee,
} from '@/components/MarketplaceFeeModal';

// OnlyMonkes accent blue
const ACCENT = '#0096C7';
const ACCENT_SOFT = 'rgba(0, 150, 199, 0.12)';
const GREEN = '#22c55e';

type SortKey = 'recent' | 'low' | 'high';
type DetailAction = 'none' | 'bid' | 'swap';

export default function MarketplaceScreen() {
  const insets = useSafeAreaInsets();
  const { width: SCREEN_W } = useWindowDimensions();
  const CARD_W = (SCREEN_W - 36) / 2; // 12px pad + 12px gap + 12px pad

  // ── State ──────────────────────────────────────────────────────────────────
  const [listings, setListings] = useState<NftListing[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [showMyListings, setShowMyListings] = useState(false);
  const [showListSheet, setShowListSheet] = useState(false);
  const [selectedListing, setSelectedListing] = useState<NftListing | null>(null);
  const [detailAction, setDetailAction] = useState<DetailAction>('none');
  const [bidAmount, setBidAmount] = useState('');
  const [swapNft, setSwapNft] = useState<OwnedNFT | null>(null);
  const [swapTopUp, setSwapTopUp] = useState('');
  const [listPrice, setListPrice] = useState('');
  const [listMint, setListMint] = useState<OwnedNFT | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingText, setProcessingText] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingListings, setLoadingListings] = useState(true);

  // ── Fee agreement ────────────────────────────────────────────────────────
  const [showFeeModal, setShowFeeModal] = useState(false);
  const [feeAccepted, setFeeAccepted] = useState(false);

  // ── Trait filter state ────────────────────────────────────────────────────
  const [traitTypes, setTraitTypes] = useState<string[]>([]);
  const [expandedTrait, setExpandedTrait] = useState<string | null>(null);
  const [selectedTraits, setSelectedTraits] = useState<Map<string, Set<string>>>(new Map());
  const [traitFloorsLoaded, setTraitFloorsLoaded] = useState(false);
  const [listTopTrait, setListTopTrait] = useState<{ name: string; value: string; floor: number } | null>(null);

  // ── Magic Eden collection floor ─────────────────────────────────────────
  const [meFloor, setMeFloor] = useState<number | null>(null);

  // Pending atomic swap (buyer flow — driven by appStore)
  const pendingSwap = useAppStore(s => s.pendingNftSwap);
  const setPendingSwap = useAppStore(s => s.setPendingNftSwap);

  const myInboxId = useAppStore(s => s.myInboxId);
  const allNfts = useAppStore(s => s.allNfts);
  const setAllNfts = useAppStore(s => s.setAllNfts);
  const username = useAppStore(s => s.username);
  const wallet = useAppStore(s => s.wallet);
  const isGuest = useAppStore(s => s.isGuest);

  // ── Load ───────────────────────────────────────────────────────────────────
  const refresh = useCallback(() => {
    setListings(getActiveListings());
  }, []);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    setLoadingListings(true);
    try {
      await loadListings();
      refresh();
    } catch (e: any) {
      setLoadError(e?.message ?? 'Failed to load listings');
    } finally {
      setLoadingListings(false);
    }
    fetchTraitFloors().then(() => {
      setTraitTypes(getTraitTypes());
      setTraitFloorsLoaded(true);
    }).catch(() => {});
    hasAcceptedMarketplaceFee().then(setFeeAccepted).catch(() => {});
    fetch('https://api-mainnet.magiceden.dev/v2/collections/sagamonkes/stats')
      .then(r => r.json())
      .then(d => { if (d?.floorPrice) setMeFloor(d.floorPrice / 1e9); })
      .catch(() => {});
  }, [refresh]);

  useEffect(() => { loadAll(); }, [myInboxId]);

  useEffect(() => {
    if (!wallet?.address || allNfts.length > 1) return;
    verifyNFTOwnership(wallet.address).then((r) => {
      if (r.verified && r.allNfts) setAllNfts(r.allNfts);
    }).catch(() => {});
  }, [wallet?.address]);

  const toggleTraitValue = useCallback((traitType: string, value: string) => {
    setSelectedTraits(prev => {
      const next = new Map(prev);
      const vals = new Set(next.get(traitType) ?? []);
      if (vals.has(value)) vals.delete(value);
      else vals.add(value);
      if (vals.size === 0) next.delete(traitType);
      else next.set(traitType, vals);
      return next;
    });
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    selectedTraits.forEach(vals => { count += vals.size; });
    return count;
  }, [selectedTraits]);

  // ── Sort & filter ──────────────────────────────────────────────────────────
  const displayListings = useMemo(() => {
    let items = showMyListings && myInboxId
      ? getMyListings(myInboxId)
      : listings;

    // Apply trait filters
    if (selectedTraits.size > 0) {
      items = items.filter(item => {
        if (!item.traits?.length) return false;
        for (const [traitType, values] of selectedTraits) {
          const match = item.traits?.some(
            t => t.trait_type === traitType && values.has(t.value),
          ) ?? false;
          if (!match) return false;
        }
        return true;
      });
    }

    if (sortBy === 'low') items = [...items].sort((a, b) => a.askPrice - b.askPrice);
    else if (sortBy === 'high') items = [...items].sort((a, b) => b.askPrice - a.askPrice);
    return items;
  }, [listings, sortBy, showMyListings, myInboxId, selectedTraits]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleList = useCallback(async () => {
    if (!listMint || !myInboxId || !wallet) return;
    const price = parseFloat(listPrice);
    if (isNaN(price) || price <= 0) {
      Alert.alert('Invalid Price', 'Enter a valid SOL amount.');
      return;
    }
    setIsProcessing(true);
    setProcessingText('Verifying ownership...');
    try {
      const isOwner = await verifyCurrentOwner(listMint.mint, wallet.address);
      if (!isOwner) {
        Alert.alert('Not Owned', 'You no longer own this NFT.');
        return;
      }
      const msg = buildListMessage({
        mint: listMint.mint,
        name: listMint.name,
        image: listMint.image,
        sellerInboxId: myInboxId,
        sellerUsername: username ?? undefined,
        sellerWallet: wallet.address,
        askPrice: price,
        traits: listMint.traits,
      });
      await sendRawToGroup(msg);
      // Add listing locally immediately (stream may skip own messages)
      addListing({
        id: `${listMint.mint}-${Date.now()}`,
        mint: listMint.mint,
        name: listMint.name,
        image: listMint.image,
        sellerInboxId: myInboxId,
        sellerUsername: username ?? undefined,
        sellerWallet: wallet.address,
        askPrice: price,
        traits: listMint.traits,
        listedAt: new Date().toISOString(),
      });
      Alert.alert('Listed', `${listMint.name} listed for ${price} SOL`);
      setListPrice('');
      setListMint(null);
      setShowListSheet(false);
      refresh();
    } catch {
      Alert.alert('Error', 'Failed to list NFT.');
    } finally {
      setIsProcessing(false);
      setProcessingText('');
    }
  }, [listMint, listPrice, myInboxId, username, wallet, refresh]);

  const handleBuyNow = useCallback(async (listing: NftListing) => {
    if (!wallet || !myInboxId) return;
    if (listing.sellerInboxId === myInboxId) {
      Alert.alert('Error', "You can't buy your own listing.");
      return;
    }
    Alert.alert(
      'Buy Now',
      `Purchase ${listing.name} for ${listing.askPrice} SOL?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Pay ${listing.askPrice} SOL`,
          onPress: async () => {
            setIsProcessing(true);
            setProcessingText('Verifying ownership...');
            try {
              const isOwner = await verifyCurrentOwner(listing.mint, listing.sellerWallet);
              if (!isOwner) {
                Alert.alert('Error', 'Seller no longer owns this NFT.');
                return;
              }
              // Send a bid at ask price — triggers normal swap flow
              const msg = buildBidMessage({
                listingId: listing.id,
                bidderInboxId: myInboxId,
                bidderUsername: username ?? undefined,
                bidderWallet: wallet.address,
                bidPrice: listing.askPrice,
              }, { sellerInboxId: listing.sellerInboxId, listingName: listing.name });
              await sendRawToGroup(msg);
              Alert.alert('Offer Sent', `Your purchase offer for ${listing.askPrice} SOL has been sent. The seller will be notified by the bot.`);
              setSelectedListing(null);
              refresh();
            } catch {
              Alert.alert('Error', 'Failed to send purchase offer.');
            } finally {
              setIsProcessing(false);
              setProcessingText('');
            }
          },
        },
      ],
    );
  }, [wallet, myInboxId, username, refresh]);

  const handlePlaceBid = useCallback(async (listing: NftListing) => {
    const price = parseFloat(bidAmount);
    if (isNaN(price) || price <= 0) {
      Alert.alert('Invalid Bid', 'Enter a valid SOL amount.');
      return;
    }
    if (!myInboxId || !wallet) return;
    try {
      const msg = buildBidMessage({
        listingId: listing.id,
        bidderInboxId: myInboxId,
        bidderUsername: username ?? undefined,
        bidderWallet: wallet.address,
        bidPrice: price,
      }, { sellerInboxId: listing.sellerInboxId, listingName: listing.name });
      await sendRawToGroup(msg);
      Alert.alert('Bid Sent', `Your bid of ${price} SOL has been sent. The seller will be notified.`);
      setBidAmount('');
      setDetailAction('none');
    } catch {
      Alert.alert('Error', 'Failed to place bid.');
    }
  }, [bidAmount, myInboxId, username, wallet]);

  const handleOfferSwap = useCallback(async (listing: NftListing) => {
    if (!swapNft || !myInboxId || !wallet) return;
    if (listing.sellerInboxId === myInboxId) return;
    try {
      const msg = buildOfferMessage({
        listingId: listing.id,
        offererInboxId: myInboxId,
        offererUsername: username ?? undefined,
        offererWallet: wallet.address,
        offeredMint: swapNft.mint,
        offeredName: swapNft.name,
        offeredImage: swapNft.image,
        solTopUp: parseFloat(swapTopUp) || undefined,
      }, { sellerInboxId: listing.sellerInboxId, listingName: listing.name });
      await sendRawToGroup(msg);
      const topUp = parseFloat(swapTopUp);
      const extra = topUp > 0 ? ` + ${topUp} SOL` : '';
      Alert.alert('Swap Offered', `You offered ${swapNft.name}${extra} for ${listing.name}. The seller will be notified.`);
      setSwapNft(null);
      setSwapTopUp('');
      setDetailAction('none');
    } catch {
      Alert.alert('Error', 'Failed to send swap offer.');
    }
  }, [swapNft, swapTopUp, myInboxId, username, wallet]);

  const handleAcceptBid = useCallback(async (listing: NftListing, bid: NftBid) => {
    if (!wallet || !myInboxId) return;
    Alert.alert(
      'Accept Bid',
      `Accept ${bid.bidderUsername ?? 'anon'}'s bid of ${bid.bidPrice} SOL?\n\nYour wallet will open to sign the swap.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept & Sign',
          onPress: async () => {
            setIsProcessing(true);
            setProcessingText('Verifying ownership...');
            try {
              const isOwner = await verifyCurrentOwner(listing.mint, wallet.address);
              if (!isOwner) {
                Alert.alert('Error', 'You no longer own this NFT.');
                return;
              }
              markPendingSwap(listing.id, bid);
              await sendRawToGroup(buildAcceptMessage(listing.id, bid.bidderInboxId));
              refresh();

              setProcessingText('Sign in your wallet...');
              const serializedTx = await sellerSignSwap({
                nftMint: listing.mint,
                sellerWallet: wallet.address,
                buyerWallet: bid.bidderWallet,
                solPrice: bid.bidPrice,
              });

              const swapMsg: NftSwapMessage = {
                listingId: listing.id,
                sellerInboxId: myInboxId,
                buyerInboxId: bid.bidderInboxId,
                mint: listing.mint,
                solPrice: bid.bidPrice,
                sellerWallet: wallet.address,
                buyerWallet: bid.bidderWallet,
                serializedTx,
                createdAt: Date.now(),
              };
              await sendRawToGroup(buildSwapMessage(swapMsg));

              Alert.alert('Swap Sent', `Waiting for ${bid.bidderUsername ?? 'buyer'} to complete. Expires in ~90s.`);
              setSelectedListing(null);
              refresh();
            } catch (err) {
              revertPendingSwap(listing.id);
              refresh();
              Alert.alert('Swap Failed', err instanceof Error ? err.message : 'Unknown error');
            } finally {
              setIsProcessing(false);
              setProcessingText('');
            }
          },
        },
      ],
    );
  }, [wallet, myInboxId, refresh]);

  const handleCompleteSwap = useCallback(async (swap: NftSwapMessage) => {
    if (!wallet || !myInboxId) return;
    setIsProcessing(true);
    setProcessingText('Validating transaction...');
    try {
      const validation = validateSwapTransaction(
        swap.serializedTx, swap.mint, swap.solPrice, swap.sellerWallet, wallet.address,
      );
      if (!validation.valid) {
        Alert.alert('Security Error', `Validation failed: ${validation.reason}`);
        return;
      }
      setProcessingText('Verifying ownership...');
      const sellerOwns = await verifyCurrentOwner(swap.mint, swap.sellerWallet);
      if (!sellerOwns) {
        Alert.alert('Error', 'Seller no longer owns this NFT.');
        return;
      }
      setProcessingText('Sign in your wallet...');
      const signature = await buyerCompleteSwap(swap.serializedTx, swap.mint, swap.solPrice, swap.sellerWallet);
      markSold(swap.listingId);
      const listing = getListingById(swap.listingId);
      await sendRawToGroup(buildCompleteMessage({
        listingId: swap.listingId,
        signature,
        mint: swap.mint,
        solPrice: swap.solPrice,
        sellerInboxId: swap.sellerInboxId,
        sellerUsername: listing?.sellerUsername,
        buyerInboxId: myInboxId,
        buyerUsername: username ?? undefined,
        nftName: listing?.name,
        nftImage: listing?.image,
        completedAt: Date.now(),
      }));
      Alert.alert('Purchase Complete!', `You bought ${listing?.name ?? 'NFT'} for ${swap.solPrice} SOL\n\nTx: ${signature.slice(0, 12)}...`);
      setPendingSwap(null);
      refresh();
    } catch (err) {
      Alert.alert('Swap Failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsProcessing(false);
      setProcessingText('');
    }
  }, [wallet, myInboxId, username, refresh, setPendingSwap]);

  const handleDelist = useCallback((listing: NftListing) => {
    Alert.alert('Remove Listing', `Delist ${listing.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delist',
        style: 'destructive',
        onPress: () => {
          delistNft(listing.id);
          sendRawToGroup(buildDelistMessage(listing.id)).catch(() => {});
          setSelectedListing(null);
          refresh();
        },
      },
    ]);
  }, [refresh]);

  // ── NFT Card (2-column grid) ───────────────────────────────────────────────
  const renderCard = useCallback(({ item }: { item: NftListing }) => {
    const isPending = item.status === 'pending_swap';
    const isSold = item.status === 'sold';
    const isMine = item.sellerInboxId === myInboxId;
    return (
      <Pressable
        style={[s.card, { width: CARD_W }, isPending && s.cardPending, isSold && s.cardSold]}
        onPress={() => { setSelectedListing(item); setDetailAction('none'); }}
        disabled={isSold}
      >
        {/* NFT Image — square */}
        {item.image ? (
          <Image source={{ uri: item.image }} style={[s.cardImg, { width: CARD_W, height: CARD_W }]} />
        ) : (
          <View style={[s.cardImg, s.cardImgFallback, { width: CARD_W, height: CARD_W }]}>
            <Text style={{ fontSize: 48 }}>🐒</Text>
          </View>
        )}
        {/* Info */}
        <View style={s.cardBody}>
          <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>
          <Text style={s.cardSeller} numberOfLines={1}>
            {isMine ? 'Your listing' : item.sellerUsername ?? 'anon'}
          </Text>
          <View style={s.cardPriceRow}>
            <Text style={s.cardPrice}>{item.askPrice}</Text>
            <Text style={s.cardSol}> SOL</Text>
          </View>
          {isPending && <Text style={s.cardPendingLabel}>Swap pending...</Text>}
          {isSold && <Text style={s.cardSoldLabel}>SOLD</Text>}
        </View>
      </Pressable>
    );
  }, [CARD_W, myInboxId]);

  // ── Seller's bid view (only in detail modal for own listings) ──────────────
  const renderSellerBids = useCallback((listing: NftListing) => {
    const bids = getBidsForListing(listing.id);
    if (bids.length === 0) return <Text style={s.noBids}>No offers yet</Text>;
    return bids.map((bid, i) => (
      <View key={i} style={s.bidRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.bidUser}>{bid.bidderUsername ?? bid.bidderInboxId.slice(0, 8)}</Text>
          <Text style={s.bidAmt}>{bid.bidPrice} SOL</Text>
        </View>
        {listing.status === 'active' && (
          <Pressable
            style={s.acceptBtn}
            onPress={() => handleAcceptBid(listing, bid)}
            disabled={isProcessing}
          >
            <Text style={s.acceptBtnText}>Accept</Text>
          </Pressable>
        )}
      </View>
    ));
  }, [handleAcceptBid, isProcessing]);

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <Pressable onPress={() => {
          if (isGuest) { useAppStore.getState().setIsGuest(false); router.replace('/'); }
          else router.back();
        }} style={s.backBtn} hitSlop={8}>
          <Text style={s.backIcon}>{"\u2039"}</Text>
        </Pressable>
        <ImageBackground
          source={require("../../assets/Markets.png")}
          style={[s.headerCenter, { transform: [{ scale: 2.28 }] }]}
          resizeMode="contain"
        />
        <View style={s.headerRight} />
      </View>

      {/* ── Toolbar: sort + filters + list button ───────────────────────────── */}
      <View style={s.toolbar}>
        <View style={s.sortRow}>
          {([['recent', 'Recent'], ['low', 'Low'], ['high', 'High']] as [SortKey, string][]).map(([key, label]) => (
            <Pressable
              key={key}
              style={[s.sortPill, sortBy === key && s.sortPillActive]}
              onPress={() => setSortBy(key)}
            >
              <Text style={[s.sortText, sortBy === key && s.sortTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {!isGuest && (
          <View style={s.toolbarRight}>
            <Pressable
              style={[s.myListingsBtn, showMyListings && s.myListingsBtnActive]}
              onPress={() => { setShowMyListings(!showMyListings); refresh(); }}
            >
              <Text style={[s.myListingsText, showMyListings && s.myListingsTextActive]}>
                Mine
              </Text>
            </Pressable>
            <Pressable
              style={s.listNftBtn}
              onPress={() => {
                if (feeAccepted) setShowListSheet(true);
                else setShowFeeModal(true);
              }}
            >
              <Text style={s.listNftBtnText}>+ List</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* ── Trait filter tabs ─────────────────────────────────────────────── */}
      {traitTypes.length > 0 && (
        <View style={s.traitSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.traitTabsRow}>
            {activeFilterCount > 0 && (
              <Pressable
                style={s.traitClearPill}
                onPress={() => { setSelectedTraits(new Map()); setExpandedTrait(null); }}
              >
                <Text style={s.traitClearText}>Clear ({activeFilterCount})</Text>
              </Pressable>
            )}
            {traitTypes.map(type => {
              const isExpanded = expandedTrait === type;
              const hasSelected = selectedTraits.has(type);
              return (
                <Pressable
                  key={type}
                  style={[s.traitTypePill, (isExpanded || hasSelected) && s.traitTypePillActive]}
                  onPress={() => setExpandedTrait(isExpanded ? null : type)}
                >
                  <Text style={[s.traitTypeText, (isExpanded || hasSelected) && s.traitTypeTextActive]}>
                    {type}{hasSelected ? ` (${selectedTraits.get(type)!.size})` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {expandedTrait && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.traitValuesRow}>
              {getTraitValues(expandedTrait).map(val => {
                const isSelected = selectedTraits.get(expandedTrait)?.has(val) ?? false;
                return (
                  <Pressable
                    key={val}
                    style={[s.traitValPill, isSelected && s.traitValPillActive]}
                    onPress={() => toggleTraitValue(expandedTrait, val)}
                  >
                    <Text style={[s.traitValText, isSelected && s.traitValTextActive]}>{val}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}

      {/* ── Stats bar ───────────────────────────────────────────────────────── */}
      <View style={s.statsBar}>
        <View style={s.statItem}>
          <Text style={s.statLabel}>Listed</Text>
          <Text style={s.statValue}>{listings.filter(l => l.status === 'active').length}</Text>
        </View>
        <View style={s.statItem}>
          <Text style={s.statLabel}>Floor</Text>
          <Text style={s.statValue}>
            {meFloor !== null ? meFloor.toFixed(2) : '—'} SOL
          </Text>
        </View>
      </View>

      {/* ── Grid ────────────────────────────────────────────────────────────── */}
      <FlatList
        data={displayListings}
        renderItem={renderCard}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={s.gridRow}
        contentContainerStyle={s.grid}
        removeClippedSubviews
        maxToRenderPerBatch={20}
        windowSize={10}
        ListEmptyComponent={
          <View style={s.emptyWrap}>
            {loadingListings ? (
              <>
                <ActivityIndicator size="large" color={ACCENT} />
                <Text style={s.emptyText}>Loading marketplace...</Text>
              </>
            ) : loadError ? (
              <>
                <Text style={{ fontSize: 48, marginBottom: 8 }}>⚠️</Text>
                <Text style={s.emptyText}>{loadError}</Text>
                <Pressable style={s.meLink} onPress={loadAll}>
                  <Text style={s.meLinkText}>Retry</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 48, marginBottom: 8 }}>🐒</Text>
                <Text style={s.emptyText}>
                  {showMyListings
                    ? 'You haven\'t listed any Monkes yet'
                    : isGuest
                      ? 'No Monkes listed right now'
                      : 'No Monkes listed yet.\nBe the first!'}
            </Text>
            {isGuest && (
              <Pressable
                style={s.meLink}
                onPress={() => Linking.openURL(MAGIC_EDEN_URL)}
              >
                <Text style={s.meLinkText}>Buy on Magic Eden →</Text>
              </Pressable>
            )}
              </>
            )}
          </View>
        }
      />

      {/* ── Processing overlay ──────────────────────────────────────────────── */}
      {isProcessing && (
        <View style={s.processingOverlay}>
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={s.processingText}>{processingText}</Text>
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
         NFT DETAIL MODAL
         ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={!!selectedListing}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedListing(null)}
        statusBarTranslucent
      >
        <Pressable style={s.overlay} onPress={() => setSelectedListing(null)} />
        {selectedListing && (() => {
          const isMine = selectedListing.sellerInboxId === myInboxId;
          const isPending = selectedListing.status === 'pending_swap';
          return (
            <View style={s.sheet}>
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Large image */}
                {selectedListing.image ? (
                  <Image source={{ uri: selectedListing.image }} style={s.detailImg} />
                ) : (
                  <View style={[s.detailImg, s.cardImgFallback]}>
                    <Text style={{ fontSize: 64 }}>🐒</Text>
                  </View>
                )}

                {/* Name & seller */}
                <Text style={s.detailName}>{selectedListing.name}</Text>
                <Text style={s.detailSeller}>
                  Listed by {isMine ? 'you' : selectedListing.sellerUsername ?? 'anon'}
                </Text>

                {/* Price */}
                <View style={s.detailPriceRow}>
                  <Text style={s.detailPrice}>{selectedListing.askPrice}</Text>
                  <Text style={s.detailSolLabel}> SOL</Text>
                </View>

                {isPending && (
                  <View style={s.pendingBanner}>
                    <Text style={s.pendingBannerText}>Swap in progress — waiting for buyer</Text>
                  </View>
                )}

                {/* ── Buyer actions ───────────────────────────────────────── */}
                {!isMine && selectedListing.status === 'active' && (
                  <View style={s.actionSection}>
                    {isGuest ? (
                      <>
                        {/* Guest: link to Magic Eden for this specific NFT */}
                        <Pressable
                          style={s.buyNowBtn}
                          onPress={() => Linking.openURL(`https://magiceden.us/item-details/solana/${selectedListing.mint}`)}
                        >
                          <Text style={s.buyNowText}>Buy on Magic Eden — {selectedListing.askPrice} SOL</Text>
                        </Pressable>
                        <Text style={s.guestHint}>
                          Get a Saga Monke to unlock in-app trading, chat, signals & more
                        </Text>
                      </>
                    ) : (
                      <>
                        {/* Buy Now */}
                        <Pressable
                          style={s.buyNowBtn}
                          onPress={() => handleBuyNow(selectedListing)}
                          disabled={isProcessing}
                        >
                          <Text style={s.buyNowText}>Buy Now — {selectedListing.askPrice} SOL</Text>
                        </Pressable>

                        {/* Place Bid / Offer Swap toggles */}
                        <View style={s.altActions}>
                          <Pressable
                            style={[s.altBtn, detailAction === 'bid' && s.altBtnActive]}
                            onPress={() => setDetailAction(detailAction === 'bid' ? 'none' : 'bid')}
                          >
                            <Text style={[s.altBtnText, detailAction === 'bid' && s.altBtnTextActive]}>
                              Place Bid
                            </Text>
                          </Pressable>
                          <Pressable
                            style={[s.altBtn, detailAction === 'swap' && s.altBtnActive]}
                            onPress={() => setDetailAction(detailAction === 'swap' ? 'none' : 'swap')}
                          >
                            <Text style={[s.altBtnText, detailAction === 'swap' && s.altBtnTextActive]}>
                              Monke Swap
                            </Text>
                          </Pressable>
                        </View>
                      </>
                    )}

                    {/* Bid input */}
                    {detailAction === 'bid' && (
                      <View style={s.bidSection}>
                        <TextInput
                          style={s.input}
                          placeholder="Your bid (SOL)"
                          placeholderTextColor={THEME.textMuted}
                          keyboardType="decimal-pad"
                          value={bidAmount}
                          onChangeText={setBidAmount}
                        />
                        <Pressable
                          style={s.submitBtn}
                          onPress={() => handlePlaceBid(selectedListing)}
                        >
                          <Text style={s.submitBtnText}>Send Bid</Text>
                        </Pressable>
                      </View>
                    )}

                    {/* Swap picker */}
                    {detailAction === 'swap' && (
                      <View style={s.swapSection}>
                        <Text style={s.swapLabel}>Offer one of your Monkes:</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.swapScroll}>
                          {allNfts.map((nft) => (
                            <Pressable
                              key={nft.mint}
                              style={[s.swapCard, swapNft?.mint === nft.mint && s.swapCardSelected]}
                              onPress={() => setSwapNft(nft)}
                            >
                              {nft.image ? (
                                <Image source={{ uri: nft.image }} style={s.swapCardImg} />
                              ) : (
                                <View style={[s.swapCardImg, s.cardImgFallback]}>
                                  <Text>🐒</Text>
                                </View>
                              )}
                              <Text style={s.swapCardName} numberOfLines={1}>{nft.name}</Text>
                            </Pressable>
                          ))}
                          {allNfts.length === 0 && (
                            <Text style={s.emptyText}>No Monkes in your wallet</Text>
                          )}
                        </ScrollView>
                        {swapNft && (
                          <>
                            <TextInput
                              style={[s.input, { marginTop: 8 }]}
                              placeholder="Add SOL on top? (optional)"
                              placeholderTextColor={THEME.textMuted}
                              keyboardType="decimal-pad"
                              value={swapTopUp}
                              onChangeText={setSwapTopUp}
                            />
                            <Pressable
                              style={s.submitBtn}
                              onPress={() => handleOfferSwap(selectedListing)}
                            >
                              <Text style={s.submitBtnText}>Send Swap Offer</Text>
                            </Pressable>
                          </>
                        )}
                      </View>
                    )}
                  </View>
                )}

                {/* ── Seller view: bids & offers ─────────────────────────── */}
                {isMine && selectedListing.status === 'active' && (
                  <View style={s.actionSection}>
                    <Text style={s.sectionTitle}>Offers & Bids</Text>
                    {renderSellerBids(selectedListing)}
                    <Pressable
                      style={s.delistBtn}
                      onPress={() => handleDelist(selectedListing)}
                    >
                      <Text style={s.delistBtnText}>Remove Listing</Text>
                    </Pressable>
                  </View>
                )}

                {/* Seller: sold/delisted status */}
                {isMine && selectedListing.status === 'sold' && (
                  <View style={s.statusBanner}>
                    <Text style={s.statusBannerText}>This Monke has been sold</Text>
                  </View>
                )}
                {isMine && selectedListing.status === 'delisted' && (
                  <View style={[s.statusBanner, { borderColor: THEME.textMuted }]}>
                    <Text style={[s.statusBannerText, { color: THEME.textMuted }]}>Delisted</Text>
                  </View>
                )}

                <View style={{ height: 20 }} />
              </ScrollView>
            </View>
          );
        })()}
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
         LIST NFT SHEET
         ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={showListSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowListSheet(false)}
        statusBarTranslucent
      >
        <Pressable style={s.overlay} onPress={() => setShowListSheet(false)} />
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>List a Saga Monke</Text>
          <Text style={s.securityNote}>
            Your NFT stays in your wallet until the atomic swap completes. Both NFT and SOL transfer happen in one transaction. A 2% fee applies to the sale price.
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {allNfts.length === 0 ? (
              <Text style={s.emptyText}>No Saga Monkes found in your wallet.</Text>
            ) : (
              allNfts.map((nft) => (
                <Pressable
                  key={nft.mint}
                  style={[s.listRow, listMint?.mint === nft.mint && s.listRowSelected]}
                  onPress={() => {
                    setListMint(nft);
                    if (traitFloorsLoaded && nft.traits?.length) {
                      const top = getTopTrait(nft.traits);
                      if (top) {
                        setListTopTrait({ name: top.trait.trait_type, value: top.trait.value, floor: top.floor });
                      } else {
                        setListTopTrait(null);
                      }
                    } else {
                      setListTopTrait(null);
                    }
                  }}
                >
                  {nft.image ? (
                    <Image source={{ uri: nft.image }} style={s.listRowImg} />
                  ) : (
                    <View style={[s.listRowImg, s.cardImgFallback]}>
                      <Text>🐒</Text>
                    </View>
                  )}
                  <Text style={s.listRowName} numberOfLines={1}>{nft.name}</Text>
                  {listMint?.mint === nft.mint && <Text style={s.listRowCheck}>✓</Text>}
                </Pressable>
              ))
            )}
            {listMint && (
              <View style={s.listForm}>
                {listTopTrait && (
                  <View style={s.traitFloorHint}>
                    <Text style={s.traitFloorLabel}>
                      Top trait: {listTopTrait.name} — {listTopTrait.value}
                    </Text>
                    <Pressable
                      style={s.traitFloorBtn}
                      onPress={() => setListPrice(listTopTrait.floor.toFixed(2))}
                    >
                      <Text style={s.traitFloorBtnText}>
                        List at {listTopTrait.floor.toFixed(2)} SOL
                      </Text>
                    </Pressable>
                  </View>
                )}
                <TextInput
                  style={s.input}
                  placeholder="Asking price (SOL)"
                  placeholderTextColor={THEME.textMuted}
                  keyboardType="decimal-pad"
                  value={listPrice}
                  onChangeText={setListPrice}
                />
                {listPrice && parseFloat(listPrice) > 0 && (
                  <View style={s.feeBreakdown}>
                    <View style={s.feeBreakdownRow}>
                      <Text style={s.feeBreakdownLabel}>Seller receives</Text>
                      <Text style={s.feeBreakdownValue}>
                        {(parseFloat(listPrice) * (1 - NFT_SALE_FEE_PCT)).toFixed(4)} SOL
                      </Text>
                    </View>
                    <View style={s.feeBreakdownRow}>
                      <Text style={s.feeBreakdownLabel}>Fee ({NFT_SALE_FEE_PCT * 100}%)</Text>
                      <Text style={[s.feeBreakdownValue, { color: THEME.warning }]}>
                        {(parseFloat(listPrice) * NFT_SALE_FEE_PCT).toFixed(4)} SOL
                      </Text>
                    </View>
                  </View>
                )}
                <Pressable
                  style={[s.buyNowBtn, { marginTop: 10 }]}
                  onPress={handleList}
                  disabled={isProcessing}
                >
                  <Text style={s.buyNowText}>
                    {isProcessing ? 'Listing...' : `List ${listMint.name}`}
                  </Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
         BUYER SWAP CONFIRMATION MODAL
         ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={!!pendingSwap}
        transparent
        animationType="slide"
        onRequestClose={() => setPendingSwap(null)}
        statusBarTranslucent
      >
        <Pressable style={s.overlay} onPress={() => setPendingSwap(null)} />
        {pendingSwap && (
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Complete Purchase</Text>
            <Text style={s.detailSeller}>
              The seller signed the swap for {pendingSwap.solPrice} SOL.
            </Text>
            <Text style={s.securityNote}>
              You will receive the NFT and {pendingSwap.solPrice} SOL will be sent to the seller — both in one atomic transaction. Validated: no hidden instructions.
            </Text>
            <View style={s.swapConfirmRow}>
              <Pressable
                style={s.cancelBtn}
                onPress={() => setPendingSwap(null)}
              >
                <Text style={s.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={s.buyNowBtn}
                onPress={() => handleCompleteSwap(pendingSwap)}
                disabled={isProcessing}
              >
                <Text style={s.buyNowText}>
                  {isProcessing ? 'Processing...' : `Pay ${pendingSwap.solPrice} SOL`}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </Modal>

      {/* ── Fee Agreement Modal (one-time) ────────────────────────────────── */}
      <MarketplaceFeeModal
        visible={showFeeModal}
        onAccept={() => {
          acceptMarketplaceFee();
          setFeeAccepted(true);
          setShowFeeModal(false);
          setShowListSheet(true);
        }}
        onDecline={() => setShowFeeModal(false)}
      />

      <View style={{ height: insets.bottom }} />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: THEME.border,
  },
  headerCenter: { flex: 1, alignSelf: 'stretch' },
  backBtn: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  backIcon: { fontSize: 34, color: '#fff', lineHeight: 38 },
  headerRight: { width: 58 },

  // Toolbar
  toolbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: THEME.border,
  },
  sortRow: { flexDirection: 'row', gap: 6 },
  sortPill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
    backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border,
  },
  sortPillActive: { backgroundColor: ACCENT_SOFT, borderColor: ACCENT },
  sortText: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted },
  sortTextActive: { color: ACCENT, fontWeight: '600' },
  toolbarRight: { flexDirection: 'row', gap: 6 },
  myListingsBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
    backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border,
  },
  myListingsBtnActive: { backgroundColor: ACCENT_SOFT, borderColor: ACCENT },
  myListingsText: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted },
  myListingsTextActive: { color: ACCENT, fontWeight: '600' },
  listNftBtn: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14,
    backgroundColor: ACCENT,
  },
  listNftBtnText: { fontFamily: FONTS.mono, fontSize: 10, fontWeight: '700', color: '#fff' },

  // Stats
  statsBar: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: THEME.border, gap: 20,
  },
  statItem: { alignItems: 'center' },
  statLabel: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.textMuted },
  statValue: { fontFamily: FONTS.mono, fontSize: 11, fontWeight: '700', color: THEME.text },

  // Grid
  grid: { padding: 12 },
  gridRow: { justifyContent: 'space-between', marginBottom: 12 },

  // Card
  card: {
    backgroundColor: THEME.surface, borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: THEME.border,
  },
  cardPending: { opacity: 0.5, borderColor: '#f59e0b' },
  cardSold: { opacity: 0.35 },
  cardImg: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  cardImgFallback: { backgroundColor: THEME.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 8 },
  cardName: { fontFamily: FONTS.bodySemi, fontSize: 12, color: THEME.text },
  cardSeller: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.textMuted, marginTop: 1 },
  cardPriceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  cardPrice: { fontFamily: FONTS.display, fontSize: 15, color: '#fff' },
  cardSol: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted },
  cardPendingLabel: { fontFamily: FONTS.mono, fontSize: 9, color: '#f59e0b', marginTop: 3 },
  cardSoldLabel: { fontFamily: FONTS.mono, fontSize: 9, color: GREEN, marginTop: 3 },

  // Empty
  emptyWrap: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted, textAlign: 'center' },
  meLink: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12, backgroundColor: ACCENT_SOFT },
  meLinkText: { fontFamily: FONTS.bodySemi, fontSize: 13, color: ACCENT },
  guestHint: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textMuted, textAlign: 'center', marginTop: 10, lineHeight: 18 },

  // Processing
  processingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  processingText: { fontFamily: FONTS.mono, fontSize: 14, color: '#fff', marginTop: 12 },

  // Modal shared
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: THEME.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 16, maxHeight: '80%',
  },
  sheetTitle: { fontFamily: FONTS.display, fontSize: 18, color: THEME.text, marginBottom: 6 },

  // Detail modal
  detailImg: { width: '100%', aspectRatio: 1, borderRadius: 12, marginBottom: 12 },
  detailName: { fontFamily: FONTS.display, fontSize: 20, color: THEME.text },
  detailSeller: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted, marginTop: 2 },
  detailPriceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 10 },
  detailPrice: { fontFamily: FONTS.display, fontSize: 28, color: '#fff' },
  detailSolLabel: { fontFamily: FONTS.mono, fontSize: 14, color: THEME.textMuted },

  pendingBanner: {
    marginTop: 12, padding: 10, borderRadius: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.12)', borderWidth: 1, borderColor: '#f59e0b',
  },
  pendingBannerText: { fontFamily: FONTS.mono, fontSize: 11, color: '#f59e0b', textAlign: 'center' },

  statusBanner: {
    marginTop: 12, padding: 10, borderRadius: 8,
    backgroundColor: 'rgba(34, 197, 94, 0.1)', borderWidth: 1, borderColor: GREEN,
  },
  statusBannerText: { fontFamily: FONTS.mono, fontSize: 11, color: GREEN, textAlign: 'center' },

  // Buyer actions
  actionSection: { marginTop: 16 },
  buyNowBtn: {
    backgroundColor: ACCENT, borderRadius: 10, paddingVertical: 14, alignItems: 'center',
  },
  buyNowText: { fontFamily: FONTS.bodySemi, fontSize: 15, color: '#fff' },
  altActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  altBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center',
    borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.surfaceHigh,
  },
  altBtnActive: { borderColor: ACCENT, backgroundColor: ACCENT_SOFT },
  altBtnText: { fontFamily: FONTS.mono, fontSize: 12, color: THEME.textMuted },
  altBtnTextActive: { color: ACCENT, fontWeight: '600' },

  // Bid section
  bidSection: { marginTop: 10 },
  input: {
    fontFamily: FONTS.mono, fontSize: 14, color: THEME.text,
    borderWidth: 1, borderColor: THEME.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: THEME.bg,
  },
  submitBtn: {
    backgroundColor: ACCENT, borderRadius: 8, paddingVertical: 10,
    alignItems: 'center', marginTop: 8,
  },
  submitBtnText: { fontFamily: FONTS.bodySemi, fontSize: 13, color: '#fff' },

  // Swap section
  swapSection: { marginTop: 10 },
  swapLabel: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted, marginBottom: 6 },
  swapScroll: { marginBottom: 4 },
  swapCard: {
    width: 80, marginRight: 8, borderRadius: 8, overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent', backgroundColor: THEME.bg,
  },
  swapCardSelected: { borderColor: ACCENT },
  swapCardImg: { width: 80, height: 80 },
  swapCardName: { fontFamily: FONTS.mono, fontSize: 8, color: THEME.text, padding: 4, textAlign: 'center' },

  // Seller bids
  sectionTitle: { fontFamily: FONTS.display, fontSize: 14, color: THEME.text, marginBottom: 8 },
  noBids: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted },
  bidRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: THEME.border,
  },
  bidUser: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.text },
  bidAmt: { fontFamily: FONTS.mono, fontSize: 12, fontWeight: '700', color: ACCENT },
  acceptBtn: {
    backgroundColor: GREEN, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6,
  },
  acceptBtnText: { fontFamily: FONTS.mono, fontSize: 10, fontWeight: '700', color: '#fff' },

  // Delist
  delistBtn: {
    marginTop: 16, paddingVertical: 10, borderRadius: 8, alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  delistBtnText: { fontFamily: FONTS.mono, fontSize: 12, fontWeight: '600', color: '#ef4444' },

  // List sheet
  securityNote: {
    fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, marginBottom: 12, lineHeight: 15,
  },
  listRow: {
    flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 10,
    marginBottom: 6, backgroundColor: THEME.bg, borderWidth: 1, borderColor: THEME.border,
  },
  listRowSelected: { borderColor: ACCENT, backgroundColor: ACCENT_SOFT },
  listRowImg: { width: 44, height: 44, borderRadius: 8 },
  listRowName: { fontFamily: FONTS.mono, fontSize: 12, color: THEME.text, flex: 1, marginLeft: 10 },
  listRowCheck: { fontFamily: FONTS.mono, fontSize: 16, color: ACCENT, marginLeft: 8 },
  listForm: { marginTop: 10 },

  // Swap confirm
  swapConfirmRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  cancelBtnText: { fontFamily: FONTS.mono, fontSize: 13, color: THEME.text },

  // Trait filters
  traitSection: {
    borderBottomWidth: 1, borderBottomColor: THEME.border, paddingVertical: 6,
  },
  traitTabsRow: { paddingHorizontal: 12, gap: 6 },
  traitTypePill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
    backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border,
  },
  traitTypePillActive: { backgroundColor: ACCENT_SOFT, borderColor: ACCENT },
  traitTypeText: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted },
  traitTypeTextActive: { color: ACCENT, fontWeight: '600' },
  traitClearPill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
    backgroundColor: 'rgba(239, 68, 68, 0.12)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  traitClearText: { fontFamily: FONTS.mono, fontSize: 10, color: '#ef4444', fontWeight: '600' },
  traitValuesRow: { paddingHorizontal: 12, paddingTop: 6, gap: 5 },
  traitValPill: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
    backgroundColor: THEME.bg, borderWidth: 1, borderColor: THEME.border,
  },
  traitValPillActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  traitValText: { fontFamily: FONTS.mono, fontSize: 9, color: THEME.textMuted },
  traitValTextActive: { color: '#fff', fontWeight: '600' },

  // Trait floor in list sheet
  traitFloorHint: {
    marginBottom: 10, padding: 10, borderRadius: 8,
    backgroundColor: 'rgba(34, 197, 94, 0.08)', borderWidth: 1, borderColor: 'rgba(34, 197, 94, 0.2)',
  },
  traitFloorLabel: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.textMuted, marginBottom: 6 },
  traitFloorBtn: {
    backgroundColor: GREEN, borderRadius: 8, paddingVertical: 8, alignItems: 'center',
  },
  traitFloorBtnText: { fontFamily: FONTS.bodySemi, fontSize: 13, color: '#fff' },

  // Fee disclosure
  feeDisclosure: {
    marginBottom: 10, padding: 8, borderRadius: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.08)', borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  feeDisclosureText: { fontFamily: FONTS.mono, fontSize: 10, color: THEME.warning, lineHeight: 15 },
  feeBreakdown: { marginTop: 8 },
  feeBreakdownRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3,
  },
  feeBreakdownLabel: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textMuted },
  feeBreakdownValue: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.text, fontWeight: '600' },
});
