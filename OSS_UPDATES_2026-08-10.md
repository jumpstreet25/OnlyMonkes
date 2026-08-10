# OSS Updates Scout — 2026-05-02 → 2026-08-10

Window: ~14 weeks (prior scan was a 7-day window; this one covers the gap ahead of the OnlyMonkes 3.0 app-store submission). Filtered for OnlyMonkes app (now RN 0.81.5 / Expo SDK ^54 / XMTP RN SDK 5.7.0 — **already moved on from the RN 0.79.6/SDK 53 baseline in the May report**) and Monke_Eliza bot (Bun / @xmtp/node-sdk 5.5.0 / Drift / Jupiter / ElizaOS 1.7.2). All versions below were re-verified against the live `package.json` files and the npm registry on 2026-08-10, not assumed from the prior report.

---

## 1. TL;DR — top 7 ranked by "should we do this before submission?"

1. **Helius DAS uptime is a real, measured risk for the NFT-gated login flow — add a fallback tier.** Third-party outage trackers logged **35+ Helius incidents over the trailing 7 months**, including a DAS-specific "Increased DAS latency and 504 errors" event (2026-03-19) and an elevated-503/530 incident on `api.helius.xyz`/`api-mainnet.helius-rpc.com` (2026-04-17). Helius's own open-source **Photon** indexer (`helius-labs/photon`, self-hostable, Postgres or SQLite) implements the same Metaplex DAS spec (`getAsset`, `getAssetsByOwner`, `getAssetProof`) used for the Saga Monke gate — but running it yourself still requires a geyser/gRPC data feed, so it's a load-*shifting* move, not a fully independent one, unless fed from a non-Helius geyser source. **Alchemy now offers DAS support (including `getAssetsByOwner` for compressed NFTs) on a genuinely free 30M CU/month tier** — that's real, vendor-independent redundancy worth wiring in as fallback #2. See §3f.
2. **`helius-laserstream` 0.1.8 → 0.8.0 (bot)** — the bot is pinned to an exact version that is **~10 releases and 7+ months behind** the current 0.8.0 (Aug 3, 2026). Directly touches the user's Helius-load goal: Helius cut streaming credit cost 33% (to ~$100/TB) and widened gRPC access on the Business tier (10 concurrent connections) back in April 2026 — worth confirming the installed laserstream client can actually take advantage of those infra changes, plus picking up 7 months of reconnect/backoff/bugfixes. High priority, needs a changelog read before bumping (exact-pinned, not caret).
3. **`freerasp-react-native` 5.1.1 → 5.2.0 — published literally today (2026-08-10).** Adds Android **bootloader-tampering detection** (`onBootloader()` callback) via Android SDK 19.2.1, plus root/hook/Frida detection hardening and an Android 12+ keystore-detection fix. This is the app's RASP layer per `useFreeRasp()` — trivial patch bump, real security value, take it before the 3.0 build.
4. **`@xmtp/node-sdk` 5.5.0 → 6.1.0 (bot) — breaking change, needs a test pass, not a drive-by bump.** 6.0.0 (the last major) removed automatic history-sync-on-init; the bot must now explicitly call `sendSyncRequest()` after client creation or new installations silently stop syncing history. New archive-based backup APIs (`createArchive`/`importArchive`) ship alongside it. Bot is pinned to an **exact** `5.5.0` (not `^5.5.0`), so this won't auto-resolve — it's a deliberate, tracked upgrade.
5. **Expo/RN track has moved a lot since May — plan the *next* hop, not the whole ladder.** App already jumped RN 0.79.6→0.81.5 / SDK 53→54 sometime in this window (confirmed via current `package.json`, not assumed). Since then: **SDK 55 (Feb 2026, RN 0.83), SDK 56 (May 2026), SDK 57 (Jun 2026, RN 0.86)** all shipped. SDK 57 is explicitly billed by Expo as "the easiest upgrade ever" (RN 0.85→0.86, no public-API breaking changes) — but that's the *last* hop, not the one from where the app sits today. Given this app's documented build fragility (NDK/Gradle/Kotlin pinning, R8 disabled, SoLoader merged-mapping requirement — all in CLAUDE.md), recommend targeting **SDK 55 or 56** as the pre-3.0 step and parking 57 for the next cycle. Each hop is a native rebuild, not an OTA-safe bump — per the existing OTA/native-version-mismatch lesson, do not attempt to ship any of this as an OTA update to already-installed binaries.
6. **Drift SDK has now been stalled for 3+ months (last beta: 2026-05-11), and the promised Q2 2026 BET/protocol relaunch under Tether backing has not materialized as of this scan.** This reinforces the May report's read: Drift is dead weight in the bot. Meanwhile Polymarket-via-Jupiter (flagged as the replacement in May) is confirmed live since Feb 1-2, 2026 and Jupiter is now building it out as a core product pillar — the pivot the May report recommended was the right call and is worth leaning into further.
7. **Routine patch/minor bucket** (all backward-compatible, low-risk): `@sentry/react-native` 8.10.0→8.22.0, `@shopify/react-native-skia` 2.6.9→2.11.0, `react-native-vision-camera` 5.1.1→5.2.2, `livekit-client` 2.18.9→2.21.0, `@livekit/react-native` 2.10.2→2.12.0, `react-native-reanimated` 4.1.1→4.5.3, `react-native-wagmi-charts` 2.9.1→2.10.0. See §3 for individual notes — none are urgent alone, but bundling them into one pre-submission dependency pass is efficient.

---

## 2. Security patches

**Nothing found in this window rises to the April `CVE-2025-11953` / `@sentry` level of urgency, and the two items flagged as outstanding in the May report are now both confirmed resolved:**

- **`@react-native-community/cli-server-api` CVE-2025-11953** (RCE via Metro dev server, CVSS 9.8) — fixed in 17.0.1/18.0.1/19.1.2/20.0.0+. App pins `@react-native-community/cli@^20.1.3` — **confirmed resolved**, no action.
- **`@sentry/react-native`** — app is now on `^8.10.0` (was `~6.14.0` in May); the security-hardening fix flagged in May is already picked up. Current latest is 8.22.0 — see routine-upgrades bucket above (§1.7).

**New items found this window:**

- **`protobufjs` — "Six Proto6" vulnerability cluster (disclosed ~June 2026, Cyera Research)**, affecting `<=7.5.5` and `8.0.0–8.0.1` (fixed in 7.5.6/8.0.2), plus a separate prototype-pollution CVE-2026-59876 affecting `8.2.0–8.6.4` (fixed 8.6.5). App's `overrides.protobufjs` is pinned to `^7.5.5`, which npm resolves to the latest matching 7.x — currently **7.6.5** (Jul 4, 2026). **Confirmed already safe**, but worth explicitly re-verifying at the next `npm install` since the override note in `package.json` predates this specific CVE cluster.
- **`livekit-client` permission vuln (AIKIDO-2025-10122)** — versions 0.0.1–2.9.4 let users without publish permission push audio/video tracks; fixed in 2.9.5. App is on `^2.18.9`. **Already safe**, well past the fix — documented here only because it's a real CVE against a dep we use and wasn't checked explicitly before.
- **React/Next.js React Server Components CVEs (CVE-2026-23864, CVE-2026-23869, CVSS 7.5)**, disclosed Dec 2025, patched in React 19.0.4/19.1.5/19.2.4. App pins `react@19.1.0` (patched line is 19.1.5) and `@types/react@~19.1.0`. **This only matters if the app renders React Server Components / uses `expo-router` API routes with Server Actions.** OnlyMonkes appears to be a standard client-rendered Expo Router app with no RSC/server-actions usage visible in `package.json` — if that's still true, this is not applicable, but it's worth a quick manual confirmation before ignoring it, since Expo's own Dec 2025 advisory named SDK 53/54 apps specifically. Recommend bumping `react` to `19.1.5`+ regardless, it's a no-cost patch bump.
- **`@xmtp/*`, `@solana/web3.js`, `expo-updates` code signing, `react-native-vision-camera`** — no new CVEs found against current pinned versions in this window.

---

## 3. Recommended upgrades

### 3a. `helius-laserstream` 0.1.8 → 0.8.0 (bot) — **highest-value bump this cycle**
- **Used for**: real-time Solana account/tx streaming via Helius's gRPC LaserStream service — directly in the Helius-cost/load conversation.
- **Gap**: bot is exact-pinned at `0.1.8`; registry shows 10 published releases since, most recently `0.8.0` (Aug 3, 2026). This is enough version drift that the gRPC wire protocol and reconnect semantics have likely changed non-trivially.
- **Migration effort**: Medium — exact-pin means this needs a deliberate bump + smoke test of the streaming ingestion path (`tokenScanner.ts` / wherever laserstream subscriptions live), not a silent `bun install` pickup.
- **Expected benefit**: bug/reconnect fixes accumulated over 7 months, likely-improved compatibility with Helius's April 2026 infra changes (33% cheaper streaming credits, wider gRPC access on Business tier).
- **Recommendation**: Read the changelog between 0.1.8 and 0.8.0 in a dedicated session before bumping — too large a jump to do blind.

### 3b. `@xmtp/node-sdk` 5.5.0 → 6.1.0 (bot) — breaking change
- **Used for**: bot's XMTP messaging layer (group sends, PRESENCE heartbeats, TRADE_CLOSED DMs, etc.)
- **Breaking in 6.0.0**: automatic sync-request-on-init was removed. The bot must now explicitly call `sendSyncRequest()` after client creation on new installations, or history sync silently stops working. Also adds `sendSyncArchive()`, `listAvailableArchives()`, `processSyncArchive()`, `syncAllDeviceSyncGroups()`, and full archive-based backup/restore (`createArchive`/`archiveMetadata`/`importArchive`).
- **6.1.0 (Jul 29, 2026)**: builds on 6.0.0, no further breaking changes noted; 6.2.0 is currently in nightly.
- **Migration effort**: Medium (~1-2 hr) — one explicit breaking change to account for, plus regression-testing the bot's XMTP init path (`.xmtp_bot_key`, `.xmtp_welcomed.json` handling per CLAUDE.md) since sync behavior changed.
- **Note**: `@xmtp/node-bindings` should move in lockstep — latest is `1.11.0` (Jul 29, 2026), released alongside node-sdk 6.1.0.
- **App side**: `@xmtp/react-native-sdk` is unchanged at `5.7.0` (still latest, last published Mar 14, 2026) — no action needed there, confirms the May report's note.

### 3c. Expo SDK 54 → 55/56 (app) — plan the next hop, don't chase SDK 57 yet
- **Current**: app pins `expo: "^54"`, paired with `react-native: 0.81.5`.
- **What shipped since May**: SDK 55 (Feb 25, 2026, pairs with RN 0.83), SDK 56 (May 21, 2026), SDK 57 (Jun 30, 2026, pairs with RN 0.86 — "smallest, easiest Expo upgrade" per Expo's own framing, 601 commits/1,552 files under the hood between RN 0.85→0.86 despite no public API breaks).
- **Migration effort**: Medium-High per hop given this app's build constraints (NDK 27.1.12297006 for Nitro Modules, Gradle 8.11.1, Kotlin 2.0.21, R8 disabled, SoLoader merged-SO mapping — all documented in CLAUDE.md as fragile). Each SDK bump is a native rebuild requiring a new EAS build and full re-verification of that checklist, not something to OTA onto existing 3.0 binaries.
- **Recommendation**: Do SDK 54→55 (or →56, six months stable as of this scan) as the pre-submission step; defer 57 to the next release cycle. This directly continues — rather than reopens — the May report's "defer 0.83/0.85 + SDK 55" call, since the app already partially executed that migration on its own since May.

### 3d. Routine patch/minor bumps (app) — bundle into one pass
| Package | Current | Latest (as of 2026-08-10) | Notes |
|---|---|---|---|
| `@sentry/react-native` | ^8.10.0 | 8.22.0 | 8.18.0 changed iOS to a prebuilt xcframework by default (`SENTRY_USE_XCFRAMEWORK=0` to opt out); 8.20.0 fixed an 8.19.0 regression that broke iOS screenshot capture (Feedback Widget). Take 8.22.0 directly, skip the intermediate regression. |
| `@shopify/react-native-skia` | 2.6.9 | 2.11.0 | Skia engine bumped to m152; internal migration from host objects to native states (infra change, watch for behavior diffs if/when `SkiaAvatarOverlay` gets wired up per the Avatar Studio roadmap). |
| `react-native-vision-camera` | ^5.1.1 | 5.2.2 | No breaking changes across this range; memory-cap fix for `AHardwareBuffer` import cache, preview-layer/orientation fixes. Low-risk bump. |
| `livekit-client` | ^2.18.9 | 2.21.0 | Data-streams v2, reliable-data-channel fix under concurrent writes, reconnection event-buffering fix. |
| `@livekit/react-native` | ^2.10.2 | 2.12.0 | Follows livekit-client cadence; no breaking changes surfaced. |
| `react-native-reanimated` | ~4.1.1 | 4.5.3 | Already on major 4 (adopted since May — see §5). Fixes for layout-animation crashes and stale-value-after-pause bugs; Worklets 0.11 support (app is on `react-native-worklets@0.5.1`, verify compatibility before bumping). |
| `react-native-wagmi-charts` | ^2.9.1 | 2.10.0 | Used for the tappable $TOKEN candlestick charts; no notable breaking changes found. |
| `@shopify/flash-list` | 2.3.2 | 2.3.2 | **Already current, no action.** |

### 3e. `@solana/web3.js` → `@solana/kit` (both, longer-term)
- **Current**: app `^1.92.3`, bot `^1.98.4` (via override). Both are on the legacy v1 line, which has had **no release since July 2025** — it's effectively frozen, not actively developed.
- **What's new**: `@solana/kit` (formerly "web3.js v2") is at **7.0.0** (Jun 30, 2026) and is where active development now happens. There's also a `@solana/web3.js@rc` v3 line that wraps Kit internals in the old class-based `Connection`/`Keypair`/`Transaction` API as an interop bridge — `PublicKey` is now a deprecated alias of `Address`, and a v3 `Keypair` structurally satisfies Kit's `KeyPairSigner`, so it can be handed directly to Kit APIs. A `@solana/compat` package exists for mixing legacy and new types (`VersionedTransaction`/`PublicKey`/`Keypair` ↔ `Address`/`Transaction`/`CryptoKeyPair`).
- **Migration effort**: High for a full Kit rewrite; Low-Medium if only adopting the v3 interop bridge. Not urgent — v1 still works and isn't deprecated, just stagnant — but worth scoping given how central Solana tx handling is to both codebases (MWA signing in-app, AutonoMonke wallet vault in the bot).
- **Recommendation**: Track, don't act yet. Revisit once v3 is out of RC.

### 3f. Helius DAS resilience for the NFT-gate login flow — new since May
This is the user's explicitly flagged priority, researched fresh this cycle (not covered in the May report at all):

- **Photon (`helius-labs/photon`)** — Helius's own open-source ZK-compression/DAS indexer. Implements the full Metaplex DAS method surface (`getAsset`, `getAssetsByOwner`, `getAssetProof`, `searchAssets`, etc.) — the same spec used to check Saga Monke (`GokAiStXz2Kqbxwz2oqzfEXuUhE7aXySmBGEP7uejKXF`) ownership today. Supports Postgres or SQLite (in-memory SQLite by default), designed to be easy to run locally. **Caveat**: it needs a geyser/gRPC data feed to index from — self-hosting Photon does not eliminate the Helius dependency unless fed from an independent geyser source (e.g., your own validator, or a third-party Yellowstone gRPC provider). If fed from the bot's existing LaserStream subscription, it shifts *read* (DAS query) load off Helius's rate-limited DAS API onto a local Photon replica while still paying for the underlying stream — a legitimate partial win, not full independence.
- **Alchemy DAS API (beta)** — confirmed to support `getAssetsByOwner` for compressed NFTs (Metaplex-spec compliant), on a **free tier of 30M compute units/month**. This is genuine vendor-independent redundancy — a different company's infrastructure, useful specifically for surviving a Helius-side outage rather than a self-inflicted local one. **Recommended as fallback tier #2.**
- **Triton One** — supports the full DAS read surface (`getAsset(s)`, `getAssetProof(s)`, `getAssetSignatures`, `searchAssets`, `getAssetsBy{Owner,Creator,Authority}`), powered by their own Photon-based indexer. No confirmed free tier — positioned as enterprise/dedicated infra. Worth a pricing check directly if Alchemy's 30M CU/month proves insufficient.
- **Extrnode / SimpleHash / QuickNode** — all publish DAS support (Extrnode's own docs, SimpleHash's "general availability" of Solana cNFTs, QuickNode's Metaplex DAS marketplace add-on), but none had a clearly confirmed free tier in this pass — worth a direct pricing-page check before committing engineering time.
- **Best-practice addition that doesn't require a new vendor**: cross-verify any DAS response against the on-chain Merkle tree root using `getAssetProof` before trusting an ownership claim for the login gate. The proof itself is independently verifiable on-chain even though *discovering* which assets a wallet owns still requires an indexer — this doesn't eliminate the third-party dependency, but it does mean a compromised or buggy DAS provider can't silently lie about ownership without the proof failing verification. Cheap to add, meaningfully reduces blind trust in whichever provider answers.
- **Recommended architecture**: mirror the bot's existing LLM fallback-chain pattern (`src/lib/llm/fallbackChain.ts`, already in the codebase per CLAUDE.md) for the login gate: **Helius (primary) → Alchemy free tier (fallback) → self-hosted Photon if stood up (fallback) → short-TTL cached last-known-good result** — consistent with how the rest of the system already handles provider flakiness, and directly addresses the 35+ outages measured over the last 7 months.

---

## 4. New protocols / projects worth evaluating

### 4a. Polymarket-via-Jupiter — confirmed live, now a core Jupiter product pillar
The integration flagged as upcoming in the May report went live **Feb 1-2, 2026**. Jupiter now treats prediction markets as a core pillar alongside swaps and is building out APIs and discovery tooling for it; Polymarket itself recorded $7.66B in January 2026 volume. This validates the May report's recommendation to pivot MonkePredictions off Drift BET's gamma-equivalent onto Polymarket-via-Jupiter — worth confirming the bot has actually made this switch, and worth evaluating the newer Jupiter prediction-market APIs/discovery tools if not already integrated.

### 4b. Hyperliquid HIP-4 — went live on mainnet since May, changes the calculus slightly
May's report noted HIP-4 was testnet-only with no mainnet date. **It launched on Hyperliquid mainnet May 2, 2026**: zero fees to open, fully collateralized in USDH (no liquidation risk), YES/NO outcome tokens priced 0.001–0.999, 6.05M contracts traded on launch day, and the protocol has since passed $1B in cumulative revenue. Builder-deployed markets require staking 1M HYPE per slot (slashable for oracle manipulation or downtime).
- **Still the same objection as May**: Hyperliquid is its own L1, not Solana — integrating it means taking on a genuinely new infra dependency for the bot, not just a new API.
- **Updated verdict**: worth an explicit compare-and-decide against Polymarket-via-Jupiter now that both are live, high-volume products rather than one live/one speculative — but the Solana-native option (Jupiter) remains the lower-friction choice unless there's a specific feature (e.g., HIP-4's zero-open-fee structure) that's worth the cross-chain cost. Recommend staying on the Jupiter path for 3.0; revisit Hyperliquid only if a concrete feature gap emerges.

### 4c. Drift recovery / BET relaunch — still unresolved, reinforces trimming
Drift's Tether-backed recovery plan (up to $127.5M from Tether, $20M from other partners, recovery tokens pegged $1-per-verified-loss) targeted a **Q2 2026** relaunch as a USDT-margined exchange. As of this scan (Aug 10, 2026, well past Q2), no confirmed relaunch has landed in the sources checked, and the Drift SDK itself has had no new beta since May 11, 2026. Combined with the May report's original call, this is now a 3+ month pattern, not a one-week blip: **the Drift dependency in the bot should be actively deprioritized/trimmed**, not just watched.

### 4d. LLM inference chain — no material change since May, confirms current ordering
Public benchmarks still show Cerebras leading raw throughput on mid-size open models (roughly 1,700–3,000 tok/s depending on model/benchmark methodology) with Groq holding the TTFT edge (sub-100ms / ~0.74s per Artificial Analysis). This is consistent with — not a change from — the May report's numbers, so no reordering of the bot's Groq→Cerebras→Gemini→OpenRouter→Ollama chain is indicated by new evidence. Cohere Rerank 4 Pro/Fast remain available via OpenRouter (added Apr 6, 2026, per OpenRouter's own listing) — same status as flagged in May, still not yet wired into Hermes Memory's retrieval if it wasn't already.

---

## 5. Deferred-in-May items — reconsidered

- **RN 0.83/0.85 + Expo SDK 55 migration** — **partially happened already, on its own, since May** (app is now on RN 0.81.5 / SDK 54, up from 0.79.6 / SDK 53). The ecosystem has moved further still (SDK 57 / RN 0.86 now current). Verdict: continue the ladder incrementally — SDK 55/56 next — rather than treating this as one big deferred migration. See §3c.
- **`react-native-reanimated` 4** — **no longer deferred — already adopted.** App is on `~4.1.1` with `react-native-worklets@0.5.1` alongside it, consistent with Reanimated 4's New-Arch-only requirement. Only the routine minor bump to 4.5.3 remains open (§3d).
- **`@elizaos/core` v2 stable** — **still correctly deferred, but the situation has changed shape.** In May this was "535 alphas in one week." By this scan, the v2 line has progressed to an actual beta channel (`2.0.3-beta.7`, Jun 28, 2026) with a slower, more deliberate cadence — some third-party blog coverage claims a "stable production release v2.0.3" shipped in May 2026, but **this was checked directly against the npm registry and is not accurate**: the `latest` dist-tag is still `1.7.2`, and every published `2.x` version on npm (`2.0.0-alpha.*` through `2.0.3-beta.7`) is a prerelease — no plain `2.x` tag exists. Recommendation: keep the bot pinned to `1.7.2` for 3.0, but re-check next cycle — the beta channel maturing at all (vs. pure alpha churn) is a real signal it's getting closer.
- **`freerasp-react-native`** — no longer "no new release"; **5.2.0 shipped today** (§1.3, §3). Take it.
- **`@xmtp/react-native-sdk`** — still at 5.7.0, confirmed still latest (no release since Mar 14, 2026). No change from May's note.
- **`solana-agent-kit`** — still stale, unchanged since Sept 2025 (`2.0.10` remains latest). No new evidence to reconsider; the May report's "package going stale" read holds and has gotten three months staler.

---

## 6. Sources used

- https://registry.npmjs.org/ — direct registry queries for exact latest versions/dates of all packages checked (primary source for every version claim in this report)
- https://github.com/xmtp/xmtp-js/releases
- https://github.com/xmtp/xmtp-react-native/releases
- https://github.com/facebook/react-native/releases
- https://expo.dev/changelog
- https://expo.dev/changelog/sdk-57
- https://github.com/livekit/client-sdk-js/releases
- https://github.com/livekit/client-sdk-react-native/releases
- https://github.com/software-mansion/react-native-reanimated/releases
- https://github.com/getsentry/sentry-react-native/releases
- https://github.com/getsentry/sentry-react-native/security/advisories
- https://github.com/mrousavy/react-native-vision-camera/releases
- https://github.com/Shopify/react-native-skia/releases
- https://github.com/talsec/Free-RASP-ReactNative/releases
- https://github.com/elizaOS/eliza/releases
- https://intel.aikido.dev/cve/AIKIDO-2025-10122
- https://jfrog.com/blog/cve-2025-11953-critical-react-native-community-cli-vulnerability/
- https://www.sentinelone.com/vulnerability-database/cve-2025-11953/
- https://www.cyera.com/blog/cyera-research-uncovers-six-protobuf-js-vulnerabilities-impacting-the-backbone-of-data-and-ai-systems
- https://thehackernews.com/2026/06/six-proto6-vulnerabilities-in.html
- https://www.kodemsecurity.com/cve-archive/cve-2026-59876
- https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components
- https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components
- https://vercel.com/changelog/summary-of-cve-2026-23864
- https://github.com/helius-labs/photon
- https://x.com/heliuslabs/status/1843666246979514867
- https://www.helius.dev/docs/das-api
- https://www.helius.dev/docs/laserstream
- https://www.helius.dev/blog/laserstream-websockets
- https://subglow.io/subglow-vs-helius
- https://statusgator.com/services/helius/das
- https://statusgator.com/services/helius
- https://isdown.app/status/helius
- https://www.alchemy.com/docs/reference/alchemy-das-apis-for-solana
- https://www.alchemy.com/blog/photon-on-alchemy-compressed-solana-data-standard-rpc
- https://triton.one/products/metaplex-das
- https://docs.extrnode.com/das_api/
- https://blog.simplehash.com/blog/simplehash-announces-general-availability-of-solana-compressed-nfts
- https://developers.metaplex.com/smart-contracts/bubblegum-v2/fetch-cnfts
- https://solana.com/docs/frontend/web3-compat
- https://blog.triton.one/intro-to-the-new-solana-kit-formerly-web3-js-2/
- https://www.anza.xyz/blog/meet-kit-the-new-solana-javascript-sdk
- https://github.com/anza-xyz/kit
- https://www.coindesk.com/business/2026/05/05/drift-outlines-a-recovery-plan-for-users-after-usd295-million-dprk-linked-exploit
- https://www.drift.trade/updates/incident-recovery-update-april-16-2026-now
- https://www.coingabbar.com/en/crypto-currency-news/drift-protocol-recovery-plan-tether-relaunch-update-june-2026
- https://invezz.com/news/2026/02/02/jupiter-integrates-polymarket-bringing-on-chain-prediction-markets-to-solana/
- https://www.coindesk.com/markets/2026/02/02/jupiter-brings-polymarket-to-solana-and-lands-usd35-million-investment-deal
- https://cryptobriefing.com/hyperliquid-hip-4-prediction-markets-launch/
- https://www.thecoinrepublic.com/2026/07/20/hyperliquid-crypto-to-launch-hip-4-outcome-markets-as-revenue-passes-1b/
- https://www.ccn.com/education/crypto/hyperliquid-hip-4-outcome-markets-work-explained/
- https://speko.ai/benchmark/groq-vs-cerebras
- https://openrouter.ai/cohere/rerank-4-pro
- https://developers.jup.ag/changelog
