# Devnet test fixture (2026-09-22)

Created by `scripts/devnetFixture.ts` against `https://api.devnet.solana.com`.
Rerunnable — always creates fresh accounts, never mutates existing ones.

**Update 2026-09-22, post-transfer**: the test cNFT (leaf nonce 0) and 10,000
test SKR were transferred from the deploy authority to
`BzyaYyd7ew7SRqC1P9Q6z61ebfYmdXRFU6UfKjHzcQ2o` (the user's own wallet,
confirmed — same address as the publisher/treasury wallet elsewhere in this
project, deliberately reused for devnet testing). Both transfers finalized
and independently re-verified on-chain, not just trusted from the send call:
- cNFT transfer tx: `4Xhg84TBHKjAGfu5QCcQoPtvM3ArhA8YXBEdARXBx7RygUKNusUXeWxNP3o2VZDg2cPWy5e8DEiLUPUEoaMDsBQT`
- SKR transfer tx: `3Nhn63TnmA3fAuWK6cnqauVuNVh8dCGs8MdRFDNdUYWexzhMUzcvLGEuGjVy9JLRjpAP1pQKkp8o6jZbZGM1njJ6` (recipient ATA: `AxqXseTuvjrZGPEeJco3omToK5BJg1am4W3VHL3UGj1z`, balance 10,000.0 test SKR)

**Important**: the cNFT transfer moved the tree's root (any transfer does —
the leaf's own `data_hash`/`creator_hash` are unchanged, but `root` is not).
Current root is `6CjUK2AmFGg5uyegJSDRgnebQN4A9BJweQ6D1brwrzsr`, NOT the
mint-time root in the table below — always refetch the live root from the
`ConcurrentMerkleTreeAccount` before building a `list()`/`delist()` call
against this leaf, never reuse a stale one from this doc.

The deploy authority still holds `vault_skr_ata` and remains
`MarketplaceConfig.authority` — only the leaf and 10,000 test SKR moved.
This sets up a real `list()` test with that wallet as **seller**. It is not
set up for a two-party `buy_now()` test (buyer ≠ seller) — that needs a
second test listing owned by a different address.

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
