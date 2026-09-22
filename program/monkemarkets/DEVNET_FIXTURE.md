# Devnet test fixture (2026-09-22)

Created by `scripts/devnetFixture.ts` against `https://api.devnet.solana.com`.
Rerunnable — always creates fresh accounts, never mutates existing ones.

All accounts below are currently owned/controlled by the deploy authority
keypair (`8KmybEbuobMTFxun8Liqn4h8LHBKZr5ueRD3TKt5wFX8`) — nothing has been
transferred to a real user wallet yet. That's the remaining step before a
real device (Seeker + Solflare, devnet cluster) can run `list → delist →
buy_now` through `MarketplaceOnChainTestScreen.tsx`.

| Field | Value |
|---|---|
| Program ID | `FZfCbVdH9iY7bQNap1b4do52bhYJmiE8u3VSkxvv8euU` |
| SKR mint (devnet test token, 6 decimals) | `EHKG7h3GP46mt6ozyGLxyZL5fhKif7VZBfWcxsr32DyY` |
| Authority's SKR ATA (1,000,000 test supply) | `FyMD6wqbR5TDQNEJgihMsTTQ3hfNvrec5erPKLAqwARV` |
| Collection mint (verified, isCollection: true) | `9X33URyxUtcNPuzWutC5G5fy6a1V4a4CQQznQpkanySJ` |
| Merkle tree (Bubblegum V1, maxDepth=5, maxBufferSize=8, canopyDepth=5 — full canopy, proofs always empty) | `GDARGtop66ZeRN3yE7ApN6aLCGq46cqTyFo8AWj7U63X` |
| Tree authority (Bubblegum TreeConfig PDA) | `A3Dbn8J69By7hQGXsqm483PFSeFXrSpBNsvfbdMR3cJq` |
| Test cNFT leaf nonce/index | `0` |
| Test cNFT data_hash (base58) | `2D17WNpsw2giByGRtY3ugSt9JrrnfiU5q5LpKi8fji3p` |
| Test cNFT creator_hash (base58) | `EKDHSGbrGztomDfuiV4iqiZ6LschDJPsFiXjZ83f92Md` |
| Tree root at fixture creation (base58 — refetch before use, changes on any tree write) | `9PzYs4kab1YaTPyYWETaEiBpTi4WeB4TzrBRy6swDxbE` |
| MarketplaceConfig PDA | `67BA3Y5YxpJQpLrVLHyyJcMiBtmufHfkdC89PRfVFk5P` |

`initialize_marketplace` was called with `fee_bps=200` (2%), `paused=false`,
`vault_skr_ata` = the authority's own SKR ATA above (test-only choice — reuse
the deploy authority as the vault for simplicity, not a design decision for
the real vault).

Data hash / creator hash were computed client-side via
`@metaplex-foundation/mpl-bubblegum`'s `hashMetadataData`/
`hashMetadataCreators` — the same recompute path Rust's `hash_metadata`/
`hash_creators` mirror in `list()`. No devnet DAS/indexer was used or is
needed for this fixture (full canopy tree — proofs are always empty).
