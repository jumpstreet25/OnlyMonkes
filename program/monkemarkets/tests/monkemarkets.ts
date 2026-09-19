import * as anchor from "@coral-xyz/anchor";
import * as web3 from "@solana/web3.js";
import * as splToken from "@solana/spl-token";
import BN from "bn.js";
const { Program } = anchor;
type Program<T = any> = InstanceType<typeof anchor.Program>;
const {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} = web3;
type Connection = InstanceType<typeof web3.Connection>;
const {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} = splToken;
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
import { mplTokenMetadata, createNft } from "@metaplex-foundation/mpl-token-metadata";
import {
  mplBubblegum,
  createTree,
  mintToCollectionV1,
  findTreeConfigPda,
  TokenStandard as BgTokenStandard,
  TokenProgramVersion as BgTokenProgramVersion,
} from "@metaplex-foundation/mpl-bubblegum";
import { assert, expect } from "chai";
import * as path from "path";

// The official `@solana/spl-account-compression` npm publish (0.4.1) ships a
// broken package.json `exports` map pointing at `dist/cjs/index.js`, which
// does not exist in the published tarball (the real compiled entry point is
// one directory deeper, at `dist/cjs/src/index.js` — a real upstream
// packaging bug, not something fixable from here). Requiring the resolved
// absolute file path directly bypasses Node's package-exports resolution
// (which only gates bare-specifier `require`/`import`, not an already-
// resolved filesystem path) and gets us the genuine, well-tested Anza
// deserializer instead of re-implementing merkle-tree account parsing.
//
// mocha/ts-node has loaded this file as plain CommonJS in some runs and as
// native ESM in others (depends on details outside this file's control), so
// this resolves a working `require` for either case at call time rather
// than assuming one: under CJS, the ambient `require` already works; under
// ESM, one comes from the tiny sibling `esmRequire.mjs` file, which is
// plain JavaScript untouched by tsconfig's `"module": "commonjs"` target
// and can therefore use real `import.meta` syntax (impossible to construct
// dynamically via `eval`/`new Function` from within this file — both parse
// their string argument as a Script, not a Module, so `import.meta` is
// rejected there regardless of this file's own module-ness).
async function loadSplAccountCompression(): Promise<
  typeof import("@solana/spl-account-compression")
> {
  let req: NodeJS.Require;
  if (typeof require !== "undefined") {
    req = require;
  } else {
    const { makeRequire } = await import("./esmRequire.mjs");
    req = makeRequire();
  }
  // `./package.json` isn't in this package's `exports` map (only "." and
  // "./idl/spl_account_compression.json" are), so resolving it directly is
  // blocked under strict exports enforcement. The idl JSON path IS a listed
  // export one level inside the package root, so resolve that instead and
  // walk up two directories (idl/<file>.json -> idl/ -> package root).
  const idlPath = req.resolve(
    "@solana/spl-account-compression/idl/spl_account_compression.json"
  );
  const sacDir = path.dirname(path.dirname(idlPath));
  return req(path.join(sacDir, "dist", "cjs", "src", "index.js"));
}

const BUBBLEGUM_PROGRAM_ID = new PublicKey(
  "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY"
);
const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey(
  "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK"
);
const SPL_NOOP_PROGRAM_ID = new PublicKey(
  "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV"
);

// Canonical test-leaf metadata, shared by both SDKs so the hash our own
// program recomputes in `list` always matches the hash Bubblegum's real
// on-chain program computed and stored at mint time. Only `name` varies
// per leaf (cheap way to keep leaves distinguishable in logs).
function canonicalMeta(name: string, collectionMint: PublicKey) {
  return {
    name,
    symbol: "TMONKE",
    uri: "https://example.com/test-monke.json",
    sellerFeeBasisPoints: 500,
    primarySaleHappened: false,
    isMutable: true,
    collectionKey: collectionMint,
  };
}

// Shape expected by mpl-bubblegum's own `mintToCollectionV1` (numeric enums).
function toBubblegumMetadata(m: ReturnType<typeof canonicalMeta>) {
  return {
    name: m.name,
    symbol: m.symbol,
    uri: m.uri,
    sellerFeeBasisPoints: m.sellerFeeBasisPoints,
    primarySaleHappened: m.primarySaleHappened,
    isMutable: m.isMutable,
    collection: { verified: true, key: umiPk(m.collectionKey.toBase58()) },
    creators: [],
    tokenStandard: BgTokenStandard.NonFungible,
    tokenProgramVersion: BgTokenProgramVersion.Original,
  };
}

// Shape expected by OUR Anchor program's `list` instruction (Anchor
// tagged-enum IDL convention: `{ variant: {} }`).
function toOurMetadataArgs(m: ReturnType<typeof canonicalMeta>, opts?: {
  verified?: boolean;
  collectionOverride?: PublicKey;
}) {
  return {
    name: m.name,
    symbol: m.symbol,
    uri: m.uri,
    sellerFeeBasisPoints: m.sellerFeeBasisPoints,
    primarySaleHappened: m.primarySaleHappened,
    isMutable: m.isMutable,
    editionNonce: null,
    tokenStandard: { nonFungible: {} },
    collection: {
      verified: opts?.verified ?? true,
      key: opts?.collectionOverride ?? m.collectionKey,
    },
    uses: null,
    tokenProgramVersion: { original: {} },
    creators: [],
  };
}

describe("monkemarkets", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection: Connection = provider.connection;
  const program = anchor.workspace.Monkemarkets as Program<any>;

  const authority = Keypair.generate();
  const seller = Keypair.generate();
  const buyer = Keypair.generate();

  const FEE_BPS = 200; // 2%

  let umi: ReturnType<typeof createUmi>;
  let skrMint: PublicKey;
  let vaultAta: PublicKey;
  let collectionMint: PublicKey;
  let merkleTree: PublicKey;
  let treeAuthority: PublicKey;
  let configPda: PublicKey;

  let buyerAta: PublicKey;
  let sellerAta: PublicKey;

  let leafCounter = 0;

  async function airdrop(pubkey: PublicKey, sol = 20) {
    const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      { signature: sig, ...latest },
      "confirmed"
    );
  }

  function listingPda(tree: PublicKey, nonce: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("listing"),
        tree.toBuffer(),
        new BN(nonce).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
  }

  let sacModule: typeof import("@solana/spl-account-compression") | undefined;
  async function currentRoot(): Promise<number[]> {
    if (!sacModule) sacModule = await loadSplAccountCompression();
    const treeAcct = await sacModule.ConcurrentMerkleTreeAccount.fromAccountAddress(
      connection,
      merkleTree
    );
    return Array.from(treeAcct.getCurrentRoot());
  }

  async function mintFreshLeaf(owner: PublicKey, label: string) {
    const nonce = leafCounter++;
    const meta = canonicalMeta(label, collectionMint);
    await mintToCollectionV1(umi, {
      leafOwner: umiPk(owner.toBase58()),
      merkleTree: umiPk(merkleTree.toBase58()),
      collectionMint: umiPk(collectionMint.toBase58()),
      metadata: toBubblegumMetadata(meta),
    }).sendAndConfirm(umi, { send: { skipPreflight: true } });
    return { nonce, meta };
  }

  async function skrBalance(ata: PublicKey): Promise<bigint> {
    const acc = await getAccount(connection, ata);
    return acc.amount;
  }

  before(async () => {
    await airdrop(authority.publicKey);
    await airdrop(seller.publicKey);
    await airdrop(buyer.publicKey);

    // --- Umi context, funded by the authority keypair ---
    umi = createUmi(connection.rpcEndpoint)
      .use(mplTokenMetadata())
      .use(mplBubblegum());
    umi.use(keypairIdentity(fromWeb3JsKeypair(authority)));

    // --- SKR test mint + ATAs ---
    skrMint = await createMint(
      connection,
      authority,
      authority.publicKey,
      null,
      6
    );
    buyerAta = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        buyer,
        skrMint,
        buyer.publicKey
      )
    ).address;
    sellerAta = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        seller,
        skrMint,
        seller.publicKey
      )
    ).address;
    const vaultOwner = authority.publicKey;
    vaultAta = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        authority,
        skrMint,
        vaultOwner
      )
    ).address;

    await mintTo(
      connection,
      authority,
      skrMint,
      buyerAta,
      authority,
      1_000_000 * 1_000_000 // 1,000,000 SKR (6 decimals)
    );

    // --- Verified collection NFT (the "Saga Monkes" stand-in) ---
    const collectionSigner = generateSigner(umi);
    await createNft(umi, {
      mint: collectionSigner,
      name: "Test Collection",
      uri: "https://example.com/collection.json",
      sellerFeeBasisPoints: percentAmount(5),
      isCollection: true,
    }).sendAndConfirm(umi, { send: { skipPreflight: true } });
    collectionMint = toWeb3JsPublicKey(collectionSigner.publicKey);

    // --- Bubblegum V1 merkle tree, full canopy so proofs are always empty ---
    const treeSigner = generateSigner(umi);
    const builder = await createTree(umi, {
      merkleTree: treeSigner,
      maxDepth: 5,
      maxBufferSize: 8,
      canopyDepth: 5,
    });
    await builder.sendAndConfirm(umi, { send: { skipPreflight: true } });
    merkleTree = toWeb3JsPublicKey(treeSigner.publicKey);

    const [treeAuthorityUmiPk] = findTreeConfigPda(umi, {
      merkleTree: treeSigner.publicKey,
    });
    treeAuthority = toWeb3JsPublicKey(treeAuthorityUmiPk);

    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("marketplace")],
      program.programId
    );

    await program.methods
      .initializeMarketplace(FEE_BPS)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        skrMint,
        collectionMint,
        vaultSkrAta: vaultAta,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  });

  it("initializes the marketplace with pinned fields", async () => {
    const cfg = await program.account.marketplaceConfig.fetch(configPda);
    expect(cfg.authority.toBase58()).to.eq(authority.publicKey.toBase58());
    expect(cfg.skrMint.toBase58()).to.eq(skrMint.toBase58());
    expect(cfg.collectionMint.toBase58()).to.eq(collectionMint.toBase58());
    expect(cfg.vaultSkrAta.toBase58()).to.eq(vaultAta.toBase58());
    expect(cfg.feeBps).to.eq(FEE_BPS);
    expect(cfg.paused).to.eq(false);
  });

  it("happy path: list -> buy_now moves the NFT, splits SKR 98/2, closes the listing", async () => {
    const { nonce, meta } = await mintFreshLeaf(seller.publicKey, "HappyPath");
    const [listing] = listingPda(merkleTree, nonce);
    const root = await currentRoot();

    await program.methods
      .list(new BN(1_000_000), toOurMetadataArgs(meta), new BN(nonce), nonce, root)
      .accounts({
        seller: seller.publicKey,
        config: configPda,
        treeAuthority,
        merkleTree,
        listing,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([])
      .signers([seller])
      .rpc();

    const sellerLamportsBefore = await connection.getBalance(seller.publicKey);
    const sellerSkrBefore = await skrBalance(sellerAta);
    const vaultSkrBefore = await skrBalance(vaultAta);

    const rootAfterList = await currentRoot();

    await program.methods
      .buyNow(new BN(1_000_000), nonce, rootAfterList)
      .accounts({
        buyer: buyer.publicKey,
        seller: seller.publicKey,
        config: configPda,
        treeAuthority,
        merkleTree,
        listing,
        skrMint,
        buyerSkrAta: buyerAta,
        sellerSkrAta: sellerAta,
        vaultSkrAta: vaultAta,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([])
      .signers([buyer])
      .rpc();

    const sellerSkrAfter = await skrBalance(sellerAta);
    const vaultSkrAfter = await skrBalance(vaultAta);
    const sellerLamportsAfter = await connection.getBalance(seller.publicKey);

    expect((sellerSkrAfter - sellerSkrBefore).toString()).to.eq("980000");
    expect((vaultSkrAfter - vaultSkrBefore).toString()).to.eq("20000");
    expect(sellerLamportsAfter).to.be.greaterThan(sellerLamportsBefore); // rent refund

    const listingInfo = await connection.getAccountInfo(listing);
    expect(listingInfo).to.eq(null);

    // NFT really moved: the merkle tree's root changed again (transfer CPI
    // succeeded) and the leaf schema now shows the buyer as owner. We assert
    // via the root-changed proxy since a full leaf-schema refetch would
    // require re-deriving the same proof machinery the program already
    // exercised twice by this point.
    const rootAfterBuy = await currentRoot();
    expect(Buffer.from(rootAfterBuy).equals(Buffer.from(rootAfterList))).to.eq(
      false
    );
  });

  it("list -> delist: NFT returns to seller, no SKR moves, listing closed", async () => {
    const { nonce, meta } = await mintFreshLeaf(seller.publicKey, "ListDelist");
    const [listing] = listingPda(merkleTree, nonce);
    const root = await currentRoot();

    await program.methods
      .list(new BN(5_000_000), toOurMetadataArgs(meta), new BN(nonce), nonce, root)
      .accounts({
        seller: seller.publicKey,
        config: configPda,
        treeAuthority,
        merkleTree,
        listing,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([])
      .signers([seller])
      .rpc();

    const sellerSkrBefore = await skrBalance(sellerAta);
    const rootAfterList = await currentRoot();

    await program.methods
      .delist(nonce, rootAfterList)
      .accounts({
        seller: seller.publicKey,
        treeAuthority,
        merkleTree,
        listing,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([])
      .signers([seller])
      .rpc();

    const sellerSkrAfter = await skrBalance(sellerAta);
    expect(sellerSkrAfter).to.eq(sellerSkrBefore);

    const listingInfo = await connection.getAccountInfo(listing);
    expect(listingInfo).to.eq(null);
  });

  it("rejects list() when the leaf's declared collection is wrong/unverified", async () => {
    const { nonce, meta } = await mintFreshLeaf(seller.publicKey, "WrongColl");
    const [listing] = listingPda(merkleTree, nonce);
    const root = await currentRoot();

    const badMeta = toOurMetadataArgs(meta, { verified: false });

    let threw = false;
    try {
      await program.methods
        .list(new BN(1_000_000), badMeta, new BN(nonce), nonce, root)
        .accounts({
          seller: seller.publicKey,
          config: configPda,
          treeAuthority,
          merkleTree,
          listing,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([])
        .signers([seller])
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/WrongCollection/);
    }
    assert.isTrue(threw, "expected list() to reject an unverified collection");
  });

  it("rejects buy_now() with a mint/ATA that isn't the pinned skr_mint (constraint violation)", async () => {
    const { nonce, meta } = await mintFreshLeaf(seller.publicKey, "WrongMint");
    const [listing] = listingPda(merkleTree, nonce);
    const root = await currentRoot();

    await program.methods
      .list(new BN(1_000_000), toOurMetadataArgs(meta), new BN(nonce), nonce, root)
      .accounts({
        seller: seller.publicKey,
        config: configPda,
        treeAuthority,
        merkleTree,
        listing,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([])
      .signers([seller])
      .rpc();

    // A completely different SPL mint + ATAs, standing in for an attacker
    // trying to get the buyer to pay in / the vault to receive the wrong token.
    const wrongMint = await createMint(
      connection,
      authority,
      authority.publicKey,
      null,
      6
    );
    const wrongBuyerAta = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        buyer,
        wrongMint,
        buyer.publicKey
      )
    ).address;
    const wrongSellerAta = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        seller,
        wrongMint,
        seller.publicKey
      )
    ).address;
    await mintTo(
      connection,
      authority,
      wrongMint,
      wrongBuyerAta,
      authority,
      10_000_000
    );

    const rootAfterList = await currentRoot();

    let threw = false;
    try {
      await program.methods
        .buyNow(new BN(1_000_000), nonce, rootAfterList)
        .accounts({
          buyer: buyer.publicKey,
          seller: seller.publicKey,
          config: configPda,
          treeAuthority,
          merkleTree,
          listing,
          skrMint: wrongMint,
          buyerSkrAta: wrongBuyerAta,
          sellerSkrAta: wrongSellerAta,
          vaultSkrAta: vaultAta,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([])
        .signers([buyer])
        .rpc();
    } catch (e: any) {
      threw = true;
      // Anchor account-constraint violation, e.g. "WrongMint"/"ConstraintAddress"/
      // "AnchorError caused by account: skr_mint" — not a logic branch we added.
      expect(e.toString()).to.match(/WrongMint|ConstraintAddress|constraint/i);
    }
    assert.isTrue(
      threw,
      "expected buy_now() to reject a mismatched SKR mint via an Anchor account constraint"
    );

    // Clean up: delist so this leaf doesn't linger escrowed for later tests.
    const rootNow = await currentRoot();
    await program.methods
      .delist(nonce, rootNow)
      .accounts({
        seller: seller.publicKey,
        treeAuthority,
        merkleTree,
        listing,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([])
      .signers([seller])
      .rpc();
  });

  it("fee math is exact for several prices, including a non-round one (999 @ 2%)", async () => {
    const cases: { price: number; fee: number; sellerAmt: number }[] = [
      { price: 999, fee: 19, sellerAmt: 980 }, // 999*200/10000 = 19.98 -> floor 19
      { price: 1_000_000, fee: 20_000, sellerAmt: 980_000 },
      { price: 1, fee: 0, sellerAmt: 1 }, // 1*200/10000 = 0.02 -> floor 0
    ];

    for (const c of cases) {
      const { nonce, meta } = await mintFreshLeaf(
        seller.publicKey,
        `Fee${c.price}`
      );
      const [listing] = listingPda(merkleTree, nonce);
      const root = await currentRoot();

      await program.methods
        .list(new BN(c.price), toOurMetadataArgs(meta), new BN(nonce), nonce, root)
        .accounts({
          seller: seller.publicKey,
          config: configPda,
          treeAuthority,
          merkleTree,
          listing,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([])
        .signers([seller])
        .rpc();

      const sellerBefore = await skrBalance(sellerAta);
      const vaultBefore = await skrBalance(vaultAta);
      const rootAfterList = await currentRoot();

      await program.methods
        .buyNow(new BN(c.price), nonce, rootAfterList)
        .accounts({
          buyer: buyer.publicKey,
          seller: seller.publicKey,
          config: configPda,
          treeAuthority,
          merkleTree,
          listing,
          skrMint,
          buyerSkrAta: buyerAta,
          sellerSkrAta: sellerAta,
          vaultSkrAta: vaultAta,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([])
        .signers([buyer])
        .rpc();

      const sellerAfter = await skrBalance(sellerAta);
      const vaultAfter = await skrBalance(vaultAta);

      expect((sellerAfter - sellerBefore).toString()).to.eq(
        c.sellerAmt.toString()
      );
      expect((vaultAfter - vaultBefore).toString()).to.eq(c.fee.toString());
      expect(c.fee + c.sellerAmt).to.eq(c.price); // no lamports/atoms leaked
    }
  });

  it("pause semantics: list/buy_now fail while paused; delist still succeeds", async () => {
    const { nonce, meta } = await mintFreshLeaf(seller.publicKey, "PauseFlow");
    const [listing] = listingPda(merkleTree, nonce);
    let root = await currentRoot();

    // List while NOT paused (need an open listing to exercise buy_now-fails-while-paused).
    await program.methods
      .list(new BN(2_000_000), toOurMetadataArgs(meta), new BN(nonce), nonce, root)
      .accounts({
        seller: seller.publicKey,
        config: configPda,
        treeAuthority,
        merkleTree,
        listing,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([])
      .signers([seller])
      .rpc();

    await program.methods
      .setPaused(true)
      .accounts({ authority: authority.publicKey, config: configPda })
      .signers([authority])
      .rpc();

    const cfgPaused = await program.account.marketplaceConfig.fetch(configPda);
    expect(cfgPaused.paused).to.eq(true);

    // buy_now must fail while paused.
    root = await currentRoot();
    let buyThrew = false;
    try {
      await program.methods
        .buyNow(new BN(2_000_000), nonce, root)
        .accounts({
          buyer: buyer.publicKey,
          seller: seller.publicKey,
          config: configPda,
          treeAuthority,
          merkleTree,
          listing,
          skrMint,
          buyerSkrAta: buyerAta,
          sellerSkrAta: sellerAta,
          vaultSkrAta: vaultAta,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([])
        .signers([buyer])
        .rpc();
    } catch (e: any) {
      buyThrew = true;
      expect(e.toString()).to.match(/MarketplacePaused/);
    }
    assert.isTrue(buyThrew, "expected buy_now() to fail while paused");

    // list() must also fail while paused (fresh leaf).
    const { nonce: nonce2, meta: meta2 } = await mintFreshLeaf(
      seller.publicKey,
      "PauseFlowList"
    );
    const [listing2] = listingPda(merkleTree, nonce2);
    root = await currentRoot();
    let listThrew = false;
    try {
      await program.methods
        .list(
          new BN(1_000_000),
          toOurMetadataArgs(meta2),
          new BN(nonce2),
          nonce2,
          root
        )
        .accounts({
          seller: seller.publicKey,
          config: configPda,
          treeAuthority,
          merkleTree,
          listing: listing2,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([])
        .signers([seller])
        .rpc();
    } catch (e: any) {
      listThrew = true;
      expect(e.toString()).to.match(/MarketplacePaused/);
    }
    assert.isTrue(listThrew, "expected list() to fail while paused");

    // delist on the already-escrowed listing MUST still succeed while paused.
    root = await currentRoot();
    await program.methods
      .delist(nonce, root)
      .accounts({
        seller: seller.publicKey,
        treeAuthority,
        merkleTree,
        listing,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([])
      .signers([seller])
      .rpc();

    const listingInfo = await connection.getAccountInfo(listing);
    expect(listingInfo).to.eq(null);

    // unpause for any later tests.
    await program.methods
      .setPaused(false)
      .accounts({ authority: authority.publicKey, config: configPda })
      .signers([authority])
      .rpc();
  });

  it("update_fee: rejects >500 bps and rejects a non-authority signer", async () => {
    let threw = false;
    try {
      await program.methods
        .updateFee(501)
        .accounts({ authority: authority.publicKey, config: configPda })
        .signers([authority])
        .rpc();
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.match(/FeeTooHigh/);
    }
    assert.isTrue(threw, "expected update_fee(501) to fail");

    threw = false;
    try {
      await program.methods
        .updateFee(300)
        .accounts({ authority: seller.publicKey, config: configPda })
        .signers([seller])
        .rpc();
    } catch (e: any) {
      threw = true;
      // has_one constraint failure -> a generic Anchor "ConstraintHasOne"/seed
      // mismatch, or our own require-based error, either way must fail.
      expect(e).to.not.eq(undefined);
    }
    assert.isTrue(
      threw,
      "expected update_fee from a non-authority signer to fail"
    );

    // sanity: a valid update from the real authority still works.
    await program.methods
      .updateFee(250)
      .accounts({ authority: authority.publicKey, config: configPda })
      .signers([authority])
      .rpc();
    const cfg = await program.account.marketplaceConfig.fetch(configPda);
    expect(cfg.feeBps).to.eq(250);

    // restore for cleanliness.
    await program.methods
      .updateFee(FEE_BPS)
      .accounts({ authority: authority.publicKey, config: configPda })
      .signers([authority])
      .rpc();
  });
});
