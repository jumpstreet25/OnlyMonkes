/**
 * cnftReceipts.ts — Compressed NFT receipt minting for Banana Shop purchases.
 *
 * After a successful shop purchase the buyer can optionally mint a cNFT receipt
 * as on-chain proof of purchase.  The receipt is minted into a pre-created
 * Merkle tree via Bubblegum's `mintToCollectionV1` instruction (built manually
 * to avoid pulling in Umi).
 *
 * Env vars (set in .env, surfaced via @env):
 *   CNFT_MERKLE_TREE     — pre-created concurrent Merkle tree address
 *   CNFT_COLLECTION_MINT — collection NFT that groups all receipts
 *
 * The tree authority (delegate) must match DEV_WALLET so the buyer's MWA
 * transaction can include the mint instruction.  In practice the tree is
 * created with DEV_WALLET as the treeCreator, and the buyer is the payer
 * (tiny ~0.00001 SOL compression cost).
 *
 * NOTE: If env vars are not yet set the function returns a descriptive error
 * rather than throwing, so the purchase flow is never blocked.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  transact,
  type Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { HELIUS_RPC_URL, DEV_WALLET } from "@/lib/constants";
import { useAppStore } from "@/store/appStore";
import { assertDeviceTrusted } from "@/lib/security";
import type { ShopItem } from "@/lib/bananaShop";

// ─── Config (from env) ──────────────────────────────────────────────────────

// These are read once at module load.  Empty string = not configured yet.
let CNFT_MERKLE_TREE = "";
let CNFT_COLLECTION_MINT = "";

try {
  // Dynamic require so the app still boots if the vars aren't in @env yet
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const env = require("@env");
  CNFT_MERKLE_TREE = env.CNFT_MERKLE_TREE ?? "";
  CNFT_COLLECTION_MINT = env.CNFT_COLLECTION_MINT ?? "";
} catch {
  // Vars not declared yet — that's fine, we'll surface it at mint time
}

// ─── Program addresses ──────────────────────────────────────────────────────

const BUBBLEGUM_PROGRAM_ID = new PublicKey(
  "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY",
);
const SPL_NOOP_PROGRAM_ID = new PublicKey(
  "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV",
);
const SPL_ACCOUNT_COMPRESSION_ID = new PublicKey(
  "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK",
);
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

const APP_IDENTITY = {
  name: "OnlyMonkes",
  uri: "https://github.com/jumpstreet25/OnlyMonkes",
  icon: "favicon.ico",
};

// ─── Borsh helpers (minimal, no external dep) ───────────────────────────────

function encodeString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

function encodeOptionBool(val: boolean | null): Buffer {
  if (val === null) return Buffer.from([0]); // None
  return Buffer.from([1, val ? 1 : 0]);
}

function encodeOptionU8(val: number | null): Buffer {
  if (val === null) return Buffer.from([0]); // None
  return Buffer.from([1, val & 0xff]);
}

function encodeOptionU64(val: bigint | null): Buffer {
  if (val === null) return Buffer.from([0]);
  const buf = Buffer.alloc(9);
  buf[0] = 1;
  buf.writeBigUInt64LE(val, 1);
  return buf;
}

/** Encode a Collection { verified: bool, key: Pubkey } wrapped in Option. */
function encodeOptionCollection(
  key: PublicKey | null,
  verified: boolean,
): Buffer {
  if (!key) return Buffer.from([0]); // None
  return Buffer.concat([Buffer.from([1, verified ? 1 : 0]), key.toBuffer()]);
}

/** Encode Uses struct (Option) — we always set None. */
function encodeOptionUses(): Buffer {
  return Buffer.from([0]); // None
}

/** Encode creators array. */
function encodeCreators(
  creators: Array<{ address: PublicKey; verified: boolean; share: number }>,
): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(creators.length, 0);
  const parts: Buffer[] = [lenBuf];
  for (const c of creators) {
    parts.push(c.address.toBuffer());
    parts.push(Buffer.from([c.verified ? 1 : 0]));
    parts.push(Buffer.from([c.share]));
  }
  return Buffer.concat(parts);
}

/**
 * Serialize MetadataArgs for the Bubblegum mintToCollectionV1 instruction.
 *
 * Layout (Borsh):
 *   name: string, symbol: string, uri: string, sellerFeeBasisPoints: u16,
 *   primarySaleHappened: bool, isMutable: bool,
 *   editionNonce: Option<u8>, tokenStandard: Option<u8>,
 *   collection: Option<Collection>, uses: Option<Uses>,
 *   tokenProgramVersion: u8 (0 = Original),
 *   creators: Vec<Creator>
 */
function serializeMetadataArgs(args: {
  name: string;
  symbol: string;
  uri: string;
  sellerFeeBasisPoints: number;
  collection: PublicKey | null;
  creators: Array<{ address: PublicKey; verified: boolean; share: number }>;
}): Buffer {
  const bps = Buffer.alloc(2);
  bps.writeUInt16LE(args.sellerFeeBasisPoints, 0);

  return Buffer.concat([
    encodeString(args.name),
    encodeString(args.symbol),
    encodeString(args.uri),
    bps,
    Buffer.from([0]),           // primarySaleHappened = false
    Buffer.from([1]),           // isMutable = true
    encodeOptionU8(null),       // editionNonce = None
    encodeOptionU8(0),          // tokenStandard = Some(NonFungible = 0)
    encodeOptionCollection(args.collection, false), // collection verified = false (Bubblegum verifies it)
    encodeOptionUses(),         // uses = None
    Buffer.from([0]),           // tokenProgramVersion = Original
    encodeCreators(args.creators),
  ]);
}

// ─── PDA derivations ────────────────────────────────────────────────────────

function findTreeConfig(merkleTree: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [merkleTree.toBuffer()],
    BUBBLEGUM_PROGRAM_ID,
  );
  return pda;
}

function findMetadataPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID,
  );
  return pda;
}

function findMasterEditionPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID,
  );
  return pda;
}

function findBubblegumSigner(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_cpi")],
    BUBBLEGUM_PROGRAM_ID,
  );
  return pda;
}

// ─── Build mintToCollectionV1 instruction ────────────────────────────────────

/**
 * Manually constructs the Bubblegum `mintToCollectionV1` TransactionInstruction.
 *
 * Discriminator: sha256("global:mint_to_collection_v1")[0..8]
 * = [153, 18, 178, 47, 197, 158, 86, 15]
 */
function buildMintToCollectionV1Ix(args: {
  payer: PublicKey;
  leafOwner: PublicKey;
  merkleTree: PublicKey;
  collectionMint: PublicKey;
  treeCreatorOrDelegate: PublicKey;
  metadata: {
    name: string;
    symbol: string;
    uri: string;
    sellerFeeBasisPoints: number;
    collection: PublicKey | null;
    creators: Array<{ address: PublicKey; verified: boolean; share: number }>;
  };
}): TransactionInstruction {
  const treeConfig = findTreeConfig(args.merkleTree);
  const collectionMetadata = findMetadataPDA(args.collectionMint);
  const collectionEdition = findMasterEditionPDA(args.collectionMint);
  const bubblegumSigner = findBubblegumSigner();

  // Instruction discriminator for mintToCollectionV1
  const discriminator = Buffer.from([
    153, 18, 178, 47, 197, 158, 86, 15,
  ]);
  const metadataData = serializeMetadataArgs(args.metadata);
  const data = Buffer.concat([discriminator, metadataData]);

  // Account ordering per Bubblegum IDL:
  //  0  treeConfig (PDA)
  //  1  leafOwner
  //  2  leafDelegate (= leafOwner)
  //  3  merkleTree (writable)
  //  4  payer (signer, writable)
  //  5  treeCreatorOrDelegate (signer)
  //  6  collectionAuthorityRecordPda (= Bubblegum program id when no record)
  //  7  collectionMint
  //  8  collectionMetadata (writable)
  //  9  collectionEdition
  // 10  bubblegumSigner
  // 11  logWrapper (noop)
  // 12  compressionProgram
  // 13  tokenMetadataProgram
  // 14  systemProgram
  const keys = [
    { pubkey: treeConfig, isSigner: false, isWritable: true },
    { pubkey: args.leafOwner, isSigner: false, isWritable: false },
    { pubkey: args.leafOwner, isSigner: false, isWritable: false }, // leafDelegate = leafOwner
    { pubkey: args.merkleTree, isSigner: false, isWritable: true },
    { pubkey: args.payer, isSigner: true, isWritable: true },
    { pubkey: args.treeCreatorOrDelegate, isSigner: true, isWritable: false },
    { pubkey: BUBBLEGUM_PROGRAM_ID, isSigner: false, isWritable: false }, // no authority record → program id
    { pubkey: args.collectionMint, isSigner: false, isWritable: false },
    { pubkey: collectionMetadata, isSigner: false, isWritable: true },
    { pubkey: collectionEdition, isSigner: false, isWritable: false },
    { pubkey: bubblegumSigner, isSigner: false, isWritable: false },
    { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SPL_ACCOUNT_COMPRESSION_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: BUBBLEGUM_PROGRAM_ID,
    keys,
    data,
  });
}

// ─── Metadata builder ───────────────────────────────────────────────────────

function buildReceiptMetadataUri(item: ShopItem): string {
  const now = new Date();
  const metadataJson = {
    name: `OnlyMonkes Receipt: ${item.name}`,
    symbol: "MONKE",
    description: `Proof of purchase — ${item.description}`,
    image: "", // Generic receipt image (can be set later via collection-level update)
    attributes: [
      { trait_type: "Item ID", value: item.id },
      { trait_type: "Category", value: item.category },
      { trait_type: "Tier", value: String(item.tier) },
      { trait_type: "Purchase Date", value: now.toISOString() },
      { trait_type: "Preview", value: item.preview },
    ],
    properties: {
      category: "image",
      creators: [{ address: DEV_WALLET, share: 100 }],
    },
    collection: {
      name: "OnlyMonkes Shop Receipts",
      family: "Saga Monkes",
    },
  };

  return `data:application/json;base64,${Buffer.from(
    JSON.stringify(metadataJson),
  ).toString("base64")}`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface ReceiptMintResult {
  success: boolean;
  /** Transaction signature if successful */
  signature?: string;
  /** Human-readable error */
  error?: string;
}

/** Check whether cNFT receipt minting is configured and available. */
export function isReceiptMintingAvailable(): boolean {
  return !!(CNFT_MERKLE_TREE && CNFT_COLLECTION_MINT);
}

/**
 * Fetch all OnlyMonkes purchase receipt cNFTs owned by `walletAddr` and
 * return the set of `Item ID`s encoded in their metadata.
 *
 * Lets us reconstruct shop ownership from chain alone — the canonical use
 * case is restoring purchases on a fresh device when local AsyncStorage is
 * empty and `/reclaim` hasn't been run.
 *
 * Uses Helius DAS `getAssetsByOwner` filtered to `CNFT_COLLECTION_MINT`.
 * Returns an empty array if the collection isn't configured or the wallet
 * has no receipts. Never throws — failures degrade gracefully (we still
 * have AsyncStorage + PROFILE_UPDATE merges as fallbacks).
 */
export async function fetchPurchaseReceiptsFromChain(walletAddr: string): Promise<string[]> {
  if (!CNFT_COLLECTION_MINT || !walletAddr) return [];
  try {
    new PublicKey(walletAddr); // validate
  } catch {
    return [];
  }

  const itemIds = new Set<string>();
  const PAGE_LIMIT = 1000;
  let page = 1;
  // Hard cap to avoid runaway loops
  for (let safety = 0; safety < 10; safety++) {
    const resp = await fetch(HELIUS_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "om-receipts",
        method: "getAssetsByOwner",
        params: {
          ownerAddress: walletAddr,
          page,
          limit: PAGE_LIMIT,
          displayOptions: { showCollectionMetadata: false },
        },
      }),
    }).catch(() => null);

    if (!resp || !resp.ok) break;
    const data = await resp.json().catch(() => null) as any;
    const items: any[] = data?.result?.items ?? [];
    if (items.length === 0) break;

    for (const asset of items) {
      // Filter to our collection
      const grouping: any[] = asset?.grouping ?? [];
      const inCollection = grouping.some(
        (g) => g?.group_key === "collection" && g?.group_value === CNFT_COLLECTION_MINT,
      );
      if (!inCollection) continue;

      // Extract Item ID from metadata attributes (preferred path — DAS often
      // returns parsed metadata directly).
      const attrs: any[] = asset?.content?.metadata?.attributes ?? [];
      let itemId = attrs.find((a) => a?.trait_type === "Item ID")?.value as string | undefined;

      // Fallback: decode the inline data URI if metadata wasn't parsed.
      if (!itemId) {
        const jsonUri: string | undefined = asset?.content?.json_uri;
        if (jsonUri && jsonUri.startsWith("data:application/json;base64,")) {
          try {
            const b64 = jsonUri.slice("data:application/json;base64,".length);
            const decoded = Buffer.from(b64, "base64").toString("utf8");
            const meta = JSON.parse(decoded);
            const a: any[] = meta?.attributes ?? [];
            itemId = a.find((x) => x?.trait_type === "Item ID")?.value as string | undefined;
          } catch { /* ignore */ }
        }
      }

      if (typeof itemId === "string" && itemId.length > 0) {
        itemIds.add(itemId);
      }
    }

    if (items.length < PAGE_LIMIT) break;
    page += 1;
  }

  return Array.from(itemIds);
}

/**
 * Mint a compressed NFT receipt for a Banana Shop purchase.
 *
 * The buyer signs via MWA and pays the tiny compression cost (~0.00001 SOL).
 * DEV_WALLET must be the tree creator / delegate so it can authorize the mint.
 * Since DEV_WALLET is a server-side key, the transaction is partially signed:
 *   - The app builds the instruction with treeCreatorOrDelegate = DEV_WALLET
 *   - MWA signs for the buyer (payer)
 *   - The instruction is structured so DEV_WALLET is NOT required as a signer
 *     when the tree was created with `public: true`, or when using a delegate.
 *
 * **Current approach (public tree)**:
 *   The Merkle tree must be created with `public: true` so any payer can mint.
 *   This eliminates the need for the tree authority to co-sign.
 *   Update `create-badge-collection.ts` to use `public: true` for the receipt tree.
 *
 * Returns { success, signature?, error? }.
 */
export async function mintPurchaseReceipt(
  item: ShopItem,
  buyerWallet: string,
): Promise<ReceiptMintResult> {
  assertDeviceTrusted("Receipt mint");
  // Validate config
  if (!CNFT_MERKLE_TREE || !CNFT_COLLECTION_MINT) {
    return {
      success: false,
      error:
        "Receipt minting not configured yet. Set CNFT_MERKLE_TREE and CNFT_COLLECTION_MINT in .env.",
    };
  }

  // Validate buyer wallet
  let buyerPubkey: PublicKey;
  try {
    buyerPubkey = new PublicKey(buyerWallet);
  } catch {
    return { success: false, error: "Invalid buyer wallet address" };
  }

  const merkleTree = new PublicKey(CNFT_MERKLE_TREE);
  const collectionMint = new PublicKey(CNFT_COLLECTION_MINT);
  const devPubkey = new PublicKey(DEV_WALLET);

  const metadataUri = buildReceiptMetadataUri(item);
  const truncatedName = `OnlyMonkes Receipt: ${item.name}`.slice(0, 32); // Metaplex 32-char limit

  try {
    const connection = new Connection(HELIUS_RPC_URL, "confirmed");

    const signature = await transact(async (mobileWallet: Web3MobileWallet) => {
      // Authorize via MWA
      const cachedToken = useAppStore.getState().mwaAuthToken;
      let authResult;
      if (cachedToken) {
        try {
          authResult = await mobileWallet.authorize({
            cluster: "mainnet-beta",
            identity: APP_IDENTITY,
            auth_token: cachedToken,
          } as Parameters<typeof mobileWallet.authorize>[0]);
          useAppStore.getState().setMwaAuthToken(authResult.auth_token);
        } catch {
          authResult = await mobileWallet.authorize({
            cluster: "mainnet-beta",
            identity: APP_IDENTITY,
          });
          useAppStore.getState().setMwaAuthToken(authResult.auth_token);
        }
      } else {
        authResult = await mobileWallet.authorize({
          cluster: "mainnet-beta",
          identity: APP_IDENTITY,
        });
        useAppStore.getState().setMwaAuthToken(authResult.auth_token);
      }

      const payerPubkey = new PublicKey(authResult.accounts[0].address);

      const { blockhash } = await connection.getLatestBlockhash("confirmed");

      const mintIx = buildMintToCollectionV1Ix({
        payer: payerPubkey,
        leafOwner: buyerPubkey,
        merkleTree,
        collectionMint,
        treeCreatorOrDelegate: devPubkey,
        metadata: {
          name: truncatedName,
          symbol: "MONKE",
          uri: metadataUri,
          sellerFeeBasisPoints: 0,
          collection: collectionMint,
          creators: [
            { address: devPubkey, verified: true, share: 100 },
          ],
        },
      });

      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: payerPubkey,
      }).add(mintIx);

      const [sig] = await mobileWallet.signAndSendTransactions({
        transactions: [tx],
      });
      return sig;
    });

    const sigStr =
      typeof signature === "string"
        ? signature
        : Buffer.from(signature).toString("base64");

    return { success: true, signature: sigStr };
  } catch (err: any) {
    const msg = err?.message ?? "Receipt mint failed";
    // Don't throw — purchase was already successful
    console.warn("[cnftReceipts] mint failed:", msg);
    return { success: false, error: msg };
  }
}
