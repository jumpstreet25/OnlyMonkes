// ─── Wallet ───────────────────────────────────────────────────────────────────

export interface WalletAccount {
  address: string;
  label?: string;
  chains?: string[];
  features?: string[];
}

// ─── NFT ──────────────────────────────────────────────────────────────────────

export interface OwnedNFT {
  mint: string;
  name: string;
  symbol: string;
  image: string | null;
  collectionMint: string;
}

export interface NFTVerificationResult {
  verified: boolean;
  nft: OwnedNFT | null;
  allNfts?: OwnedNFT[];   // all collection NFTs found in wallet
  error?: string;
}

// ─── Messaging ────────────────────────────────────────────────────────────────

export type ReactionEmoji = '🍌' | '🐒' | '🔥' | '🚀' | '👍';

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
  status?: 'sending' | 'sent' | 'failed' | 'pending';
}
