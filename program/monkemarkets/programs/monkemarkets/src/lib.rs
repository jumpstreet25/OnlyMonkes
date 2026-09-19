//! MonkeMarkets — Phase 0 devnet PoC.
//!
//! On-chain escrow marketplace for a Bubblegum V1 compressed-NFT collection,
//! settled in a single SPL token ("SKR" on mainnet; a devnet test mint in this
//! Phase 0 harness). Replaces the legacy off-chain List/Delist/Buy-Now XMTP
//! handshake with real on-chain escrow: `list` moves the leaf's on-chain
//! ownership to a program PDA (via a real Bubblegum `transfer` CPI, not just
//! bookkeeping), so a sale can no longer race a stale/double-sold listing.
//!
//! Bids/offers/accept remain on the legacy off-chain path and are entirely
//! out of scope for this program.
//!
//! ## Bubblegum version targeted
//! V1 leaf schema / the `mpl-bubblegum` 1.4.0 Rust crate (kinobi-generated,
//! `solana-program ^1.14`). Saga Monkes were minted in 2022 under Bubblegum
//! V1 — long before the V2 leaf schema existed — so V1 is the correct target
//! for byte-for-byte compatibility with the real collection this eventually
//! ships against. See the crate's own `tests/setup/tree_manager.rs` and
//! `tests/transfer.rs` (extracted and read directly from the published
//! crates.io source, not just docs) for the reference transfer call this
//! program's CPI shape was checked against.
//!
//! ## The PDA-signer risk this file exists to get right
//! `mpl-bubblegum`'s generated Rust `TransferBuilder`/`TransferCpiBuilder`
//! (`src/generated/instructions/transfer.rs`) takes `leaf_owner` and
//! `leaf_delegate` as explicit `(Pubkey, bool)` / `(AccountInfo, bool)`
//! tuples — the caller decides `is_signer`, unlike the legacy JS
//! `@metaplex-foundation/mpl-bubblegum@0.7.0` Solita codegen, which hardcoded
//! every account's `isSigner` to `false` (the bug that motivated this whole
//! review — see the module-level doc in the project brief / final report).
//! For `delist` and `buy_now`, `leaf_owner` is this program's `Listing` PDA,
//! so we pass `is_signer = true` for it and drive the CPI with
//! `invoke_signed` using the `Listing` PDA's own seeds — the PDA's
//! "signature" is provided programmatically by the runtime, not by a real
//! keypair. This is exercised for real (not mocked) by the `happy path` and
//! `list -> delist` integration tests, which fail outright with a Bubblegum
//! program error if the signer flag or seeds are wrong in any way.

use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};
use mpl_bubblegum::hash::{hash_creators, hash_metadata};
use mpl_bubblegum::instructions::TransferCpiBuilder;
use mpl_bubblegum::types::{
    Collection as BgCollection, Creator as BgCreator, MetadataArgs as BgMetadataArgs,
    TokenProgramVersion as BgTokenProgramVersion, TokenStandard as BgTokenStandard,
    UseMethod as BgUseMethod, Uses as BgUses,
};

declare_id!("FZfCbVdH9iY7bQNap1b4do52bhYJmiE8u3VSkxvv8euU");

pub const MARKETPLACE_SEED: &[u8] = b"marketplace";
pub const LISTING_SEED: &[u8] = b"listing";
/// Hard cap on `fee_bps`: 500 bps = 5%. Enforced in both `initialize_marketplace`
/// and `update_fee` — never adjustable, only the running value below the cap is.
pub const MAX_FEE_BPS: u16 = 500;

/// Bubblegum program. Fixed address, identical on mainnet-beta and devnet.
pub mod bubblegum_program_id {
    anchor_lang::declare_id!("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
}
/// SPL Account Compression program. Fixed address, identical on mainnet-beta and devnet.
pub mod spl_account_compression_id {
    anchor_lang::declare_id!("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
}
/// SPL Noop ("log wrapper") program. Fixed address, identical on mainnet-beta and devnet.
pub mod spl_noop_id {
    anchor_lang::declare_id!("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");
}

#[program]
pub mod monkemarkets {
    use super::*;

    /// One-time setup. Pins `skr_mint`, `collection_mint`, and `vault_skr_ata`
    /// forever — there is deliberately no instruction anywhere in this program
    /// that can change them after this call returns.
    pub fn initialize_marketplace(
        ctx: Context<InitializeMarketplace>,
        fee_bps: u16,
    ) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, MarketError::FeeTooHigh);

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.skr_mint = ctx.accounts.skr_mint.key();
        config.collection_mint = ctx.accounts.collection_mint.key();
        config.vault_skr_ata = ctx.accounts.vault_skr_ata.key();
        config.fee_bps = fee_bps;
        config.paused = false;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Authority-only. Cannot touch `skr_mint` / `collection_mint` /
    /// `vault_skr_ata` — they are not even parameters of this instruction.
    pub fn update_fee(ctx: Context<UpdateFee>, new_fee_bps: u16) -> Result<()> {
        require!(new_fee_bps <= MAX_FEE_BPS, MarketError::FeeTooHigh);
        ctx.accounts.config.fee_bps = new_fee_bps;
        Ok(())
    }

    /// Authority-only. Gates `list` + `buy_now` only — never `delist`.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    /// Seller-signed. Verifies the leaf's declared collection against the
    /// pinned `config.collection_mint`, re-derives `data_hash`/`creator_hash`
    /// from the caller-supplied `MetadataArgs` itself (never trusts a
    /// caller-supplied hash), and CPIs into Bubblegum's real `transfer` with
    /// `leaf_owner = seller` (a genuine transaction signer) to move the leaf
    /// into escrow at the `Listing` PDA.
    pub fn list<'info>(
        ctx: Context<'_, '_, '_, 'info, List<'info>>,
        price: u64,
        metadata_args: ListMetadataArgs,
        nonce: u64,
        index: u32,
        root: [u8; 32],
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, MarketError::MarketplacePaused);
        require!(price > 0, MarketError::ZeroPrice);

        require_keys_eq!(
            *ctx.accounts.merkle_tree.owner,
            spl_account_compression_id::ID,
            MarketError::BadTreeOwner
        );

        let (expected_tree_authority, _) = Pubkey::find_program_address(
            &[ctx.accounts.merkle_tree.key().as_ref()],
            &bubblegum_program_id::ID,
        );
        require_keys_eq!(
            ctx.accounts.tree_authority.key(),
            expected_tree_authority,
            MarketError::BadTreeConfig
        );

        let bg_metadata = metadata_args.to_bubblegum();
        match &bg_metadata.collection {
            Some(c) if c.verified && c.key == ctx.accounts.config.collection_mint => {}
            _ => return err!(MarketError::WrongCollection),
        }

        let data_hash =
            hash_metadata(&bg_metadata).map_err(|_| error!(MarketError::MathOverflow))?;
        let creator_hash = hash_creators(&bg_metadata.creators);

        // CPI first (leaf_owner = seller, a real signer — no invoke_signed needed here).
        let remaining: Vec<(&AccountInfo<'info>, bool, bool)> = ctx
            .remaining_accounts
            .iter()
            .map(|a| (a, false, false))
            .collect();

        TransferCpiBuilder::new(&ctx.accounts.bubblegum_program.to_account_info())
            .tree_config(&ctx.accounts.tree_authority.to_account_info())
            .leaf_owner(&ctx.accounts.seller.to_account_info(), true)
            .leaf_delegate(&ctx.accounts.seller.to_account_info(), false)
            .new_leaf_owner(&ctx.accounts.listing.to_account_info())
            .merkle_tree(&ctx.accounts.merkle_tree.to_account_info())
            .log_wrapper(&ctx.accounts.log_wrapper.to_account_info())
            .compression_program(&ctx.accounts.compression_program.to_account_info())
            .system_program(&ctx.accounts.system_program.to_account_info())
            .root(root)
            .data_hash(data_hash)
            .creator_hash(creator_hash)
            .nonce(nonce)
            .index(index)
            .add_remaining_accounts(&remaining)
            .invoke()?;

        let listing = &mut ctx.accounts.listing;
        listing.seller = ctx.accounts.seller.key();
        listing.merkle_tree = ctx.accounts.merkle_tree.key();
        listing.leaf_id = nonce;
        listing.data_hash = data_hash;
        listing.creator_hash = creator_hash;
        listing.price = price;
        listing.listed_at = Clock::get()?.unix_timestamp;
        listing.bump = ctx.bumps.listing;

        Ok(())
    }

    /// Seller-signed, works regardless of `config.paused`. CPIs Bubblegum's
    /// `transfer` back to the seller with `leaf_owner = Listing PDA`, signed
    /// via `invoke_signed` using the `Listing`'s own seeds. Closes `Listing`,
    /// rent -> seller.
    pub fn delist<'info>(
        ctx: Context<'_, '_, '_, 'info, Delist<'info>>,
        index: u32,
        root: [u8; 32],
    ) -> Result<()> {
        let (expected_tree_authority, _) = Pubkey::find_program_address(
            &[ctx.accounts.merkle_tree.key().as_ref()],
            &bubblegum_program_id::ID,
        );
        require_keys_eq!(
            ctx.accounts.tree_authority.key(),
            expected_tree_authority,
            MarketError::BadTreeConfig
        );

        let merkle_tree_key = ctx.accounts.merkle_tree.key();
        let nonce = ctx.accounts.listing.leaf_id;
        let data_hash = ctx.accounts.listing.data_hash;
        let creator_hash = ctx.accounts.listing.creator_hash;
        let bump = ctx.accounts.listing.bump;
        let nonce_bytes = nonce.to_le_bytes();
        let bump_bytes = [bump];
        let seeds: &[&[u8]] = &[
            LISTING_SEED,
            merkle_tree_key.as_ref(),
            &nonce_bytes,
            &bump_bytes,
        ];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        let listing_ai = ctx.accounts.listing.to_account_info();
        let remaining: Vec<(&AccountInfo<'info>, bool, bool)> = ctx
            .remaining_accounts
            .iter()
            .map(|a| (a, false, false))
            .collect();

        TransferCpiBuilder::new(&ctx.accounts.bubblegum_program.to_account_info())
            .tree_config(&ctx.accounts.tree_authority.to_account_info())
            .leaf_owner(&listing_ai, true)
            .leaf_delegate(&listing_ai, false)
            .new_leaf_owner(&ctx.accounts.seller.to_account_info())
            .merkle_tree(&ctx.accounts.merkle_tree.to_account_info())
            .log_wrapper(&ctx.accounts.log_wrapper.to_account_info())
            .compression_program(&ctx.accounts.compression_program.to_account_info())
            .system_program(&ctx.accounts.system_program.to_account_info())
            .root(root)
            .data_hash(data_hash)
            .creator_hash(creator_hash)
            .nonce(nonce)
            .index(index)
            .add_remaining_accounts(&remaining)
            .invoke_signed(signer_seeds)?;

        Ok(())
    }

    /// Buyer-signed. `expected_price` is only a client slippage guard —
    /// the real charged amount always comes from `listing.price`. Splits
    /// payment via two `transfer_checked` CPIs (both hard-constrained to
    /// `config.skr_mint` at the account level, not just checked in code),
    /// then CPIs Bubblegum's `transfer` to the buyer with the `Listing` PDA
    /// signing via `invoke_signed`, exactly as in `delist`.
    pub fn buy_now<'info>(
        ctx: Context<'_, '_, '_, 'info, BuyNow<'info>>,
        expected_price: u64,
        index: u32,
        root: [u8; 32],
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, MarketError::MarketplacePaused);

        let price = ctx.accounts.listing.price;
        require!(price > 0, MarketError::ZeroPrice);
        require!(expected_price == price, MarketError::PriceMismatch);

        let fee_bps = ctx.accounts.config.fee_bps as u128;
        let price_u128 = price as u128;
        let fee_u128 = price_u128
            .checked_mul(fee_bps)
            .ok_or(MarketError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(MarketError::MathOverflow)?;
        let fee: u64 = u64::try_from(fee_u128).map_err(|_| MarketError::MathOverflow)?;
        let seller_amount = price.checked_sub(fee).ok_or(MarketError::MathOverflow)?;

        let decimals = ctx.accounts.skr_mint.decimals;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_skr_ata.to_account_info(),
                    mint: ctx.accounts.skr_mint.to_account_info(),
                    to: ctx.accounts.seller_skr_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            seller_amount,
            decimals,
        )?;

        if fee > 0 {
            transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.buyer_skr_ata.to_account_info(),
                        mint: ctx.accounts.skr_mint.to_account_info(),
                        to: ctx.accounts.vault_skr_ata.to_account_info(),
                        authority: ctx.accounts.buyer.to_account_info(),
                    },
                ),
                fee,
                decimals,
            )?;
        }

        let (expected_tree_authority, _) = Pubkey::find_program_address(
            &[ctx.accounts.merkle_tree.key().as_ref()],
            &bubblegum_program_id::ID,
        );
        require_keys_eq!(
            ctx.accounts.tree_authority.key(),
            expected_tree_authority,
            MarketError::BadTreeConfig
        );

        let merkle_tree_key = ctx.accounts.merkle_tree.key();
        let nonce = ctx.accounts.listing.leaf_id;
        let data_hash = ctx.accounts.listing.data_hash;
        let creator_hash = ctx.accounts.listing.creator_hash;
        let bump = ctx.accounts.listing.bump;
        let nonce_bytes = nonce.to_le_bytes();
        let bump_bytes = [bump];
        let seeds: &[&[u8]] = &[
            LISTING_SEED,
            merkle_tree_key.as_ref(),
            &nonce_bytes,
            &bump_bytes,
        ];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        let listing_ai = ctx.accounts.listing.to_account_info();
        let remaining: Vec<(&AccountInfo<'info>, bool, bool)> = ctx
            .remaining_accounts
            .iter()
            .map(|a| (a, false, false))
            .collect();

        TransferCpiBuilder::new(&ctx.accounts.bubblegum_program.to_account_info())
            .tree_config(&ctx.accounts.tree_authority.to_account_info())
            .leaf_owner(&listing_ai, true)
            .leaf_delegate(&listing_ai, false)
            .new_leaf_owner(&ctx.accounts.buyer.to_account_info())
            .merkle_tree(&ctx.accounts.merkle_tree.to_account_info())
            .log_wrapper(&ctx.accounts.log_wrapper.to_account_info())
            .compression_program(&ctx.accounts.compression_program.to_account_info())
            .system_program(&ctx.accounts.system_program.to_account_info())
            .root(root)
            .data_hash(data_hash)
            .creator_hash(creator_hash)
            .nonce(nonce)
            .index(index)
            .add_remaining_accounts(&remaining)
            .invoke_signed(signer_seeds)?;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts (state)
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct MarketplaceConfig {
    pub authority: Pubkey,
    pub skr_mint: Pubkey,
    pub collection_mint: Pubkey,
    pub vault_skr_ata: Pubkey,
    pub fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Listing {
    pub seller: Pubkey,
    pub merkle_tree: Pubkey,
    pub leaf_id: u64,
    pub data_hash: [u8; 32],
    pub creator_hash: [u8; 32],
    pub price: u64,
    pub listed_at: i64,
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Instruction argument types
//
// These deliberately do NOT reuse `mpl_bubblegum::types::MetadataArgs`
// directly as an instruction argument: anchor-lang 0.30's AnchorSerialize /
// AnchorDeserialize are borsh 1.x, while mpl-bubblegum 1.4.0's generated
// types derive borsh 0.10's traits (a different, non-interoperable trait
// even though both crates are called "borsh"). Using bubblegum's struct here
// directly would either fail to compile against the `#[program]` macro's
// argument bound, or silently pull in a second incompatible borsh major
// version. Instead we mirror the shape with our own AnchorSerialize /
// AnchorDeserialize types and convert field-by-field into a real
// `mpl_bubblegum::types::MetadataArgs` inside the handler before calling
// `hash_metadata` / `hash_creators` — there is no wire-format dependency
// between the two, only a logical one, so this sidesteps the version clash
// cleanly.
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ArgCreator {
    pub address: Pubkey,
    pub verified: bool,
    pub share: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ArgCollection {
    pub verified: bool,
    pub key: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ArgTokenProgramVersion {
    Original,
    Token2022,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ArgTokenStandard {
    NonFungible,
    FungibleAsset,
    Fungible,
    NonFungibleEdition,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ArgUseMethod {
    Burn,
    Multiple,
    Single,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ArgUses {
    pub use_method: ArgUseMethod,
    pub remaining: u64,
    pub total: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ListMetadataArgs {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub seller_fee_basis_points: u16,
    pub primary_sale_happened: bool,
    pub is_mutable: bool,
    pub edition_nonce: Option<u8>,
    pub token_standard: Option<ArgTokenStandard>,
    pub collection: Option<ArgCollection>,
    pub uses: Option<ArgUses>,
    pub token_program_version: ArgTokenProgramVersion,
    pub creators: Vec<ArgCreator>,
}

impl ListMetadataArgs {
    fn to_bubblegum(&self) -> BgMetadataArgs {
        BgMetadataArgs {
            name: self.name.clone(),
            symbol: self.symbol.clone(),
            uri: self.uri.clone(),
            seller_fee_basis_points: self.seller_fee_basis_points,
            primary_sale_happened: self.primary_sale_happened,
            is_mutable: self.is_mutable,
            edition_nonce: self.edition_nonce,
            token_standard: self.token_standard.map(|t| match t {
                ArgTokenStandard::NonFungible => BgTokenStandard::NonFungible,
                ArgTokenStandard::FungibleAsset => BgTokenStandard::FungibleAsset,
                ArgTokenStandard::Fungible => BgTokenStandard::Fungible,
                ArgTokenStandard::NonFungibleEdition => BgTokenStandard::NonFungibleEdition,
            }),
            collection: self.collection.as_ref().map(|c| BgCollection {
                verified: c.verified,
                key: c.key,
            }),
            uses: self.uses.as_ref().map(|u| BgUses {
                use_method: match u.use_method {
                    ArgUseMethod::Burn => BgUseMethod::Burn,
                    ArgUseMethod::Multiple => BgUseMethod::Multiple,
                    ArgUseMethod::Single => BgUseMethod::Single,
                },
                remaining: u.remaining,
                total: u.total,
            }),
            token_program_version: match self.token_program_version {
                ArgTokenProgramVersion::Original => BgTokenProgramVersion::Original,
                ArgTokenProgramVersion::Token2022 => BgTokenProgramVersion::Token2022,
            },
            creators: self
                .creators
                .iter()
                .map(|c| BgCreator {
                    address: c.address,
                    verified: c.verified,
                    share: c.share,
                })
                .collect(),
        }
    }
}

// ---------------------------------------------------------------------------
// Accounts contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeMarketplace<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + MarketplaceConfig::INIT_SPACE,
        seeds = [MARKETPLACE_SEED],
        bump,
    )]
    pub config: Account<'info, MarketplaceConfig>,

    pub skr_mint: Account<'info, Mint>,

    /// CHECK: only ever compared by pubkey against a leaf's declared
    /// `MetadataArgs.collection.key` at `list` time. A Metaplex
    /// verified-collection NFT mint; never deserialized on-chain here.
    pub collection_mint: UncheckedAccount<'info>,

    #[account(
        constraint = vault_skr_ata.mint == skr_mint.key() @ MarketError::VaultMintMismatch
    )]
    pub vault_skr_ata: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateFee<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKETPLACE_SEED],
        bump = config.bump,
        has_one = authority @ MarketError::NotAuthority,
    )]
    pub config: Account<'info, MarketplaceConfig>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKETPLACE_SEED],
        bump = config.bump,
        has_one = authority @ MarketError::NotAuthority,
    )]
    pub config: Account<'info, MarketplaceConfig>,
}

#[derive(Accounts)]
#[instruction(price: u64, metadata_args: ListMetadataArgs, nonce: u64)]
pub struct List<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(seeds = [MARKETPLACE_SEED], bump = config.bump)]
    pub config: Account<'info, MarketplaceConfig>,

    /// CHECK: Bubblegum tree authority PDA; derivation checked in the
    /// handler against `merkle_tree` using Bubblegum's own `[merkle_tree]`
    /// seed scheme (`TreeConfig::find_pda`, verified against the crate's own
    /// source, not assumed).
    pub tree_authority: UncheckedAccount<'info>,

    /// CHECK: the compressed-NFT merkle tree account; ownership checked
    /// against the real SPL Account Compression program id in the handler.
    #[account(mut)]
    pub merkle_tree: UncheckedAccount<'info>,

    #[account(
        init,
        payer = seller,
        space = 8 + Listing::INIT_SPACE,
        seeds = [LISTING_SEED, merkle_tree.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub listing: Account<'info, Listing>,

    /// CHECK: pinned to the real SPL Noop program via the address constraint.
    #[account(address = spl_noop_id::ID)]
    pub log_wrapper: UncheckedAccount<'info>,

    /// CHECK: pinned to the real SPL Account Compression program via the address constraint.
    #[account(address = spl_account_compression_id::ID)]
    pub compression_program: UncheckedAccount<'info>,

    /// CHECK: pinned to the real Bubblegum program via the address constraint.
    #[account(address = bubblegum_program_id::ID)]
    pub bubblegum_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Delist<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    /// CHECK: Bubblegum tree authority PDA; derivation checked in the handler.
    pub tree_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub merkle_tree: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [LISTING_SEED, merkle_tree.key().as_ref(), &listing.leaf_id.to_le_bytes()],
        bump = listing.bump,
        has_one = seller @ MarketError::NotSeller,
        close = seller,
    )]
    pub listing: Account<'info, Listing>,

    /// CHECK: pinned to the real SPL Noop program via the address constraint.
    #[account(address = spl_noop_id::ID)]
    pub log_wrapper: UncheckedAccount<'info>,

    /// CHECK: pinned to the real SPL Account Compression program via the address constraint.
    #[account(address = spl_account_compression_id::ID)]
    pub compression_program: UncheckedAccount<'info>,

    /// CHECK: pinned to the real Bubblegum program via the address constraint.
    #[account(address = bubblegum_program_id::ID)]
    pub bubblegum_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyNow<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: rent-refund destination for the closed `Listing`; identity
    /// enforced by the `has_one = seller` constraint on `listing` below.
    /// Never needs to sign — the seller isn't a party to this transaction.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,

    #[account(seeds = [MARKETPLACE_SEED], bump = config.bump)]
    pub config: Account<'info, MarketplaceConfig>,

    /// CHECK: Bubblegum tree authority PDA; derivation checked in the handler.
    pub tree_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub merkle_tree: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [LISTING_SEED, merkle_tree.key().as_ref(), &listing.leaf_id.to_le_bytes()],
        bump = listing.bump,
        has_one = seller @ MarketError::NotSeller,
        close = seller,
    )]
    pub listing: Account<'info, Listing>,

    #[account(address = config.skr_mint @ MarketError::WrongMint)]
    pub skr_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = skr_mint,
        constraint = buyer_skr_ata.owner == buyer.key() @ MarketError::BadTokenAccountOwner,
    )]
    pub buyer_skr_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = skr_mint,
        constraint = seller_skr_ata.owner == listing.seller @ MarketError::BadTokenAccountOwner,
    )]
    pub seller_skr_ata: Account<'info, TokenAccount>,

    #[account(mut, address = config.vault_skr_ata @ MarketError::WrongVault)]
    pub vault_skr_ata: Account<'info, TokenAccount>,

    /// CHECK: pinned to the real SPL Noop program via the address constraint.
    #[account(address = spl_noop_id::ID)]
    pub log_wrapper: UncheckedAccount<'info>,

    /// CHECK: pinned to the real SPL Account Compression program via the address constraint.
    #[account(address = spl_account_compression_id::ID)]
    pub compression_program: UncheckedAccount<'info>,

    /// CHECK: pinned to the real Bubblegum program via the address constraint.
    #[account(address = bubblegum_program_id::ID)]
    pub bubblegum_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum MarketError {
    #[msg("fee_bps exceeds the maximum allowed (500 = 5%)")]
    FeeTooHigh,
    #[msg("caller is not the marketplace authority")]
    NotAuthority,
    #[msg("marketplace is paused")]
    MarketplacePaused,
    #[msg("vault ATA mint does not match skr_mint")]
    VaultMintMismatch,
    #[msg("leaf's collection is not the pinned, verified marketplace collection")]
    WrongCollection,
    #[msg("provided merkle_tree is not owned by the SPL Account Compression program")]
    BadTreeOwner,
    #[msg("provided tree_authority PDA does not match the derived Bubblegum tree authority")]
    BadTreeConfig,
    #[msg("listing price must be greater than zero")]
    ZeroPrice,
    #[msg("arithmetic overflow computing fee/seller split")]
    MathOverflow,
    #[msg("expected_price does not match the listing's on-chain price")]
    PriceMismatch,
    #[msg("signer is not the seller who created this listing")]
    NotSeller,
    #[msg("mint does not match the marketplace's pinned skr_mint")]
    WrongMint,
    #[msg("token account does not match the marketplace's pinned vault_skr_ata")]
    WrongVault,
    #[msg("token account owner does not match the expected party")]
    BadTokenAccountOwner,
}
