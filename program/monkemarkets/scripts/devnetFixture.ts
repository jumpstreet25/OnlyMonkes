// One-off devnet test-fixture setup script (NOT part of the mocha test suite).
// Creates a real SKR-equivalent SPL mint, a verified NFT collection, a full-canopy
// Bubblegum V1 tree, mints one test cNFT into it, and calls initialize_marketplace
// on the already-deployed live devnet program. Everything is owned by the deploy
// authority keypair (~/.config/solana/id.json) for now -- ownership transfer to a
// real test wallet is a separate follow-up step.
//
// Run with: npx ts-node scripts/devnetFixture.ts   (from the monkemarkets/ dir)

import * as anchor from "@coral-xyz/anchor";
import * as web3 from "@solana/web3.js";
import * as splToken from "@solana/spl-token";
import bs58 from "bs58";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const { PublicKey, Keypair, Connection, SystemProgram } = web3;
const { createMint, getOrCreateAssociatedTokenAccount, mintTo } = splToken;

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  generateSigner,
  keypairIdentity,
  publicKey as umiPk,
  percentAmount,
} from "@metaplex-foundation/umi";
import {
  fromWeb3JsKeypair,
  toWeb3JsPublicKey,
} from "@metaplex-foundation/umi-web3js-adapters";
import {
  mplTokenMetadata,
  createNft,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  mplBubblegum,
  createTree,
  mintToCollectionV1,
  findTreeConfigPda,
  hashMetadataData,
  hashMetadataCreators,
  TokenStandard as BgTokenStandard,
  TokenProgramVersion as BgTokenProgramVersion,
} from "@metaplex-foundation/mpl-bubblegum";

const DEVNET_URL = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("FZfCbVdH9iY7bQNap1b4do52bhYJmiE8u3VSkxvv8euU");
const SCRATCH = path.join(__dirname, "..");

// Same broken-package workaround as tests/monkemarkets.ts (the official
// @solana/spl-account-compression 0.4.1 npm publish has a package.json
// exports/main field pointing at a dist/cjs/index.js that does not exist in
// the tarball). ts-node here always compiles to CommonJS per tsconfig, so
// the ambient `require` is guaranteed present -- no dual ESM/CJS handling
// needed like in the mocha test file.
function loadSplAccountCompression(): any {
  const idlPath = require.resolve(
    "@solana/spl-account-compression/idl/spl_account_compression.json"
  );
  const sacDir = path.dirname(path.dirname(idlPath));
  return require(path.join(sacDir, "dist", "cjs", "src", "index.js"));
}

async function main() {
  const connection = new Connection(DEVNET_URL, "confirmed");

  const raw = JSON.parse(
    fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf-8")
  );
  const authority = Keypair.fromSecretKey(Uint8Array.from(raw));
  console.log("=== Deploy authority ===");
  console.log(authority.publicKey.toBase58());

  const startBalance = await connection.getBalance(authority.publicKey);
  console.log("Starting balance:", startBalance / 1e9, "SOL");

  // --- 1. SKR-equivalent SPL token ---
  console.log("\n=== Step 1: SKR mint ===");
  const skrMint = await createMint(
    connection,
    authority,
    authority.publicKey,
    null,
    6
  );
  const authorityAta = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    skrMint,
    authority.publicKey
  );
  await mintTo(
    connection,
    authority,
    skrMint,
    authorityAta.address,
    authority,
    1_000_000 * 1_000_000 // 1,000,000 tokens, 6 decimals
  );
  console.log("SKR mint:", skrMint.toBase58());
  console.log("Authority SKR ATA:", authorityAta.address.toBase58());

  // --- Umi context ---
  const umi = createUmi(DEVNET_URL).use(mplTokenMetadata()).use(mplBubblegum());
  umi.use(keypairIdentity(fromWeb3JsKeypair(authority)));

  // --- 2. Verified NFT collection ---
  console.log("\n=== Step 2: Collection NFT ===");
  const collectionSigner = generateSigner(umi);
  await createNft(umi, {
    mint: collectionSigner,
    name: "Saga Monkes (Devnet Test)",
    uri: "https://example.com/saga-monkes-devnet-collection.json",
    sellerFeeBasisPoints: percentAmount(5),
    isCollection: true,
  }).sendAndConfirm(umi, { send: { skipPreflight: true } });
  const collectionMint = toWeb3JsPublicKey(collectionSigner.publicKey);
  console.log("Collection mint:", collectionMint.toBase58());

  // --- 3. Bubblegum V1 tree, full canopy ---
  console.log("\n=== Step 3: Merkle tree (full canopy) ===");
  const treeSigner = generateSigner(umi);
  const treeBuilder = await createTree(umi, {
    merkleTree: treeSigner,
    maxDepth: 5,
    maxBufferSize: 8,
    canopyDepth: 5,
  });
  await treeBuilder.sendAndConfirm(umi, { send: { skipPreflight: true } });
  const merkleTree = toWeb3JsPublicKey(treeSigner.publicKey);
  const [treeAuthorityUmiPk] = findTreeConfigPda(umi, {
    merkleTree: treeSigner.publicKey,
  });
  const treeAuthority = toWeb3JsPublicKey(treeAuthorityUmiPk);
  console.log("Merkle tree:", merkleTree.toBase58());
  console.log("Tree authority (Bubblegum TreeConfig PDA):", treeAuthority.toBase58());

  // --- 4. Mint one test cNFT ---
  console.log("\n=== Step 4: Mint test cNFT ===");
  const nonce = 0; // first leaf on a fresh tree
  const meta = {
    name: "Test Monke #0",
    symbol: "TMONKE",
    uri: "https://example.com/test-monke-0.json",
    sellerFeeBasisPoints: 500,
    primarySaleHappened: false,
    isMutable: true,
    collection: { verified: true, key: umiPk(collectionMint.toBase58()) },
    creators: [] as any[],
    tokenStandard: BgTokenStandard.NonFungible,
    tokenProgramVersion: BgTokenProgramVersion.Original,
  };
  await mintToCollectionV1(umi, {
    leafOwner: umiPk(authority.publicKey.toBase58()),
    merkleTree: umiPk(merkleTree.toBase58()),
    collectionMint: umiPk(collectionMint.toBase58()),
    metadata: meta,
  }).sendAndConfirm(umi, { send: { skipPreflight: true } });

  const dataHash = hashMetadataData(meta);
  const creatorHash = hashMetadataCreators(meta.creators);
  console.log("Leaf nonce/index:", nonce);
  console.log("data_hash (base58):", bs58.encode(dataHash));
  console.log("creator_hash (base58):", bs58.encode(creatorHash));

  const sac = loadSplAccountCompression();
  const treeAcct = await sac.ConcurrentMerkleTreeAccount.fromAccountAddress(
    connection,
    merkleTree
  );
  const root = treeAcct.getCurrentRoot();
  console.log("Current tree root (base58):", bs58.encode(root));

  // --- 5. initialize_marketplace ---
  console.log("\n=== Step 5: initialize_marketplace ===");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const idl = JSON.parse(
    fs.readFileSync(path.join(SCRATCH, "target/idl/monkemarkets.json"), "utf-8")
  );
  const program = new (anchor as any).Program(idl, provider);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("marketplace")],
    PROGRAM_ID
  );

  await program.methods
    .initializeMarketplace(200)
    .accounts({
      authority: authority.publicKey,
      config: configPda,
      skrMint,
      collectionMint,
      vaultSkrAta: authorityAta.address,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  const cfg = await program.account.marketplaceConfig.fetch(configPda);
  console.log("MarketplaceConfig PDA:", configPda.toBase58());
  console.log("readback:", {
    authority: cfg.authority.toBase58(),
    skrMint: cfg.skrMint.toBase58(),
    collectionMint: cfg.collectionMint.toBase58(),
    vaultSkrAta: cfg.vaultSkrAta.toBase58(),
    feeBps: cfg.feeBps,
    paused: cfg.paused,
  });

  const endBalance = await connection.getBalance(authority.publicKey);
  console.log("\n=== Final balance ===");
  console.log(endBalance / 1e9, "SOL (spent", (startBalance - endBalance) / 1e9, "SOL)");

  console.log("\n=== SUMMARY (machine-readable) ===");
  console.log(
    JSON.stringify(
      {
        deployAuthority: authority.publicKey.toBase58(),
        programId: PROGRAM_ID.toBase58(),
        skrMint: skrMint.toBase58(),
        authoritySkrAta: authorityAta.address.toBase58(),
        collectionMint: collectionMint.toBase58(),
        merkleTree: merkleTree.toBase58(),
        treeAuthority: treeAuthority.toBase58(),
        testCnftNonce: nonce,
        testCnftDataHashBase58: bs58.encode(dataHash),
        testCnftCreatorHashBase58: bs58.encode(creatorHash),
        currentTreeRootBase58: bs58.encode(root),
        marketplaceConfigPda: configPda.toBase58(),
        feeBps: 200,
        endBalanceSol: endBalance / 1e9,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
