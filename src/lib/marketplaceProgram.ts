/**
 * marketplaceProgram.ts — client for the MonkeMarkets on-chain escrow
 * program (Phase 1 of the SKR cNFT marketplace redesign; program source +
 * test suite in program/monkemarkets/, 8/8 tests passing on a local
 * validator cloning the real Bubblegum/Compression/Noop/Token-Metadata
 * programs from mainnet-beta).
 *
 * Replaces List/Delist/Buy-Now from the legacy two-party XMTP handshake
 * (nftSwap.ts) with real on-chain escrow: `list` moves the leaf to a
 * program-owned PDA immediately, `buyNow` is a single buyer-signed
 * instruction (no seller-online requirement, no serialized-tx DM round
 * trip, no 90s blockhash race), `delist` reclaims it. Bids/offers/accept
 * stay entirely on the legacy nftSwap.ts path — out of scope here.
 *
 * DEVNET PROOF-OF-CONCEPT ONLY as of this writing. MARKETPLACE_PROGRAM_ID
 * below is the Phase 0 devnet deploy — not audited, not deployed to
 * mainnet, and NOT necessarily the address a real mainnet deploy will use
 * (mainnet needs its own deliberate program-keypair + upgrade-authority
 * decision — see the Phase 0 design doc's threat list). Do not wire this
 * into a live mainnet flow without that decision being made explicitly.
 *
 * This file hand-builds every instruction with raw @solana/web3.js + the
 * small Borsh writer below, matching this codebase's existing pattern in
 * nftSwap.ts (no @coral-xyz/anchor runtime dependency, avoiding a heavy
 * new dependency for something this codebase already does by hand).
 * Anchor's instruction-dispatch discriminator is deterministic —
 * sha256("global:<snake_case_ix_name>").slice(0, 8) — computed at runtime
 * below rather than hardcoded, and account order/signer/writable flags
 * were transcribed directly from the program's own #[derive(Accounts)]
 * structs (program/monkemarkets/programs/monkemarkets/src/lib.rs), not
 * assumed. Cross-check both against the program's generated IDL before
 * shipping — see the "known gaps" note at the bottom of this file.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  type AccountMeta,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID,
} from "@metaplex-foundation/mpl-bubblegum";
import { SPL_NOOP_PROGRAM_ID, SPL_ACCOUNT_COMPRESSION_PROGRAM_ID } from "@solana/spl-account-compression";
import { sha256 } from "@noble/hashes/sha2";
import {
  transact,
  Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { fetchCompressionData, type CompressionData } from "./nftSwap";
import { useAppStore } from "@/store/appStore";
import { assertDeviceTrusted } from "./security";

/**
 * Phase 0 devnet deploy. See module doc above — this is a scratch program
 * keypair from the Phase 0 sandbox, not a permanent address. Re-derive from
 * program/monkemarkets/Anchor.toml's [programs.localnet] entry if this
 * drifts, or replace once a real devnet/mainnet deploy exists.
 */
export const MARKETPLACE_PROGRAM_ID = new PublicKey(
  "FZfCbVdH9iY7bQNap1b4do52bhYJmiE8u3VSkxvv8euU",
);

const MARKETPLACE_SEED = Buffer.from("marketplace");
const LISTING_SEED = Buffer.from("listing");

// ─── Anchor discriminators ───────────────────────────────────────────────

function ixDiscriminator(name: string): Buffer {
  return Buffer.from(sha256(`global:${name}`)).subarray(0, 8);
}

// ─── Minimal Borsh writer (Anchor's wire format: strings/Vec are u32-LE
// length-prefixed, Option is a 1-byte tag, unit enums are a 1-byte variant
// index in declaration order, fixed byte arrays have no length prefix) ────

class BorshWriter {
  private parts: Buffer[] = [];
  u8(v: number): this { this.parts.push(Buffer.from([v & 0xff])); return this; }
  bool(v: boolean): this { return this.u8(v ? 1 : 0); }
  u16(v: number): this { const b = Buffer.alloc(2); b.writeUInt16LE(v); this.parts.push(b); return this; }
  u32(v: number): this { const b = Buffer.alloc(4); b.writeUInt32LE(v); this.parts.push(b); return this; }
  u64(v: bigint | number): this { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); this.parts.push(b); return this; }
  fixedBytes(v: number[] | Uint8Array): this { this.parts.push(Buffer.from(v)); return this; }
  pubkey(v: PublicKey): this { this.parts.push(Buffer.from(v.toBytes())); return this; }
  string(v: string): this {
    const utf8 = Buffer.from(v, "utf8");
    this.u32(utf8.length);
    this.parts.push(utf8);
    return this;
  }
  option<T>(v: T | null | undefined, write: (w: BorshWriter, val: T) => void): this {
    if (v === null || v === undefined) { this.u8(0); } else { this.u8(1); write(this, v); }
    return this;
  }
  vec<T>(arr: T[], write: (w: BorshWriter, val: T) => void): this {
    this.u32(arr.length);
    for (const item of arr) write(this, item);
    return this;
  }
  finish(): Buffer { return Buffer.concat(this.parts); }
}

// ─── PDAs ─────────────────────────────────────────────────────────────────

export function getMarketplaceConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([MARKETPLACE_SEED], MARKETPLACE_PROGRAM_ID);
}

export function getListingPda(merkleTree: PublicKey, leafId: bigint | number): [PublicKey, number] {
  const nonceBytes = Buffer.alloc(8);
  nonceBytes.writeBigUInt64LE(BigInt(leafId));
  return PublicKey.findProgramAddressSync(
    [LISTING_SEED, merkleTree.toBuffer(), nonceBytes],
    MARKETPLACE_PROGRAM_ID,
  );
}

function getBubblegumTreeAuthority(merkleTree: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([merkleTree.toBuffer()], BUBBLEGUM_PROGRAM_ID)[0];
}

// ─── Account decoding ───────────────────────────────────────────────────

export interface MarketplaceConfig {
  authority: PublicKey;
  skrMint: PublicKey;
  collectionMint: PublicKey;
  vaultSkrAta: PublicKey;
  feeBps: number;
  paused: boolean;
  bump: number;
}

export async function fetchMarketplaceConfig(connection: Connection): Promise<MarketplaceConfig | null> {
  const [pda] = getMarketplaceConfigPda();
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  const d = info.data;
  let o = 8; // skip account discriminator
  const readPk = () => { const pk = new PublicKey(d.subarray(o, o + 32)); o += 32; return pk; };
  const authority = readPk();
  const skrMint = readPk();
  const collectionMint = readPk();
  const vaultSkrAta = readPk();
  const feeBps = d.readUInt16LE(o); o += 2;
  const paused = d[o] === 1; o += 1;
  const bump = d[o];
  return { authority, skrMint, collectionMint, vaultSkrAta, feeBps, paused, bump };
}

export interface Listing {
  seller: PublicKey;
  merkleTree: PublicKey;
  leafId: bigint;
  dataHash: number[];
  creatorHash: number[];
  price: bigint;
  listedAt: bigint;
  bump: number;
}

export async function fetchListing(connection: Connection, listingPda: PublicKey): Promise<Listing | null> {
  const info = await connection.getAccountInfo(listingPda);
  if (!info) return null;
  const d = info.data;
  let o = 8;
  const seller = new PublicKey(d.subarray(o, o + 32)); o += 32;
  const merkleTree = new PublicKey(d.subarray(o, o + 32)); o += 32;
  const leafId = d.readBigUInt64LE(o); o += 8;
  const dataHash = Array.from(d.subarray(o, o + 32)); o += 32;
  const creatorHash = Array.from(d.subarray(o, o + 32)); o += 32;
  const price = d.readBigUInt64LE(o); o += 8;
  const listedAt = d.readBigInt64LE(o); o += 8;
  const bump = d[o];
  return { seller, merkleTree, leafId, dataHash, creatorHash, price, listedAt, bump };
}

// ─── list() metadata args ───────────────────────────────────────────────
//
// Mirrors program/monkemarkets's ListMetadataArgs (Rust) field-for-field —
// field order is load-bearing for Borsh, do not reorder without also
// reordering the Rust struct.

export type TokenStandard = "NonFungible" | "FungibleAsset" | "Fungible" | "NonFungibleEdition";
export type TokenProgramVersion = "Original" | "Token2022";
export type UseMethod = "Burn" | "Multiple" | "Single";

const TOKEN_STANDARD_INDEX: Record<TokenStandard, number> = {
  NonFungible: 0, FungibleAsset: 1, Fungible: 2, NonFungibleEdition: 3,
};
const TOKEN_PROGRAM_VERSION_INDEX: Record<TokenProgramVersion, number> = { Original: 0, Token2022: 1 };
const USE_METHOD_INDEX: Record<UseMethod, number> = { Burn: 0, Multiple: 1, Single: 2 };

export interface ListCreator {
  address: PublicKey;
  verified: boolean;
  share: number;
}

export interface ListMetadataArgs {
  name: string;
  symbol: string;
  uri: string;
  sellerFeeBasisPoints: number;
  primarySaleHappened: boolean;
  isMutable: boolean;
  editionNonce: number | null;
  tokenStandard: TokenStandard | null;
  collection: { verified: boolean; key: PublicKey } | null;
  uses: { useMethod: UseMethod; remaining: bigint; total: bigint } | null;
  tokenProgramVersion: TokenProgramVersion;
  creators: ListCreator[];
}

function writeMetadataArgs(w: BorshWriter, m: ListMetadataArgs): void {
  w.string(m.name).string(m.symbol).string(m.uri);
  w.u16(m.sellerFeeBasisPoints).bool(m.primarySaleHappened).bool(m.isMutable);
  w.option(m.editionNonce, (ww, v) => ww.u8(v));
  w.option(m.tokenStandard, (ww, v) => ww.u8(TOKEN_STANDARD_INDEX[v]));
  w.option(m.collection, (ww, v) => { ww.bool(v.verified); ww.pubkey(v.key); });
  w.option(m.uses, (ww, v) => { ww.u8(USE_METHOD_INDEX[v.useMethod]); ww.u64(v.remaining); ww.u64(v.total); });
  w.u8(TOKEN_PROGRAM_VERSION_INDEX[m.tokenProgramVersion]);
  w.vec(m.creators, (ww, c) => { ww.pubkey(c.address); ww.bool(c.verified); ww.u8(c.share); });
}

/**
 * Best-effort reconstruction of ListMetadataArgs from Helius DAS's
 * normalized getAsset response. UNVERIFIED — this is the single highest
 * remaining integration risk in Phase 1: DAS normalizes metadata for
 * display and does not guarantee its fields round-trip byte-for-byte into
 * the exact struct that was hashed at mint time. A wrong reconstruction
 * fails CLOSED (the program's hash_metadata check / Bubblegum's own leaf
 * verification rejects it, the transaction just reverts — it cannot cause
 * a fund-loss or wrong-transfer bug), but it can still block a real list()
 * from working. MUST be verified against a real minted test asset (compare
 * the hash this function would produce against the asset's actual
 * on-chain data_hash) before this is trusted for a live device test.
 */
export async function fetchListMetadataArgsFromDas(
  heliusRpcUrl: string,
  assetId: string,
): Promise<ListMetadataArgs> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let asset: any;
  try {
    const res = await fetch(heliusRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: "list-meta", method: "getAsset", params: { id: assetId } }),
    });
    if (!res.ok) throw new Error(`getAsset HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message ?? "getAsset error");
    asset = json.result;
  } finally {
    clearTimeout(timer);
  }

  const collectionGroup = (asset.grouping ?? []).find((g: any) => g.group_key === "collection");
  const creators: ListCreator[] = (asset.creators ?? []).map((c: any) => ({
    address: new PublicKey(c.address),
    verified: !!c.verified,
    share: c.share ?? 0,
  }));

  return {
    name: asset.content?.metadata?.name ?? "",
    symbol: asset.content?.metadata?.symbol ?? "",
    uri: asset.content?.json_uri ?? "",
    sellerFeeBasisPoints: asset.royalty?.basis_points ?? 0,
    primarySaleHappened: !!asset.royalty?.primary_sale_happened,
    isMutable: asset.mutable ?? true,
    editionNonce: null,
    tokenStandard: "NonFungible",
    collection: collectionGroup
      ? { verified: collectionGroup.verified ?? true, key: new PublicKey(collectionGroup.group_value) }
      : null,
    uses: null,
    tokenProgramVersion: "Original",
    creators,
  };
}

// ─── Instruction builders ───────────────────────────────────────────────

function proofAccountMetas(comp: CompressionData): AccountMeta[] {
  return comp.proof.map((p) => ({ pubkey: p, isSigner: false, isWritable: false }));
}

export function buildListInstruction(params: {
  seller: PublicKey;
  price: bigint;
  metadataArgs: ListMetadataArgs;
  comp: CompressionData;
}): TransactionInstruction {
  const { seller, price, metadataArgs, comp } = params;
  const [config] = getMarketplaceConfigPda();
  const [listing] = getListingPda(comp.tree, comp.nonce);
  const treeAuthority = getBubblegumTreeAuthority(comp.tree);

  const data = new BorshWriter()
    .fixedBytes(ixDiscriminator("list"))
    .u64(price);
  writeMetadataArgs(data, metadataArgs);
  data.u64(BigInt(comp.nonce)).u32(comp.index).fixedBytes(comp.root);

  const keys: AccountMeta[] = [
    { pubkey: seller, isSigner: true, isWritable: true },
    { pubkey: config, isSigner: false, isWritable: false },
    { pubkey: treeAuthority, isSigner: false, isWritable: false },
    { pubkey: comp.tree, isSigner: false, isWritable: true },
    { pubkey: listing, isSigner: false, isWritable: true },
    { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: BUBBLEGUM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ...proofAccountMetas(comp),
  ];

  return new TransactionInstruction({ programId: MARKETPLACE_PROGRAM_ID, keys, data: data.finish() });
}

export function buildDelistInstruction(params: {
  seller: PublicKey;
  comp: CompressionData;
  listing: Listing;
}): TransactionInstruction {
  const { seller, comp, listing } = params;
  // Derived from `listing` (the authoritative on-chain record of what's
  // escrowed), not `comp` (freshly re-fetched proof data for the same
  // asset) — if a caller ever passed mismatched comp/listing for different
  // assets, this fails closed with a real PDA/seeds mismatch instead of
  // silently deriving a listing address that doesn't match what's escrowed.
  const [listingPda] = getListingPda(listing.merkleTree, listing.leafId);
  const treeAuthority = getBubblegumTreeAuthority(listing.merkleTree);

  const data = new BorshWriter()
    .fixedBytes(ixDiscriminator("delist"))
    .u32(comp.index)
    .fixedBytes(comp.root)
    .finish();

  const keys: AccountMeta[] = [
    { pubkey: seller, isSigner: true, isWritable: true },
    { pubkey: treeAuthority, isSigner: false, isWritable: false },
    { pubkey: listing.merkleTree, isSigner: false, isWritable: true },
    { pubkey: listingPda, isSigner: false, isWritable: true },
    { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: BUBBLEGUM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ...proofAccountMetas(comp),
  ];

  return new TransactionInstruction({ programId: MARKETPLACE_PROGRAM_ID, keys, data });
}

export async function buildBuyNowInstructions(params: {
  connection: Connection;
  buyer: PublicKey;
  comp: CompressionData;
  listing: Listing;
  config: MarketplaceConfig;
}): Promise<TransactionInstruction[]> {
  const { connection, buyer, comp, listing, config } = params;
  const [listingPda] = getListingPda(listing.merkleTree, listing.leafId);
  const treeAuthority = getBubblegumTreeAuthority(listing.merkleTree);

  const buyerAta = getAssociatedTokenAddressSync(config.skrMint, buyer);
  const sellerAta = getAssociatedTokenAddressSync(config.skrMint, listing.seller);

  const ixs: TransactionInstruction[] = [];
  // buy_now's accounts are Anchor `Account<TokenAccount>` — they must
  // already exist on-chain by the time buy_now's own instruction runs, so
  // these idempotent creates are prepended in the SAME transaction (they
  // execute in order; buy_now's instruction only ever runs after them).
  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(buyer, buyerAta, buyer, config.skrMint),
    createAssociatedTokenAccountIdempotentInstruction(buyer, sellerAta, listing.seller, config.skrMint),
  );

  const data = new BorshWriter()
    .fixedBytes(ixDiscriminator("buy_now"))
    .u64(listing.price)
    .u32(comp.index)
    .fixedBytes(comp.root)
    .finish();

  const keys: AccountMeta[] = [
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: listing.seller, isSigner: false, isWritable: true },
    { pubkey: (getMarketplaceConfigPda())[0], isSigner: false, isWritable: false },
    { pubkey: treeAuthority, isSigner: false, isWritable: false },
    { pubkey: listing.merkleTree, isSigner: false, isWritable: true },
    { pubkey: listingPda, isSigner: false, isWritable: true },
    { pubkey: config.skrMint, isSigner: false, isWritable: false },
    { pubkey: buyerAta, isSigner: false, isWritable: true },
    { pubkey: sellerAta, isSigner: false, isWritable: true },
    { pubkey: config.vaultSkrAta, isSigner: false, isWritable: true },
    { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: BUBBLEGUM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ...proofAccountMetas(comp),
  ];

  ixs.push(new TransactionInstruction({ programId: MARKETPLACE_PROGRAM_ID, keys, data }));
  return ixs;
}

// ─── High-level MWA flows ───────────────────────────────────────────────
//
// Unlike nftSwap.ts's two-phase seller-sign/buyer-countersign handshake,
// every action here is a single party signing their own transaction —
// escrow means the seller no longer needs to be online for a sale.

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://onlymonkes-actions.jumpstreet25.workers.dev",
  icon: "favicon.ico",
};

/**
 * Deliberately separate from nftSwap.ts's mwaAuthorize: this hardcodes
 * `cluster: "devnet"` since Phase 1 targets the devnet-only Phase 0
 * program. Do not merge with the mainnet helper — see module doc.
 */
async function mwaAuthorizeDevnet(mobileWallet: Web3MobileWallet): Promise<PublicKey> {
  const cachedToken = useAppStore.getState().mwaAuthToken;
  let addrRaw: string | Uint8Array;
  if (cachedToken) {
    try {
      const result = await mobileWallet.authorize({
        cluster: "devnet",
        identity: APP_IDENTITY,
        auth_token: cachedToken,
      } as Parameters<typeof mobileWallet.authorize>[0]);
      addrRaw = result.accounts[0].address;
    } catch {
      const result = await mobileWallet.authorize({ cluster: "devnet", identity: APP_IDENTITY });
      addrRaw = result.accounts[0].address;
    }
  } else {
    const result = await mobileWallet.authorize({ cluster: "devnet", identity: APP_IDENTITY });
    addrRaw = result.accounts[0].address;
  }
  const pubkeyBytes = typeof addrRaw === "string" ? Buffer.from(addrRaw, "base64") : addrRaw;
  return new PublicKey(pubkeyBytes);
}

async function signAndSend(connection: Connection, expectedSigner: PublicKey, ixs: TransactionInstruction[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: expectedSigner });
  for (const ix of ixs) tx.add(ix);

  const sig = await transact(async (mobileWallet: Web3MobileWallet) => {
    const signer = await mwaAuthorizeDevnet(mobileWallet);
    if (!signer.equals(expectedSigner)) {
      throw new Error("Connected wallet does not match the expected signer");
    }
    const minContextSlot = await connection.getSlot();
    const [signature] = await mobileWallet.signAndSendTransactions({ transactions: [tx], minContextSlot });
    return signature;
  });

  const signature = typeof sig === "string" ? sig : Buffer.from(sig).toString("base64");
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}

export async function sellerListNft(params: {
  connection: Connection;
  seller: PublicKey;
  price: bigint;
  comp: CompressionData;
  metadataArgs: ListMetadataArgs;
}): Promise<string> {
  assertDeviceTrusted("NFT list (escrow)");
  const ix = buildListInstruction(params);
  return signAndSend(params.connection, params.seller, [ix]);
}

export async function sellerDelistNft(params: {
  connection: Connection;
  seller: PublicKey;
  comp: CompressionData;
  listing: Listing;
}): Promise<string> {
  assertDeviceTrusted("NFT delist");
  const ix = buildDelistInstruction(params);
  return signAndSend(params.connection, params.seller, [ix]);
}

export async function buyerBuyNow(params: {
  connection: Connection;
  buyer: PublicKey;
  comp: CompressionData;
  listing: Listing;
  config: MarketplaceConfig;
}): Promise<string> {
  assertDeviceTrusted("NFT purchase (escrow)");
  const ixs = await buildBuyNowInstructions(params);
  return signAndSend(params.connection, params.buyer, ixs);
}

// ─── Known gaps (do not silently paper over) ─────────────────────────────
//
// 1. fetchListMetadataArgsFromDas is UNVERIFIED against a real minted asset
//    — see its doc comment. Verify before any real device test.
// 2. This client was hand-written against the program's Rust source
//    (program/monkemarkets/programs/monkemarkets/src/lib.rs), not
//    cross-checked against the generated Anchor IDL yet (IDL retrieval is
//    pending from the Phase 0 devnet deploy). Cross-check discriminators
//    and account order against target/idl/monkemarkets.json once available.
// 3. fetchMarketplaceConfig/fetchListing skip the account's first 8 bytes
//    (the Anchor account discriminator) without asserting it matches the
//    expected type — safe here since both are always fetched by a PDA this
//    same client derived, so the account can only ever be the right type
//    or missing entirely (getAccountInfo returns null, already handled).
// 4. No devnet test fixture (collection/tree/SKR mint/initialize_marketplace
//    call) exists yet — these functions have not been exercised against
//    live devnet data, only checked for internal consistency against the
//    Rust source. A real device dry run needs that fixture first.
