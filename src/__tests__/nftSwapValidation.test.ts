/**
 * @jest-environment node
 * @jest-environment-options {"customExportConditions": ["node", "require", "default"]}
 */
jest.mock("rpc-websockets", () => ({ CommonClient: class {}, WebSocket: class {} }));
jest.mock("@solana-mobile/mobile-wallet-adapter-protocol-web3js", () => ({ transact: jest.fn() }));
jest.mock("@/lib/security", () => ({ assertDeviceTrusted: () => {} }));
jest.mock("@/lib/constants", () => ({
  HELIUS_RPC_URL: "https://example.invalid", HELIUS_API_KEY: "", DEV_WALLET: "11111111111111111111111111111111",
  NFT_SALE_FEE_PCT: 0.02, SKR_MINT: "11111111111111111111111111111111", MONKE_LEDGER_URL: "https://example.invalid",
}));
jest.mock("@/store/appStore", () => ({ useAppStore: { getState: () => ({ wallet: null }) } }));
jest.mock("@/lib/solana", () => ({ fetchSolPriceUsd: jest.fn(), fetchSkrPriceUsd: jest.fn() }));

import { Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  createApproveInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createTransferInstruction } from "@metaplex-foundation/mpl-bubblegum";
import { checkSwapInstructions, type SwapParties } from "@/lib/nftSwap";
import { swapMatchesMyBid, addListing, recordHistoryEntry, BID_EXPIRY_MS, type NftSwapMessage } from "@/lib/marketplace";

const pk = () => Keypair.generate().publicKey;
const buyer = pk();
const seller = pk();
const dev = pk();
const skrMint = pk();
const attacker = pk();
const DECIMALS = 6;
const TOTAL = 100 * 10 ** DECIMALS;
const FEE = TOTAL * 0.02;
const parties: SwapParties = { buyer, seller, dev, skrMint, expectedBaseUnits: TOTAL };
const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(skrMint, owner);

function nftTransfer(from: PublicKey, to: PublicKey): TransactionInstruction {
  const ix = createTransferInstruction(
    {
      treeAuthority: pk(),
      leafOwner: from,
      leafDelegate: from,
      newLeafOwner: to,
      merkleTree: pk(),
      logWrapper: pk(),
      compressionProgram: pk(),
      anchorRemainingAccounts: [{ pubkey: pk(), isSigner: false, isWritable: false }],
    },
    { root: Array(32).fill(1), dataHash: Array(32).fill(2), creatorHash: Array(32).fill(3), nonce: 1, index: 1 },
  );
  for (const k of ix.keys) if (k.pubkey.equals(from)) k.isSigner = true;
  return ix;
}

const createAta = (owner: PublicKey, payer = buyer) =>
  createAssociatedTokenAccountIdempotentInstruction(payer, ata(owner), owner, skrMint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
const pay = (to: PublicKey, amount: number) =>
  createTransferCheckedInstruction(ata(buyer), skrMint, ata(to), buyer, amount, DECIMALS, [], TOKEN_PROGRAM_ID);

function goodIxs(): TransactionInstruction[] {
  return [
    nftTransfer(seller, buyer),
    createAta(buyer),
    createAta(seller),
    createAta(dev),
    pay(seller, TOTAL - FEE),
    pay(dev, FEE),
  ];
}

function tx(ixs: TransactionInstruction[], feePayer = buyer): Transaction {
  const t = new Transaction({ recentBlockhash: pk().toBase58(), feePayer });
  t.add(...ixs);
  return t;
}

/** The good transaction with one ATA-create slot swapped for something else. */
const withSlot = (ix: TransactionInstruction) => {
  const ixs = goodIxs();
  ixs[3] = ix;
  return tx(ixs);
};

describe("checkSwapInstructions — buyer only signs what the swap is", () => {
  it("accepts the transaction buildSwapTransaction writes", () => {
    expect(checkSwapInstructions(tx(goodIxs()), parties)).toBeNull();
  });

  it("accepts it in any order", () => {
    expect(checkSwapInstructions(tx(goodIxs().reverse()), parties)).toBeNull();
  });

  it("rejects a SOL transfer from the buyer in a spare slot", () => {
    const drain = SystemProgram.transfer({ fromPubkey: buyer, toPubkey: attacker, lamports: 5e9 });
    expect(checkSwapInstructions(withSlot(drain), parties)).toMatch(/Unexpected instruction/);
  });

  it("rejects a second NFT transfer that moves the buyer's own cNFT", () => {
    expect(checkSwapInstructions(withSlot(nftTransfer(buyer, attacker)), parties)).not.toBeNull();
  });

  it("rejects an SKR approve to another wallet", () => {
    const approve = createApproveInstruction(ata(buyer), attacker, buyer, 1e15, [], TOKEN_PROGRAM_ID);
    expect(checkSwapInstructions(withSlot(approve), parties)).toMatch(/Unexpected token instruction/);
  });

  it("rejects a token account for someone else", () => {
    expect(checkSwapInstructions(withSlot(createAta(attacker)), parties)).toMatch(/not for the buyer, seller/);
  });

  it("rejects a token account paid by someone other than the buyer", () => {
    expect(checkSwapInstructions(withSlot(createAta(dev, attacker)), parties)).toMatch(/buyer's SKR account/);
  });

  it("rejects paying the seller twice and skipping the vault fee", () => {
    const ixs = goodIxs();
    ixs[5] = pay(seller, FEE);
    expect(checkSwapInstructions(tx(ixs), parties)).toMatch(/one SKR payment to the seller/);
  });

  it("rejects a price above what the buyer agreed", () => {
    const ixs = goodIxs();
    ixs[4] = pay(seller, TOTAL * 2);
    expect(checkSwapInstructions(tx(ixs), parties)).toMatch(/amount mismatch/);
  });

  it("rejects an extra instruction", () => {
    expect(checkSwapInstructions(tx([...goodIxs(), createAta(dev)]), parties)).toMatch(/instruction count/);
  });

  it("rejects a fee payer other than the buyer", () => {
    expect(checkSwapInstructions(tx(goodIxs(), seller), parties)).toMatch(/Fee payer/);
  });
});

describe("swapMatchesMyBid — a swap must answer a bid I sent", () => {
  const me = "my-inbox";
  const sellerInbox = "seller-inbox";
  const mint = pk().toBase58();
  const sellerWallet = seller.toBase58();
  const myWallet = buyer.toBase58();
  const listingId = `${mint}-1`;
  addListing({ id: listingId, mint, name: "MONKE #1", sellerInboxId: sellerInbox, sellerWallet, askPrice: 120, listedAt: Date.now() });
  recordHistoryEntry({ type: "bid", nftName: "MONKE #1", price: 100, timestamp: Date.now(), counterparty: "seller", mint });

  const swap = (over: Partial<NftSwapMessage> = {}): NftSwapMessage => ({
    listingId, sellerInboxId: sellerInbox, buyerInboxId: me, mint, skrPrice: 100,
    sellerWallet, buyerWallet: myWallet, serializedTx: "", createdAt: Date.now(), ...over,
  });

  it("accepts the seller's swap for my bid", () => {
    expect(swapMatchesMyBid(swap(), sellerInbox, me, myWallet)).toBe(true);
  });

  it("rejects a swap from someone who isn't the listing's seller", () => {
    expect(swapMatchesMyBid(swap({ sellerInboxId: "stranger" }), "stranger", me, myWallet)).toBe(false);
  });

  it("rejects a price I never bid", () => {
    expect(swapMatchesMyBid(swap({ skrPrice: 1000 }), sellerInbox, me, myWallet)).toBe(false);
  });

  it("rejects a different NFT or seller wallet than the listing", () => {
    expect(swapMatchesMyBid(swap({ mint: pk().toBase58() }), sellerInbox, me, myWallet)).toBe(false);
    expect(swapMatchesMyBid(swap({ sellerWallet: attacker.toBase58() }), sellerInbox, me, myWallet)).toBe(false);
  });

  it("rejects a swap paying out to another wallet", () => {
    expect(swapMatchesMyBid(swap({ buyerWallet: attacker.toBase58() }), sellerInbox, me, myWallet)).toBe(false);
  });

  it("rejects a bid older than the bid window", () => {
    expect(swapMatchesMyBid(swap(), sellerInbox, me, myWallet, Date.now() + BID_EXPIRY_MS + 1)).toBe(false);
  });
});
