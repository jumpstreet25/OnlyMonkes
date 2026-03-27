/**
 * create-badge-collection.ts — One-time setup script for cNFT badge collection.
 *
 * Creates:
 *  1. Collection NFT (Metaplex Token Metadata)
 *  2. Merkle tree (SPL Account Compression) for compressed NFTs
 *
 * Run once: bun scripts/create-badge-collection.ts
 * Then update COLLECTION_MINT and MERKLE_TREE in src/lib/cnftBadges.ts
 *
 * Requires:
 *  - HELIUS_API_KEY in .env
 *  - A funded wallet keypair at ./badge-authority.json
 *    (this wallet becomes the tree authority and can mint badges)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createCreateTreeInstruction,
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  getConcurrentMerkleTreeAccountSize,
} from "@solana/spl-account-compression";
import {
  createCreateMetadataAccountV3Instruction,
  createCreateMasterEditionV3Instruction,
  PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { readFileSync, existsSync } from "fs";
import * as dotenv from "dotenv";

dotenv.config();

const HELIUS_KEY = process.env.HELIUS_API_KEY;
if (!HELIUS_KEY) throw new Error("HELIUS_API_KEY not set in .env");

const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
const connection = new Connection(RPC_URL, "confirmed");

// Load or create authority keypair
const AUTHORITY_PATH = "./badge-authority.json";
let authority: Keypair;
if (existsSync(AUTHORITY_PATH)) {
  const raw = JSON.parse(readFileSync(AUTHORITY_PATH, "utf8"));
  authority = Keypair.fromSecretKey(Uint8Array.from(raw));
  console.log("Authority:", authority.publicKey.toBase58());
} else {
  console.error(`\nNo authority keypair found at ${AUTHORITY_PATH}`);
  console.error("Generate one with: solana-keygen new -o badge-authority.json");
  console.error("Then fund it with ~0.1 SOL for tree creation costs.\n");
  process.exit(1);
}

async function main() {
  const balance = await connection.getBalance(authority.publicKey);
  console.log(`Authority balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    throw new Error("Authority needs at least 0.05 SOL. Fund it first.");
  }

  // ── Step 1: Create Collection NFT ────────────────────────────────────────
  console.log("\n1. Creating collection NFT...");

  const collectionMint = await createMint(
    connection, authority, authority.publicKey, authority.publicKey, 0
  );
  console.log("   Collection mint:", collectionMint.toBase58());

  const collectionATA = await getOrCreateAssociatedTokenAccount(
    connection, authority, collectionMint, authority.publicKey
  );

  await mintTo(
    connection, authority, collectionMint, collectionATA.address, authority, 1
  );

  // Create metadata for collection
  const [metadataPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), collectionMint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  );

  const createMetadataIx = createCreateMetadataAccountV3Instruction(
    {
      metadata: metadataPDA,
      mint: collectionMint,
      mintAuthority: authority.publicKey,
      payer: authority.publicKey,
      updateAuthority: authority.publicKey,
    },
    {
      createMetadataAccountArgsV3: {
        data: {
          name: "OnlyMonkes Activity Badges",
          symbol: "MONKE",
          uri: "", // Collection-level metadata URI (can add later)
          sellerFeeBasisPoints: 0,
          creators: [{ address: authority.publicKey, verified: true, share: 100 }],
          collection: null,
          uses: null,
        },
        isMutable: true,
        collectionDetails: { __kind: "V1", size: 0 },
      },
    },
  );

  const [masterEditionPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      collectionMint.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID,
  );

  const createMasterEditionIx = createCreateMasterEditionV3Instruction(
    {
      edition: masterEditionPDA,
      mint: collectionMint,
      updateAuthority: authority.publicKey,
      mintAuthority: authority.publicKey,
      payer: authority.publicKey,
      metadata: metadataPDA,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
    { createMasterEditionArgs: { maxSupply: 0 } }, // 0 = unlimited prints
  );

  const metaTx = new Transaction().add(createMetadataIx).add(createMasterEditionIx);
  await sendAndConfirmTransaction(connection, metaTx, [authority]);
  console.log("   Collection metadata + master edition created");

  // ── Step 2: Create Merkle Tree ───────────────────────────────────────────
  console.log("\n2. Creating Merkle tree for compressed NFTs...");

  // maxDepth=14 (16,384 leaves), maxBufferSize=64 — good for thousands of badges
  const maxDepth = 14;
  const maxBufferSize = 64;
  const canopyDepth = 10; // Reduces proof size for cheaper mints

  const treeSize = getConcurrentMerkleTreeAccountSize(maxDepth, maxBufferSize, canopyDepth);
  const treeKeypair = Keypair.generate();

  const allocTreeIx = SystemProgram.createAccount({
    fromPubkey: authority.publicKey,
    newAccountPubkey: treeKeypair.publicKey,
    lamports: await connection.getMinimumBalanceForRentExemption(treeSize),
    space: treeSize,
    programId: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  });

  const [treeAuthority] = PublicKey.findProgramAddressSync(
    [treeKeypair.publicKey.toBuffer()],
    BUBBLEGUM_PROGRAM_ID,
  );

  const createTreeIx = createCreateTreeInstruction(
    {
      treeAuthority,
      merkleTree: treeKeypair.publicKey,
      payer: authority.publicKey,
      treeCreator: authority.publicKey,
      logWrapper: SPL_NOOP_PROGRAM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    },
    {
      maxDepth,
      maxBufferSize,
      public: false, // Only authority can mint
    },
  );

  const treeTx = new Transaction().add(allocTreeIx).add(createTreeIx);
  await sendAndConfirmTransaction(connection, treeTx, [authority, treeKeypair]);
  console.log("   Merkle tree:", treeKeypair.publicKey.toBase58());

  // ── Done ─────────────────────────────────────────────────────────────────
  console.log("\n✅ Badge collection created!");
  console.log("\nUpdate src/lib/cnftBadges.ts with:");
  console.log(`  COLLECTION_MINT = "${collectionMint.toBase58()}";`);
  console.log(`  MERKLE_TREE     = "${treeKeypair.publicKey.toBase58()}";`);
  console.log(`\nAuthority (tree creator): ${authority.publicKey.toBase58()}`);
  console.log("Keep badge-authority.json safe — it's needed to mint badges.\n");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
