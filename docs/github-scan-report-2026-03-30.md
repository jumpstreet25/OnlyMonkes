# OnlyMonkes Open-Source GitHub Scan Report
**Date:** 2026-03-30 | **Scanned by:** Claude + Hermes

60+ open-source projects evaluated across messaging, DeFi, AI, face tracking, UI/UX, and security. Below are the top finds organized by category with priority recommendations.

---

## TIER 1: HIGH IMPACT, LOW EFFORT (Do These First)

### 1. FlashList — Chat Performance
- **Repo:** [Shopify/flash-list](https://github.com/Shopify/flash-list) | 7,003 stars | MIT
- **What:** Drop-in FlatList replacement with cell recycling. 3-5x fewer frame drops.
- **Upgrade:** Replace `<FlatList>` in ChatScreen.tsx message list. With 1000+ messages, eliminates scroll jank. Verify `maintainVisibleContentPosition` behavior.
- **Effort:** 1 line change + testing

### 2. Krisp Noise Filter — Live Room Audio Quality
- **Repo:** [@livekit/react-native-krisp-noise-filter](https://www.npmjs.com/package/@livekit/react-native-krisp-noise-filter) | Apache-2.0
- **What:** Krisp AI noise cancellation for LiveKit. Background noise removal with bundled ML model.
- **Upgrade:** Drop-in for Avatar Rooms. Dramatically improves audio quality for users in noisy environments.
- **Effort:** `bun add` + 3 lines of config

### 3. Free-RASP — Runtime Security
- **Repo:** [talsec/Free-RASP-ReactNative](https://github.com/talsec/Free-RASP-ReactNative) | 160 stars | MIT
- **What:** Detects root/jailbreak, Frida hooking, emulators, app tampering, repackaging.
- **Upgrade:** Critical for a crypto/trading app. Protect AutonoMonke wallet vault from extraction on compromised devices.
- **Effort:** Add SDK + configure threat callbacks

### 4. Jito TypeScript SDK — MEV Protection
- **Repo:** [jito-labs/jito-ts](https://github.com/jito-labs/jito-ts) | 194 stars | Apache-2.0
- **What:** Bundle transactions through Jito to prevent sandwich attacks.
- **Upgrade:** Wrap AutonoMonke Jupiter swaps in Jito bundles. Prevents front-running losses on autonomous trades.
- **Effort:** Modify jupiterSwap.ts execution path

### 5. react-native-fast-confetti — GPU Confetti
- **Repo:** [AlirezaHadjar/react-native-fast-confetti](https://github.com/AlirezaHadjar/react-native-fast-confetti) | 483 stars | MIT
- **What:** GPU-rendered confetti via Skia Atlas API. Custom flake shapes (bananas!).
- **Upgrade:** Replace custom `ConfettiView.tsx` (40 Reanimated particles) with GPU-accelerated version.
- **Effort:** Swap component, requires `@shopify/react-native-skia`

---

## TIER 2: HIGH IMPACT, MEDIUM EFFORT

### 6. react-native-mediapipe + Kalidokit — Face-Driven Avatars
- **Repos:**
  - [cdiddy77/react-native-mediapipe](https://github.com/cdiddy77/react-native-mediapipe) | 400+ stars | MIT
  - [yeemachine/kalidokit](https://github.com/yeemachine/kalidokit) | 5,500 stars | MIT
- **What:** MediaPipe provides 478 3D face landmarks + 52 blendshape scores. Kalidokit maps them to avatar bone rotations.
- **Upgrade:** The full face-tracked avatar pipeline for Avatar Rooms. Feed blendshapes into AnimatedAvatar.tsx for eyebrow raises, eye blinks, head rotation, and accurate mouth shapes. Far richer than audio-only energy detection.
- **Effort:** Install MediaPipe + bridge to existing faceTracking.ts

### 7. react-native-wagmi-charts — Token Price Charts
- **Repo:** [coinjar/react-native-wagmi-charts](https://github.com/coinjar/react-native-wagmi-charts) | 699 stars | MIT
- **What:** Candlestick + line charts with interactive crosshair gestures. Uses Reanimated for 60fps. Does NOT require react-native-svg.
- **Upgrade:** In-app token charts when tapping `$TOKEN` mentions or viewing bot alerts. Interactive candlestick view with price/volume. Already uses your exact stack (Reanimated 3).
- **Effort:** Install + create ChartModal component

### 8. technicalindicators — Battle-Tested TA Library
- **Repo:** [anandanand84/technicalindicators](https://github.com/anandanand84/technicalindicators) | 2,419 stars | MIT
- **What:** 50+ indicators (MACD, RSI, EMA, Ichimoku, ADX, Bollinger, VWAP, OBV, Stochastic) + candlestick pattern recognition.
- **Upgrade:** Validate or replace hand-rolled TA in Monke_Eliza's engine.ts. Add missing indicators (VWAP, OBV, Stochastic). Pure JS, zero deps.
- **Effort:** Import + swap/validate calculations

### 9. react-native-compressor — Media Compression
- **Repo:** [numandev1/react-native-compressor](https://github.com/numandev1/react-native-compressor) | 1,278 stars | MIT
- **What:** WhatsApp-quality compression for video, image, and audio. Native modules.
- **Upgrade:** Compress videos before Cloudinary upload (videoUpload.ts). Reduces bandwidth, storage costs, faster loads.
- **Effort:** Integrate into upload pipeline

### 10. Notifee — Rich Notifications
- **Repo:** [invertase/notifee](https://github.com/invertase/notifee) | 2,000+ stars | Apache-2.0
- **What:** Rich notification styles — Big Picture (show PFP), Inbox (grouped messages), Messaging (conversation thread), inline reply.
- **Upgrade:** Show sender's NFT PFP in notifications. Group multiple messages. Inline reply from notification shade.
- **Effort:** Replace expo-notifications for Android notification rendering

### 11. XMTP Native Content Types — Read Receipts + Reactions
- **Repo:** [xmtp/xmtp-js](https://github.com/xmtp/xmtp-js) | MIT
- **What:** Official content type packages for reactions, replies, read receipts, transaction references.
- **Upgrade:** Native read receipts (timestamp-based) — major UX win. Migrate from custom `REACT:` prefix to XMTP native reaction content type for interop with Converse/other XMTP apps.
- **Effort:** Migrate message format handlers

---

## TIER 3: STRATEGIC UPGRADES

### 12. Vercel AI SDK — Unified LLM Interface
- **Repo:** [vercel/ai](https://github.com/vercel/ai) | 23,098 stars | Permissive
- **What:** Standard TypeScript SDK for AI apps. Supports streaming, tool calling, structured output. Works with Groq, Anthropic, Ollama, Cerebras.
- **Upgrade:** Unify the 4-provider LLM chain (Groq→Cerebras→Ollama→Anthropic) into one clean interface with automatic fallback.
- **Effort:** Refactor askEliza() and multiPerspective.ts

### 13. Callstack AI — On-Device LLM
- **Repo:** [callstackincubator/ai](https://github.com/callstackincubator/ai) | 1,239 stars | MIT
- **What:** Run LLMs directly on-device in React Native. Vercel AI SDK compatible. GGUF models via llama.cpp.
- **Upgrade:** Local message summarization, quick TA interpretation, offline bot responses. Zero API cost.
- **Effort:** High (model selection, memory management)

### 14. LlamaIndex TypeScript — Better RAG
- **Repo:** [run-llama/LlamaIndexTS](https://github.com/run-llama/LlamaIndexTS) | 3,074 stars | MIT
- **What:** Data framework for RAG, document indexing, knowledge bases.
- **Upgrade:** Replace LightRAG for Hermes Memory. Better document chunking, retrieval, and query accuracy.
- **Effort:** High (migration from LightRAG)

### 15. three-vrm — 3D VRM Avatar Rendering
- **Repo:** [pixiv/three-vrm](https://github.com/pixiv/three-vrm) | 4,000 stars | MIT
- **What:** Load and render VRM 3D humanoid avatars in Three.js. Blendshapes, bone animations, spring physics.
- **Upgrade:** If Saga Monkes are converted to VRM format, this renders them as full 3D animated avatars. Combined with MediaPipe + Kalidokit = VTuber-quality avatar rooms. You already have Three.js installed.
- **Effort:** High (VRM model creation, rigging)

### 16. plugin-polymarket — Prediction Markets
- **Repo:** [Okay-Bet/plugin-polymarket](https://github.com/Okay-Bet/plugin-polymarket) | ElizaOS plugin
- **What:** Query Polymarket markets, place bets, track positions via ElizaOS.
- **Upgrade:** Expand MonkePredictions beyond Drift to include Polymarket events.
- **Effort:** Medium (plugin install + DM command wiring)

### 17. Yellowstone gRPC — Real-Time On-Chain Events
- **Repo:** [Shyft-to/solana-defi](https://github.com/Shyft-to/solana-defi) | 344 stars
- **What:** gRPC streaming for real-time Solana events (pool launches, large trades, whale moves).
- **Upgrade:** Replace 10-minute polling scan cycles with sub-second event streaming. Dramatically faster alert delivery.
- **Effort:** High (architecture change from poll to stream)

---

## TIER 4: UI POLISH

### 18. Liquid Glass — Premium Glassmorphism
- **Repo:** [callstack/liquid-glass](https://github.com/callstack/liquid-glass) | 1,284 stars | MIT
- **What:** Apple iOS 26 Liquid Glass effect for React Native. From a trusted vendor (Callstack).
- **Upgrade:** Premium glass effects on bottom sheets, modals, MenuDrawer.

### 19. Enriched Markdown — Styled Bot Messages
- **Repo:** [software-mansion-labs/react-native-enriched-markdown](https://github.com/software-mansion-labs/react-native-enriched-markdown) | 445 stars | MIT
- **What:** Native markdown rendering + rich text input. From the Reanimated team.
- **Upgrade:** Properly styled bot messages with code blocks, bold, lists instead of plain text.

### 20. Lottie — Polished Animations
- **Repo:** [lottie-react-native/lottie-react-native](https://github.com/lottie-react-native/lottie-react-native) | 17,136 stars | Apache-2.0
- **What:** After Effects animations rendered natively. Thousands of free animations.
- **Upgrade:** Loading spinners, achievement unlocks, badge rewards, empty states.

### 21. Moti — Declarative Animations
- **Repo:** [nandorojo/moti](https://github.com/nandorojo/moti) | 4,522 stars | MIT
- **What:** `<MotiView from={{opacity:0}} animate={{opacity:1}} />` — built on Reanimated 3.
- **Upgrade:** Simplify animation code throughout the app. Built-in `<Skeleton>` loading component.

### 22. Audio Waveform — Voice Messages
- **Repo:** [SimformSolutionsPvtLtd/react-native-audio-waveform](https://github.com/SimformSolutionsPvtLtd/react-native-audio-waveform) | 297 stars | MIT
- **What:** Native audio waveform visualization for recording and playback.
- **Upgrade:** WhatsApp-style voice messages in chat with waveform display.

### 23. Instagram Stories — Monke Stories
- **Repo:** [birdwingo/react-native-instagram-stories](https://github.com/birdwingo/react-native-instagram-stories) | 300+ stars | MIT
- **What:** Horizontal scrollable stories with progress bars, built with Reanimated.
- **Upgrade:** 24-hour Monke Stories — trading wins, portfolio flexes, memes.

### 24. Link Preview — Rich URL Cards
- **Repo:** [flyerhq/react-native-link-preview](https://github.com/flyerhq/react-native-link-preview) | 131 stars | MIT
- **What:** Extracts Open Graph metadata and renders preview card.
- **Upgrade:** Rich previews when sharing Birdeye/Twitter/Jupiter links in chat.

### 25. Polls — Community Engagement
- **Repo:** [WrathChaos/react-native-poll](https://github.com/WrathChaos/react-native-poll) | 200+ stars | MIT
- **What:** Animated poll/voting component.
- **Upgrade:** In-chat polls — "Which token next?", "Bull or bear?". Bot-initiated polls.

---

## REFERENCE ARCHITECTURES

| Project | Stars | Why It Matters |
|---|---|---|
| [xmtplabs/convos-app](https://github.com/xmtplabs/convos-app) | 150+ | XMTP best practices reference (consent, moderation) |
| [sendaifun/solana-app-kit](https://github.com/sendaifun/solana-app-kit) | 500+ | Solana mobile scaffold with 19+ protocol integrations |
| [LimeChain/SocialFi](https://github.com/LimeChain/SocialFi) | 50+ | Social + DeFi mobile UX patterns on Solana |
| [bklieger-groq/stockbot-on-groq](https://github.com/bklieger-groq/stockbot-on-groq) | 1,455 | Groq-powered trading chatbot with interactive charts |
| [solana-mobile/solana-mobile-dapp-scaffold](https://github.com/solana-mobile/solana-mobile-dapp-scaffold) | 62 | dApp Store submission template |

---

## TOP 10 PRIORITY ACTIONS

| # | Project | Category | Impact | Effort |
|---|---|---|---|---|
| 1 | **FlashList** | Performance | Chat scroll perf | Low |
| 2 | **Krisp Noise Filter** | LiveKit | Audio quality | Low |
| 3 | **Free-RASP** | Security | Tamper detection | Low |
| 4 | **Jito SDK** | Trading | MEV protection | Low-Med |
| 5 | **react-native-wagmi-charts** | UI | Token price charts | Medium |
| 6 | **MediaPipe + Kalidokit** | Avatar | Face-tracked avatars | Medium |
| 7 | **technicalindicators** | Trading | Validated TA engine | Medium |
| 8 | **Notifee** | UX | Rich notifications | Medium |
| 9 | **XMTP Read Receipts** | Messaging | Read receipt support | Medium |
| 10 | **react-native-compressor** | Media | Video/image compression | Medium |

---

*Report generated by scanning 60+ GitHub repositories across messaging, DeFi, AI/LLM, face tracking, UI/UX, security, and Solana mobile categories.*
