/**
 * MarketplaceOnChainTestScreen — Phase 1 devnet-only debug harness for the
 * MonkeMarkets escrow program (program/monkemarkets/, marketplaceProgram.ts).
 *
 * This is deliberately NOT a polished consumer "Buy Now" button wired into
 * the live MarketplaceScreen. Two things block that today: (1) the devnet
 * program deploy itself is still pending faucet funding, so there is
 * nothing on-chain to call yet, and (2) there is no devnet test fixture
 * (collection/tree/SKR mint/minted cNFT) for a real listing to exist
 * against — the mainnet DAS-based metadata reconstruction in
 * marketplaceProgram.ts's fetchListMetadataArgsFromDas is explicitly
 * unverified and devnet has no equivalent indexer at all. Wiring a real
 * button into the production screen against those two unknowns would be
 * unreviewable and untestable busywork.
 *
 * This screen instead exposes the three raw instructions (list/delist/
 * buy_now) with plain text inputs for whatever compression data a devnet
 * fixture script hands you, so a real device (Seeker + Solflare, devnet
 * cluster) can exercise the actual deployed program end-to-end once it's
 * funded and a fixture exists. Delete or fold into the real screen once
 * Phase 2 (mainnet cutover, real Saga Monkes DAS wiring) is underway.
 *
 * Dev-wallet gated — same pattern as other admin-only screens.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { useAppStore } from "@/store/appStore";
import { THEME, FONTS, DEV_ADMIN_WALLET } from "@/lib/constants";
import { showGlassAlert } from "@/lib/glassAlert";
import type { CompressionData } from "@/lib/nftSwap";
import {
  fetchMarketplaceConfig,
  fetchListing,
  getListingPda,
  sellerListNft,
  sellerDelistNft,
  buyerBuyNow,
  type MarketplaceConfig,
  type ListMetadataArgs,
} from "@/lib/marketplaceProgram";

const DEVNET_RPC_URL = "https://api.devnet.solana.com";

function parsePubkey(s: string): PublicKey | null {
  try { return new PublicKey(s.trim()); } catch { return null; }
}
function parseBase58Bytes32(s: string): number[] | null {
  try {
    const b = bs58.decode(s.trim());
    return b.length === 32 ? Array.from(b) : null;
  } catch { return null; }
}
function parseProofList(s: string): PublicKey[] | null {
  const trimmed = s.trim();
  if (!trimmed) return [];
  try {
    return trimmed.split(",").map((p) => new PublicKey(p.trim()));
  } catch { return null; }
}

/** Default metadata for a devnet test leaf — override via the JSON field if your fixture used something else. */
const DEFAULT_TEST_METADATA: ListMetadataArgs = {
  name: "Test Monke",
  symbol: "TMONKE",
  uri: "https://example.com/test-monke.json",
  sellerFeeBasisPoints: 500,
  primarySaleHappened: false,
  isMutable: true,
  editionNonce: null,
  tokenStandard: "NonFungible",
  collection: null,
  uses: null,
  tokenProgramVersion: "Original",
  creators: [],
};

export default function MarketplaceOnChainTestScreen() {
  const insets = useSafeAreaInsets();
  const wallet = useAppStore((s) => s.wallet);
  const isDev = wallet?.address === DEV_ADMIN_WALLET;

  const [connection] = useState(() => new Connection(DEVNET_RPC_URL, "confirmed"));
  const [config, setConfig] = useState<MarketplaceConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Shared compression-data inputs (all three actions need these).
  const [merkleTree, setMerkleTree] = useState("");
  const [leafId, setLeafId] = useState("0");
  const [dataHashB58, setDataHashB58] = useState("");
  const [creatorHashB58, setCreatorHashB58] = useState("");
  const [rootB58, setRootB58] = useState("");
  const [proofCsv, setProofCsv] = useState("");

  // list()-only
  const [price, setPrice] = useState("1");
  const [metadataJson, setMetadataJson] = useState(JSON.stringify(DEFAULT_TEST_METADATA, null, 2));

  const refreshConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      setConfig(await fetchMarketplaceConfig(connection));
    } catch {
      setConfig(null);
    } finally {
      setConfigLoading(false);
    }
  }, [connection]);

  useEffect(() => { if (isDev) refreshConfig(); }, [isDev, refreshConfig]);

  const buildComp = useCallback((): CompressionData | null => {
    const tree = parsePubkey(merkleTree);
    const dataHash = parseBase58Bytes32(dataHashB58);
    const creatorHash = parseBase58Bytes32(creatorHashB58);
    const root = parseBase58Bytes32(rootB58);
    const proof = parseProofList(proofCsv);
    const nonce = Number(leafId);
    if (!tree || !dataHash || !creatorHash || !root || proof === null || !Number.isFinite(nonce)) {
      showGlassAlert("Invalid input", "Check merkle tree / hashes (base58, 32 bytes) / root / proof list / leaf id.");
      return null;
    }
    if (!wallet) return null;
    const walletPk = parsePubkey(wallet.address);
    if (!walletPk) return null;
    return {
      tree, root, dataHash, creatorHash, nonce, index: nonce, proof,
      leafOwner: walletPk, leafDelegate: walletPk,
    };
  }, [merkleTree, dataHashB58, creatorHashB58, rootB58, proofCsv, leafId, wallet]);

  const onList = useCallback(async () => {
    if (!wallet) return;
    const comp = buildComp();
    if (!comp) return;
    let metadataArgs: ListMetadataArgs;
    try {
      metadataArgs = JSON.parse(metadataJson);
    } catch {
      showGlassAlert("Invalid metadata JSON", "Fix the metadata JSON field.");
      return;
    }
    const priceNum = BigInt(Math.round(parseFloat(price) || 0));
    if (priceNum <= 0n) { showGlassAlert("Invalid price", "Price must be > 0 base units."); return; }
    setBusy(true);
    try {
      const sig = await sellerListNft({
        connection, seller: new PublicKey(wallet.address), price: priceNum, comp, metadataArgs,
      });
      showGlassAlert("Listed on-chain", `tx: ${sig.slice(0, 20)}…`);
      refreshConfig();
    } catch (e) {
      showGlassAlert("List failed", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [wallet, buildComp, metadataJson, price, connection, refreshConfig]);

  const onDelist = useCallback(async () => {
    if (!wallet) return;
    const comp = buildComp();
    if (!comp) return;
    setBusy(true);
    try {
      const [listingPda] = getListingPda(comp.tree, comp.nonce);
      const listing = await fetchListing(connection, listingPda);
      if (!listing) { showGlassAlert("No listing found", "Nothing escrowed at this tree/leaf id."); return; }
      const sig = await sellerDelistNft({ connection, seller: new PublicKey(wallet.address), comp, listing });
      showGlassAlert("Delisted", `tx: ${sig.slice(0, 20)}…`);
    } catch (e) {
      showGlassAlert("Delist failed", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [wallet, buildComp, connection]);

  const onBuyNow = useCallback(async () => {
    if (!wallet) return;
    const comp = buildComp();
    if (!comp || !config) { if (!config) showGlassAlert("No config", "Marketplace not initialized on-chain yet."); return; }
    setBusy(true);
    try {
      const [listingPda] = getListingPda(comp.tree, comp.nonce);
      const listing = await fetchListing(connection, listingPda);
      if (!listing) { showGlassAlert("No listing found", "Nothing escrowed at this tree/leaf id."); return; }
      const sig = await buyerBuyNow({ connection, buyer: new PublicKey(wallet.address), comp, listing, config });
      showGlassAlert("Bought on-chain", `tx: ${sig.slice(0, 20)}…`);
    } catch (e) {
      showGlassAlert("Buy failed", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [wallet, buildComp, config, connection]);

  if (!isDev) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <Text style={s.title}>Dev only</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[s.container, { paddingTop: insets.top }]} contentContainerStyle={{ padding: 16 }}>
      <Text style={s.title}>MonkeMarkets — Devnet Escrow Test</Text>
      <Text style={s.note}>
        Program: FZfCbVdH9iY7bQNap1b4do52bhYJmiE8u3VSkxvv8euU (devnet, Phase 0/1 — not audited, not mainnet)
      </Text>

      <View style={s.section}>
        <Text style={s.sectionTitle}>Config</Text>
        {configLoading ? (
          <ActivityIndicator color={THEME.accent} />
        ) : config ? (
          <>
            <Text style={s.mono}>skrMint: {config.skrMint.toBase58()}</Text>
            <Text style={s.mono}>collectionMint: {config.collectionMint.toBase58()}</Text>
            <Text style={s.mono}>vaultSkrAta: {config.vaultSkrAta.toBase58()}</Text>
            <Text style={s.mono}>feeBps: {config.feeBps} paused: {String(config.paused)}</Text>
          </>
        ) : (
          <Text style={s.note}>Not initialized on-chain yet (or program not deployed).</Text>
        )}
        <Pressable style={s.smallBtn} onPress={refreshConfig}><Text style={s.smallBtnText}>Refresh</Text></Pressable>
      </View>

      <View style={s.section}>
        <Text style={s.sectionTitle}>Compression data (shared by all 3 actions)</Text>
        <Field label="Merkle tree (base58)" value={merkleTree} onChangeText={setMerkleTree} />
        <Field label="Leaf id / nonce" value={leafId} onChangeText={setLeafId} keyboardType="number-pad" />
        <Field label="Data hash (base58, 32 bytes)" value={dataHashB58} onChangeText={setDataHashB58} />
        <Field label="Creator hash (base58, 32 bytes)" value={creatorHashB58} onChangeText={setCreatorHashB58} />
        <Field label="Current root (base58, 32 bytes)" value={rootB58} onChangeText={setRootB58} />
        <Field label="Proof accounts (comma-separated base58, empty if full canopy)" value={proofCsv} onChangeText={setProofCsv} />
      </View>

      <View style={s.section}>
        <Text style={s.sectionTitle}>list()</Text>
        <Field label="Price (SKR base units)" value={price} onChangeText={setPrice} keyboardType="number-pad" />
        <Field label="Metadata JSON" value={metadataJson} onChangeText={setMetadataJson} multiline />
        <ActionButton label="List (escrow)" busy={busy} onPress={onList} />
      </View>

      <View style={s.section}>
        <Text style={s.sectionTitle}>buy_now()</Text>
        <ActionButton label="Buy Now" busy={busy} onPress={onBuyNow} />
      </View>

      <View style={s.section}>
        <Text style={s.sectionTitle}>delist()</Text>
        <ActionButton label="Delist" busy={busy} onPress={onDelist} />
      </View>
    </ScrollView>
  );
}

function Field(props: {
  label: string; value: string; onChangeText: (v: string) => void;
  keyboardType?: "default" | "number-pad"; multiline?: boolean;
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={s.fieldLabel}>{props.label}</Text>
      <TextInput
        style={[s.input, props.multiline && { height: 140, textAlignVertical: "top" }]}
        value={props.value}
        onChangeText={props.onChangeText}
        keyboardType={props.keyboardType}
        multiline={props.multiline}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function ActionButton(props: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[s.actionBtn, props.busy && { opacity: 0.6 }]}
      onPress={props.onPress}
      disabled={props.busy}
    >
      {props.busy ? <ActivityIndicator color="#fff" /> : <Text style={s.actionBtnText}>{props.label}</Text>}
    </Pressable>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg },
  title: { fontFamily: FONTS.display, fontSize: 18, color: THEME.text, marginBottom: 4 },
  note: { fontFamily: FONTS.body, fontSize: 12, color: THEME.textDim, marginBottom: 16 },
  section: { marginBottom: 24, borderTopWidth: 1, borderTopColor: THEME.border, paddingTop: 12 },
  sectionTitle: { fontFamily: FONTS.bodySemi, fontSize: 14, color: THEME.text, marginBottom: 8 },
  mono: { fontFamily: FONTS.mono, fontSize: 11, color: THEME.textDim, marginBottom: 2 },
  fieldLabel: { fontFamily: FONTS.body, fontSize: 11, color: THEME.textDim, marginBottom: 4 },
  input: {
    fontFamily: FONTS.mono, fontSize: 12, color: THEME.text, backgroundColor: THEME.surface,
    borderRadius: 8, borderWidth: 1, borderColor: THEME.border, padding: 10,
  },
  smallBtn: { alignSelf: "flex-start", marginTop: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: THEME.surface },
  smallBtnText: { fontFamily: FONTS.bodySemi, fontSize: 12, color: THEME.accent },
  actionBtn: { backgroundColor: THEME.accent, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  actionBtnText: { fontFamily: FONTS.bodySemi, fontSize: 14, color: "#fff" },
});
