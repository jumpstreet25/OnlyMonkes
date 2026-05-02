# OSS Updates Scout — 2026-04-25 → 2026-05-02

Window: last 7 days. Filtered for OnlyMonkes app (RN 0.79.6 / Expo SDK 53 / XMTP v5.7) and Monke_Eliza bot (Bun / @xmtp/node-sdk 5.4 / Drift / Jupiter).

---

## 1. TL;DR — top 5 ranked by "should we adopt?"

1. **Polymarket Exchange Upgrade (Apr 28)** — Hard requirement: V1 SDK / V1-signed orders **no longer accepted on production**. If anything in Monke_Eliza bot still talks to the legacy CLOB, it's broken right now. Migrate to V2 SDK + new pUSD collateral (1:1 USDC-backed). This is the cleanest replacement for Drift BET (whose UI is still down post-$285M April 1 exploit).
2. **@sentry/react-native 8.10.0 (Apr 30)** — Drop-in upgrade from 6.14. Fixes a Hermes profiler crash on app teardown (we have Hermes on RN 0.79; this could be a source of the silent crashes we've been seeing) plus URI scope/token masking security hardening. We're 2 majors behind on Sentry.
3. **livekit-client 2.18.8 (Apr 30) + @livekit/react-native 2.10.2 (Apr 27)** — Patch upgrades. 2.18.8 fixes data-track flush + negotiation bugs; 2.10.2 fixes a DOMException polyfill issue that affects RN. Avatar Rooms data channel uses LiveKit data tracks heavily — this is worth picking up.
4. **OpenRouter Agent SDK + Reranker (Apr 30)** — Type-safe TS Agent SDK with multi-turn + streaming over 300+ models, plus Cohere Rerank 4 Pro now exposed via OpenRouter. We already use OpenRouter as fallback link 4 in the LLM chain. The reranker could meaningfully improve Hermes Memory's "best historical signals" retrieval.
5. **react-native-vision-camera 5.0.8 (Apr 28)** — Adds `supportedMultiCamDeviceCombinations`. Mostly noise for us today (we run 1×1 invisible cam for face tracking), but also fixes a `NullPointerException` in `ImageReaderProxy` that we've potentially been swallowing on Android.

---

## 2. Security patches — pick up immediately

Nothing CVE-rated landed this exact week against deps we use. The two outstanding security fixes still worth confirming on next APK build:

- **CVE-2025-11953 — `@react-native-community/cli-server-api`** (CVSS 9.8, RCE via Metro dev server). Affects 4.8.0 → 20.0.0-alpha.2. We pin `@react-native-community/cli@^20.1.3` in devDependencies — verify the transitive `cli-server-api` is ≥ 20.1.x. Dev-server-only, so prod APK is unaffected, but any dev running `expo start` on a hostile network is exposed. ([JFrog advisory](https://jfrog.com/blog/cve-2025-11953-critical-react-native-community-cli-vulnerability/))
- **@sentry/react-native 8.10.0** — bundles a security patch for "URI scope restrictions and token masking." We're on `~6.14.0`. This is a 2-major jump but Sentry's RN SDK keeps a pretty smooth migration. ([release notes](https://github.com/getsentry/sentry-react-native/releases))

No new CVEs published this week against `@solana/web3.js`, `@xmtp/*`, `expo`, `react-native`, `livekit-*`, `freerasp-react-native`, or `@drift-labs/sdk`.

---

## 3. Recommended upgrades

### 3a. `@sentry/react-native` 6.14 → 8.10.0
- **Used for**: crash & error reporting in the OnlyMonkes app.
- **What's new (Apr 30)**: Hermes profiler teardown crash fix, rage-tap breadcrumbs, `SENTRY_RELEASE` / `SENTRY_DIST` env override, Metro option to exclude feedback components from bundles, Cocoa SDK bumped to 9.12, JS SDK 10.51.
- **Migration effort**: Medium (~2 hr). Two majors of breaking changes but the migration guide is short — mostly auto-init + `wrap()` patterns. New arch is required for some features but our app is on new arch already.
- **Expected benefit**: Fewer silent Hermes crashes on app teardown, better debugging surface (rage taps), tighter PII scrubbing.
- **APK-pending**: Yes, native iOS/Android changes — bundle into next eas build.

### 3b. `livekit-client` 2.18.3 → 2.18.8 + `@livekit/react-native` 2.10.0 → 2.10.2
- **Used for**: Avatar Rooms (data channel + audio).
- **What's new**:
  - 2.18.8 (Apr 30): local data track flush method (useful when we tear down avatar sessions), offerId-based negotiation tracking, swallows benign data-track promise rejections after subscription readable-stream discard.
  - 2.18.7 (Apr 27): processor passthrough for LocalTrack reference, Firefox iOS simulcast priority fix.
  - 2.10.2 (Apr 27): DOMException polyfill fix for RN.
- **Migration effort**: Trivial (~10 min) — patch versions, no API changes.
- **Expected benefit**: Cleaner avatar room teardown; fewer silent promise rejections clogging Sentry.
- **APK-pending**: Yes (livekit-client native).

### 3c. `react-native-vision-camera` 4.7.3 → 5.0.8
- **Used for**: 1×1 invisible camera that drives face-tracking blendshapes for Avatar Rooms.
- **What's new (5.0.8, Apr 28)**: Multi-cam combinations, `NullPointerException` fix in private `ImageReaderProxy`, barcode format handling fix in Swift.
- **Migration effort**: **HIGH** — V5 is a major refactor (Frame Processors rewritten, modular package structure, new camera control APIs). Skip unless you're actively working on FaceTracker.
- **Expected benefit**: Lower allocation overhead in frame processors. Marginal for our use case.
- **Recommendation**: Defer. Park it on the v2.39 backlog and only upgrade when we touch FaceTracker.

### 3d. `@shopify/react-native-skia` 2.5.5 → 2.6.2
- **Used for**: Avatar Studio overlay (Skia canvas, currently unwired but on the roadmap).
- **What's new (Apr 2-4)**: New immutable `Path` API, `createSecondaryDevice()` on `DawnContext`, plus `2.6.3-next.1` started the Skia Graphite pre-release line.
- **Migration effort**: Low (~30 min). Path API is opt-in; old API still works.
- **Expected benefit**: Cleaner API for the Avatar Studio plan when we wire up `SkiaAvatarOverlay`. Worth picking up before that work, not after.
- **APK-pending**: Yes.

### 3e. OpenRouter Agent SDK + Cohere Rerank 4 Pro
- **Used for**: 4th-link fallback in the bot's LLM chain.
- **What's new (Apr 30)**: TS/Python Agent SDK with type-safe tools, multi-turn execution, and streaming over 300+ models. Workspaces give us isolated keys per environment (dev / prod). Cohere Rerank 4 Pro now callable via OpenRouter.
- **Migration effort**: Low — additive. Either bolt the rerank call into Hermes Memory's "find similar past signals" query, or leave the chat chain as-is.
- **Expected benefit**: Hermes Memory currently does cosine-similarity retrieval against `@xenova/transformers` local embeddings. Reranking the top-K with Cohere Rerank 4 Pro before feeding to the LLM would meaningfully improve "have we seen this setup before?" answers.

---

## 4. New protocols / projects worth evaluating

### 4a. Polymarket V2 + Solana via Jupiter — **drop-in Drift BET replacement**
- **What it does**: Polymarket completed its **CTF Exchange V2** upgrade on Apr 28. New audited contracts (Cantina + Quantstamp), rebuilt order book, new collateral token **pUSD** (1:1 USDC-backed, enforced on-chain). V2 contracts also introduce **builder codes** for on-chain order attribution — you can claim credit (and potentially fee share) for order flow you originate.
- **Why it fits**:
  - Drift BET is dead. Drift Protocol was drained for $285M on April 1 (durable-nonce social-engineering attack); the BET UI has been the casualty.
  - **Polymarket is already live on Solana via Jupiter's "Prediction" tab** (integrated Feb 2026). MonkePredictions can shift its data source and DM commands from Drift's gamma equivalent to Polymarket Gamma + Jupiter routing **without changing its UX**.
  - Builder codes give us a path to monetize the prediction-market surface area we already render.
- **US-friendly caveat**: Polymarket itself is restricted in the US, but the Jupiter front-end on Solana is a different surface. Worth checking with our compliance posture before rolling DM commands.
- **Links**: [Polymarket V2 upgrade post](https://help.polymarket.com/en/articles/14762452-polymarket-exchange-upgrade-april-28-2026), [V2 migration guide](https://docs.polymarket.com/v2-migration), [The Block: Jupiter integration](https://www.theblock.co/post/387945/jupiter-polymarket-solana).

### 4b. Hyperliquid HIP-4 Outcome Tokens (testnet)
- **What it does**: Prediction-market-style outcome tokens. Fee structure published Apr 29 — 0 fees on open, costs only on close/settlement, 20% lower taker fees and 50% higher maker rebates for "aligned quote token" users.
- **Why we'd skip for now**: Testnet only, no mainnet date, and Hyperliquid is its own L1 — would force a non-Solana dependency into the bot. Track but don't integrate.
- **Link**: [CoinDesk Apr 29](https://www.coindesk.com/business/2026/04/29/hyperliquid-is-preparing-to-take-on-polymarket-with-a-new-way-to-trade-real-world-events).

### 4c. Cerebras Qwen 3 235B at 525 TPS (already on the chain — bench it)
- **What it does**: Independent Q2 2026 benchmarks now show Cerebras Qwen 3 235B at 525 tok/s and Llama 3.3 70B at 3× Groq's speed. We already wire Cerebras as link 2 of the chain; worth re-running our own latency profile and possibly promoting it to link 1 if our Groq P99 is worse.
- **Link**: [Digital Applied benchmarks](https://www.digitalapplied.com/blog/ai-model-latency-benchmarks-2026-ttft-throughput).

---

## 5. Releases that look exciting but aren't worth chasing yet

- **React Native 0.83.9 / 0.85.2** (Apr 24-27) — RN 0.83 already shipped Hermes V1 by default (1-8ms/keystroke vs 50-250ms on JSC). We're on 0.79.6 with the Expo SDK 53 build pipeline locked (Gradle 8.11.1, Kotlin 2.0.21, NDK 26.1, R8 disabled). Jumping to 0.83/0.85 = full SDK 55 migration + new arch verification + likely keystore-adjacent rebuild. Massive win in theory, multi-day risk in practice. Park for v2.40+.
- **Expo SDK 55** (current 55.0.19) — Pairs with RN 0.83 + React 19.2. Same blocker as above. Note: SDK 55 also adds Hermes bytecode diffing for OTA updates (smaller patches), which is sweet but not urgent.
- **OpenRouter video generation** (Apr 30) — Cool but completely off-mission for us (we don't generate video).
- **@elizaos/core v2.0.0-alpha.535** (May 2) — Still alpha. Eliza has been rev-ing 535 alphas this week. We're pinned to 1.7.2 stable; do not chase 2.x until they cut a stable.
- **react-native-reanimated 4.3.0** (Mar 25, just outside the window) — We're on 3.19.5. Reanimated 4 only supports New Arch + last 3 RN versions, so this is gated behind the same RN 0.83 upgrade above.
- **freerasp-react-native** — No new release this week; still 4.5.2 from March 27.
- **@xmtp/react-native-sdk** — No release this week; still 5.7.0 from March 14. (We're on it.)
- **@xmtp/node-sdk 4.5.1** — Latest is 4.5.1 (~Apr 30). We're on 5.4.0 in the bot. **We're ahead of the public latest tag** — verify we're not on a beta line that was abandoned. Worth a `bun outdated` check next bot session.
- **@drift-labs/sdk** — No release this week (still 2.161.0 from Mar 30). Given the April 1 exploit + dead BET UI, the Drift SDK in our bot is increasingly dead weight; consider trimming alongside the Polymarket migration in 4a.
- **solana-agent-kit** — No release this week. Still 2.0.10. The most recent meaningful release is 2.0.9 from July 2024 — package is going stale.
- **@solana/web3.js** — No release. Last is 1.98.4 from July 2025. We pin `^1.98.4` in the bot via overrides; app is on `^1.92.3`. Consider bumping app to align (low risk, same major).

---

## 6. Sources used

- https://github.com/xmtp/xmtp-react-native/releases
- https://github.com/xmtp/xmtp-js/releases (node-sdk releases)
- https://github.com/solana-labs/solana-web3.js/releases
- https://github.com/drift-labs/protocol-v2/releases
- https://github.com/Shopify/flash-list/releases
- https://github.com/expo/expo/releases
- https://github.com/facebook/react-native/releases
- https://github.com/facebook/react-native/releases/tag/v0.83.9
- https://github.com/software-mansion/react-native-reanimated/releases
- https://github.com/jup-ag/jupiter-quote-api-node/releases
- https://github.com/anza-xyz/kit/releases
- https://github.com/sendaifun/solana-agent-kit/releases
- https://github.com/livekit/client-sdk-js/releases
- https://github.com/livekit/client-sdk-react-native/releases
- https://github.com/talsec/Free-RASP-ReactNative/releases
- https://github.com/elizaos/eliza/releases
- https://github.com/getsentry/sentry-react-native/releases
- https://github.com/mrousavy/react-native-vision-camera/releases
- https://help.polymarket.com/en/articles/14762452-polymarket-exchange-upgrade-april-28-2026
- https://docs.polymarket.com/v2-migration
- https://news.bitcoin.com/polymarkets-april-2026-upgrade-new-stablecoin-faster-order-matching-smart-contract-wallet-support/
- https://www.theblock.co/post/387945/jupiter-polymarket-solana
- https://www.coindesk.com/tech/2026/04/01/solana-defi-platform-drift-investigates-suspicious-activity-tells-users-to-halt-deposits
- https://www.coindesk.com/tech/2026/04/02/how-a-solana-feature-designed-for-convenience-let-an-attacker-drain-usd270-million-from-drift
- https://www.coindesk.com/business/2026/04/29/hyperliquid-is-preparing-to-take-on-polymarket-with-a-new-way-to-trade-real-world-events
- https://www.digitalapplied.com/blog/ai-model-latency-benchmarks-2026-ttft-throughput
- https://openrouter.ai/announcements
- https://openrouter.ai/sdk
- https://openrouter.ai/cohere/rerank-4-pro
- https://reactnative.dev/blog/2026/02/11/react-native-0.84
- https://blog.google/products-and-platforms/products/gemini/gemini-3-flash/
- https://jfrog.com/blog/cve-2025-11953-critical-react-native-community-cli-vulnerability/
- https://expo.dev/changelog/sdk-55
