// ─── Wallet ───────────────────────────────────────────────────────────────────

export interface WalletAccount {
  address: string;
  label?: string;
  chains?: string[];
  features?: string[];
}

// ─── NFT ──────────────────────────────────────────────────────────────────────

export interface NftTrait {
  trait_type: string;
  value: string;
}

export interface OwnedNFT {
  mint: string;
  name: string;
  symbol: string;
  image: string | null;
  collectionMint: string;
  traits?: NftTrait[];
}

export interface NFTVerificationResult {
  verified: boolean;
  nft: OwnedNFT | null;
  allNfts?: OwnedNFT[];   // all collection NFTs found in wallet
  error?: string;
  /**
   * True when `verified: false` is because every provider errored/timed out
   * (Helius + Shyft both down/rate-limited), NOT because the wallet was
   * confirmed to hold zero collection NFTs. Callers that would otherwise
   * force-logout or reject on `!verified` MUST check this first — treating
   * an outage as "confirmed not a holder" mass-logs-out legitimate users
   * the moment both providers hiccup at once.
   */
  providerError?: boolean;
}

// ─── Messaging ────────────────────────────────────────────────────────────────

export type ReactionEmoji = '👍' | '❤️' | '😂' | '🔥' | '🍌' | '🐒' | '💎' | '🚀';

export interface MessageReaction {
  emoji: ReactionEmoji;
  count: number;
  reactedByMe: boolean;
  reactors: string[];
}

export interface StickerReaction {
  url: string;
  count: number;
  reactedByMe: boolean;
  reactors: string[];
}

export interface ChatMessage {
  id: string;
  senderAddress: string;      // XMTP inboxId
  senderUsername?: string;    // display name, embedded in message
  senderNft?: { mint: string; name: string; image: string | null };
  content: string;
  sentAt: Date;
  reactions: Partial<Record<ReactionEmoji, MessageReaction>>;
  stickerReactions?: StickerReaction[];
  replyTo?: { id: string; content: string; senderAddress: string; senderUsername?: string };
  status?: 'sending' | 'sent' | 'failed' | 'pending' | 'read';
  editedContent?: string;   // if edited, the updated text (original stays in content)
  editedAt?: Date;          // timestamp of edit
}
