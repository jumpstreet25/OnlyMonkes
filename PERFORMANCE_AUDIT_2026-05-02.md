# OnlyMonkes Performance Audit — 2026-05-02

Read-only audit across the app (`/Users/davidmartin/AndroidStudioProjects/OnlyMonkes`) and bot (`/Users/davidmartin/Monke_Eliza/agents/monke-trader`). Bundle export and bot log were used to ground numbers. No code was modified.

---

## Section 1 — Top 5 wins (impact ÷ effort)

### 1. `getPrimaryInboxId()` is a hidden O(N) scan inside every visible MessageBubble render
**Metric:** chat scroll frame time, render cost per visible cell.
**Where:** `src/lib/userProfile.ts:365` defines `getPrimaryInboxId()`. It iterates the entire `_profileCache` (`for (const [otherId, otherProfile] of _profileCache.entries())`, line 373) on every call.
**Caller:** `src/components/MessageBubble.tsx:558` — `getPrimaryInboxId(message.senderAddress)` runs on **every render** of every non-own bubble. It is **not** memoized.
**Cost:** With `MAX_PROFILE_CACHE = 200` (`src/lib/userProfile.ts:80`) and ~25 visible bubbles, that is ~5 000 Map iterations per FlashList recycle pass. The whole walk happens even when the cache hasn't changed.
**Fix:** maintain a `wallet → primaryInboxId` reverse Map updated inside `cacheProfile()` (1 write per profile update, O(1) read). Or memoize per-message via `useMemo([message.senderAddress, profileVersion])`.
**Expected gain:** ~2–4 ms shaved off each FlashList renderItem on mid-tier Android, the difference between a 60 fps scroll and dropping into 45–50 fps when the cache is large.

### 2. Stream reactions trigger O(N) `messages.map()` + new array on every event
**Metric:** chat thread CPU + GC pressure during reaction bursts.
**Where:** `src/lib/xmtp.ts:524 applyReaction`, `src/lib/xmtp.ts:582 applyEdit`, `src/lib/xmtp.ts:1379 applyStickerReaction` all do `return messages.map((msg) => msg.id !== targetId ? msg : {...})`. Each call clones a 300-message array even though only one entry changes.
**Caller chain:** stream callback in `src/hooks/useXmtp.ts:1039,1055,1069` → `applyReactionUpdate(updated)` → `chatStore` bumps `_reactionVersion` → FlashList `extraData` invalidates → `arePropsEqual` (`src/components/MessageBubble.tsx:362`) bails per-cell on `prev.message !== next.message`, which is **always true** for the array-clone path because `messages.map()` returns a new array, but the unchanged elements are still the same references — so the per-cell bailout still works. The waste is the array clone + the FlashList extraData invalidation.
**Fix:** in `applyReaction`/`applyEdit`/`applyStickerReaction`, find the index by `findIndex`, and only clone if found:
```ts
const idx = messages.findIndex(m => m.id === targetId);
if (idx === -1) return messages;
const next = messages.slice();
next[idx] = { ...next[idx], reactions };
return next;
```
This keeps the same outer signature but avoids walking 300 entries to clone only one.
**Expected gain:** during a reaction storm (badge celebration, Sunday digest) the array-clone load drops from O(R × N) to O(R), and GC churn is materially reduced.

### 3. `messagesAsc.slice().reverse()` runs on every appStore/chatStore tick
**Metric:** ChatScreen re-render cost.
**Where:** `src/screens/ChatScreen.tsx:165` — `const messages = useMemo(() => messagesAsc.slice().reverse(), [messagesAsc])`. This is fine — except that `useChatStore(s => s.messages)` returns a new array reference whenever `mergeMessage`/`upgradeOwnMessage`/`addMessage`/`prependMessages` runs (as they should). With reactions firing through `applyReactionUpdate(updated)` (`src/store/chatStore.ts:155`), this also bumps the `messages` reference. Each bump triggers `slice().reverse()` on up to 300 messages. Combined with the FlashList `extraData` already wired to `_reactionVersion`, the inverted list is re-derived twice per reaction event.
**Fix:** since the list is *always* shown inverted, store messages newest-first in `chatStore` directly and drop the per-render reverse. Or use a stable derived store via `zustand/middleware`'s `subscribeWithSelector` and recompute only on length change.
**Expected gain:** ~1 ms per reaction event removed from the JS thread on a 300-message session; bigger wins on the big "100+ reaction" history backfills.

### 4. Bot scanner OHLCV — first-fetch `c1h` is serial before the parallel block
**Metric:** scanner cycle time (currently observed 7–26 s, mean ~14 s in `/tmp/monke-bot.log`).
**Where:** `src/lib/scanner/tokenScanner.ts:1271` fetches 1 H first, *then* fetches 4 H + 15 m + 1 D in parallel at line 1284. The 1 H call is the slowest leg for cache-miss tokens (no other TF can warm the pool) and serializes the worker.
**Why it matters:** `LAYER_1_TOKEN_CONCURRENCY = 10` (`tokenScanner.ts:1010`) means up to 10 tokens hold a worker waiting on a single 1 H call before the parallel fan-out starts. Tail latency dominates.
**Fix:** kick off all 4 timeframe fetches in parallel and apply the bullish-structure pre-filter (`hasBullishStructure(c1h)`, line 1276) inside the awaiter — abort/discard the parallel results on early exit. Or fetch 1 H + 15 m together (the two needed for the pre-filter and momentum check), then 4 H + 1 D. The shared rate-limiter already serializes provider calls; this just removes a dead waiting period.
**Expected gain:** 20–30 % cycle-time reduction in cache-miss bursts (the 22–26 s outliers) which directly improves alert latency.

### 5. `LLM fallback chain` first call is unguarded — Groq cold = 20 s for every chat reply
**Metric:** end-to-end DM/chat reply latency.
**Where:** `src/lib/llm/fallbackChain.ts:97` always tries Groq first. `signal: AbortSignal.timeout(20000)` means a single Groq hiccup adds up to 20 s before failover. The circuit breaker (`cbFail`) only trips after **3 consecutive** failures (`cbWindow = 5 min`, line 45–56), so up to 60 s of dead time can elapse before the chain fails over.
**Fix:** (a) lower Groq timeout to 6–8 s (Groq 70 B p99 is ~3 s when healthy); (b) trip the breaker after **2** consecutive failures; (c) fan out the **first two** providers in parallel with `Promise.race` for chat replies (`runLlmChain` is awaited synchronously by chat — the second-fastest call is wasted bandwidth, not latency).
**Expected gain:** worst-case chat-reply latency drops from ~20 s → ~6 s during a Groq outage; happy-path unchanged.

---

## Section 2 — Bundle size + cold start

### Bundle (Android, JS)
- `_expo/static/js/android/entry-a520e9439ea5b99706d1a60908f6ea30.hbc` — **14,051,757 bytes (13.4 MB Hermes bytecode)** at `/Users/davidmartin/AndroidStudioProjects/OnlyMonkes/.expo-export-perf-audit/_expo/static/js/android/`. Equivalent to ~25 MB JS source on Hermes.
- App-side asset bundle: 5.3 MB (`assets/`).

### 10 largest deps in `node_modules` (`du -sh node_modules/*`)
1. `@shopify/*` — 1.3 GB (FlashList + Skia native libs combined; iOS+Android+macOS+TVOS variants)
2. `react-native-skia-android` — 218 MB
3. `react-native-skia-apple-tvos` — 205 MB *(unused on Android; can prune from CI cache)*
4. `react-native-skia-apple-ios` — 205 MB *(unused if iOS not built)*
5. `react-native-reanimated` — 202 MB
6. `expo-modules-core` — 166 MB
7. `@firebase` + `firebase` — 162 MB combined *(huge — only `@react-native-firebase/analytics` + `app` are used. The plain `firebase` web SDK appears to be transitively pulled in.)*
8. `react-native` — 83 MB
9. `react-native-vision-camera` — 79 MB *(only used by the 1×1 px FaceTracker; consider lazy-loading)*
10. `react-native-worklets-core` — 54 MB
11. (Honorable mention) `react-native-svg` — 39 MB **and the package is in `node_modules` despite CLAUDE.md stating it was removed**. Worth verifying it's not transitively pulled in by `react-native-marked` or similar.

### Cold start path (`app/_layout.tsx`)
- The root `_layout.tsx` (`app/_layout.tsx:1-30`) eagerly imports `@livekit/react-native` (line 3), `freerasp-react-native` (line 29), `expo-updates` via `otaUpdates.ts` (line 23), `@tanstack/react-query` (line 12), `sonner-native` (line 13), `firebase` analytics (via `analytics.ts`, line 24), `expo-secure-store`/`expo-splash-screen`, plus `triggerProfileRebroadcast` from the 2 183-line `useXmtp.ts` (line 17).
- `registerLiveKitGlobals()` runs at **module load** (`_layout.tsx:33`), before the React tree mounts. This pulls in the entire `@livekit/react-native-webrtc` native bridge for users who never join an audio/video room.
- `initSentry()` is called at module load (`_layout.tsx:36`) — Sentry's init is heavy (~150 ms of JS).
- `useFreeRasp()` runs synchronously in render (`_layout.tsx:43`); its detection routines block first paint until they resolve.
- `loadPersistedPrefs()` is called inside `useEffect` (`_layout.tsx:62`) but reads ~12 SecureStore keys — fine because it doesn't block render, but worth noting it adds AsyncStorage I/O on cold start.

### Biggest cold-start contributors (by likely main-thread cost, descending)
1. **LiveKit globals registration at module load** (`_layout.tsx:33`) — 100–200 ms WebRTC bridge init, 100 % wasted for users not in a room.
2. **Sentry init at module load** (`_layout.tsx:36`) — ~80–150 ms.
3. **`useXmtp.ts` is 2 183 lines** (`/Users/davidmartin/AndroidStudioProjects/OnlyMonkes/src/hooks/useXmtp.ts`) and is imported by `_layout.tsx` just to expose `triggerProfileRebroadcast`. The whole module (and all its transitive `@xmtp/react-native-sdk`, `@/lib/marketplace`, `@/lib/livekit`, `@/lib/avatarRoom` imports) is parsed before first paint. Splitting `triggerProfileRebroadcast` into a 30-line helper file would skip parsing ~50 KB of bytecode on startup.
4. **`useFreeRasp()` synchronous in render** (`_layout.tsx:43`) — defer behind a `useEffect` and a 500 ms `setTimeout` like push notifications already are (`_layout.tsx:122-129`).
5. **`firebase` web SDK in deps** — if it's in the bundle, it bloats Hermes precompile by ~1.5 MB. Verify with `npx expo export --dump-source-map` and search for `firebase/`.

---

## Section 3 — Chat hot path

### Re-render triggers
- `ChatScreen` (`src/screens/ChatScreen.tsx`) uses **40+ individual `useAppStore` selectors** (`src/screens/ChatScreen.tsx:114-159`). Every `setShopStyles`, `setBananaBalance`, `setLocation`, etc. that the screen doesn't actually need will still cause it to re-render. Acceptable since the `useChatStore` selectors that actually feed FlashList are isolated, but worth noting.
- `useChatStore(s => s.messages)` returns a new array reference on every reaction event (`chatStore.ts:155 applyReactionUpdate`). `useMemo(() => messagesAsc.slice().reverse(), [messagesAsc])` (`ChatScreen.tsx:165`) re-runs every time. **See Section 1, win #3.**

### Memo gaps
- `MessageBubble.tsx:558` — `getPrimaryInboxId(message.senderAddress)` not memoized. **See Section 1, win #1.**
- `MessageBubble.tsx:559` — `getCachedProfile(primarySenderInbox)` is read on every render and again on lines 515 (avatar handler), 697 (reply preview). Cheap individually but called 3–5× per render.
- `MessageBubble.tsx:585` — `cloutFlair = useMemo(() => getFlairSync(...), [primarySenderInbox])` is correctly memoized, but `primarySenderInbox` itself is recomputed every render (see win #1).

### `arePropsEqual` completeness
- `src/components/MessageBubble.tsx:362` `arePropsEqual` checks `message`, `isOwn`, `isBotChannel`, `onPin` presence, `isGroupAdmin`. **It does not check the callback identities** (`onReact`, `onReply`, etc.). This is intentionally fine — `ChatScreen.tsx` wraps them all in `useCallback` — but the check would silently miss re-renders if a future prop is added without updating `arePropsEqual`. Add a comment or `// keep in sync with MessageBubbleProps` reminder.
- The bigger gap: `arePropsEqual` returns true if `prev.message === next.message`. However, neither `applyReaction` nor `applyEdit` create a new message reference if the `targetId` doesn't match (they use `messages.map()` — see win #2 — but the inner ternary returns the same `msg` reference for unchanged messages). So the per-cell skip works correctly in practice. Just don't break that contract.

### FlashList details
- `getItemType` (`src/components/ChatMessageList.tsx:75 getMessageType`) — good: distinguishes pill / video / image / gif / sticker / attachment / tiplink / nftlist / text. Keep.
- `extraData={reactionVersion}` (`ChatMessageList.tsx:187`) is correct.
- Each `renderItem` wraps every cell in a fresh `<Swipeable>` ref'd into `swipeableRefs.current` (`ChatMessageList.tsx:124-142`). This is fine for FlashList recycling, but the inner `onSwipeableOpen` closes over `setReplyingTo` + `Haptics`. No leak.
- `scrollEventThrottle={200}` (`ChatMessageList.tsx:204`) is generous — appropriate for inverted lists.

### Avatar / image
- `MessageBubble.tsx:672` uses `<Image source={{ uri: avatarUri }}>` (RN Image, **not expo-image**) for every PFP. When `avatarUri` is a base64 data URI from `verifiedNft.image`, RN Image re-decodes the JPEG **per render** — no shared cache key. Switching to `<ExpoImage source={{ uri }} cachePolicy="memory-disk">` would let Skia's image cache deduplicate the 50 KB base64 across every visible bubble for the same user.
- The other media (GIF / Image / Video thumb) already uses `ExpoImage` with `cachePolicy="disk"` (`MessageBubble.tsx:238, 948, 979`).

### Reanimated / worklets
- `PulseRing` (`MessageBubble.tsx:63-97`) uses `Animated.timing` with `useNativeDriver: true` — runs on UI thread, no JS thread cost. Good.
- `swipeAnim` (`MessageBubble.tsx:525`) is `Animated.Value` (the legacy RN Animated API), not Reanimated. Mixing both is fine for now; just confirm there's no hidden JS-thread driver.
- No worklets imported in `MessageBubble.tsx` or `ChatMessageList.tsx`. Worklets-core is only used by `FaceTracker.tsx`.

---

## Section 4 — XMTP / network

### `decodeAndEnrich` (`src/hooks/useXmtp.ts:799`)
- Pre-bucketing into `contentRaws` vs `reactionRaws` (line 800–820) is good — avoids the historical O(n²).
- Decoding a single message calls `raw.content()` once per pre-bucket pass. Each `raw.content()` is a JNI call — these add up. The current code calls it for every raw twice (once in pre-bucket, once again in the apply-reactions inner loop at line 887). Cache the result in a `WeakMap<raw, content>` to halve JNI calls.
- `decoded.slice(0, 150).reverse()` (line 882) is fine.
- `recentMessages.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())` (line 912 + 927) sorts twice. Once is enough — the second sort after merging optimistic messages can be a single insertion since `pendingOptimistic` are always at the tail.

### `messages.find(m => m.id === targetId)` in stream (`useXmtp.ts:1017, 1036, 1185, 1220`)
- Each native reaction or pin event does a linear scan of up to 300 messages. With a busy chat that's millions of comparisons per minute. Use `chatStore._msgIdSet` (already maintained) by adding a parallel `_msgById: Map<string, ChatMessage>` to `chatStore.ts` (you already have the Set; the Map costs little extra memory).

### Network roundtrips on app open (counted from `ChatScreen.tsx` + `_layout.tsx`)
1. `fetchAppConfig()` — `remoteConfig.ts:38` — 1 fetch (GitHub raw).
2. `fetchSolanaEvents()` — `lumaEvents.ts` — 1 fetch (eager only on Globe; not on chat open).
3. `loadEvents()` / `loadPinnedMessages()` / `loadThreadMetadata()` / `loadListings()` (`ChatScreen.tsx:451-454`) — all **AsyncStorage**, not network. Good.
4. `fetchPrices()` (`ChatScreen.tsx:467-487`) — 2 fetches every 5 min (DexScreener for SKR, Magic Eden for Saga floor).
5. `claimDailyBananas()` — local.
6. `registerForPushNotifications()` — Expo push servers, deferred 2 s.
7. `triggerProfileRebroadcast()` — XMTP send, not HTTP fetch.
8. Per token tap: `RugCheck` (1 fetch) + Birdeye OHLCV via `react-native-wagmi-charts` (1 fetch).

**Observations:**
- DexScreener + Magic Eden could be batched through the Cloudflare Worker (`onlymonkes-actions`) to halve roundtrips and add a 5 min CF cache.
- `fetchAppConfig` is called once per `useXmtp` initialize, including on every foreground re-init. Cache it in-memory for 60 s minimum.

---

## Section 5 — Bot perf

### Scanner cycle time (from `/tmp/monke-bot.log`, 17 MB / 212 k lines)
- Sample of last ~50 cycles: median **~10–11 s**, p90 **~22 s**, occasional 25.8 s. Fast cycles (~7 s) correspond to high cache-hit ratios (`cached:120+`); slow cycles correspond to cache-miss bursts requiring full provider chain.
- LLM circuit-breaker activations: none observed in the last 10 k log lines (Groq + Cerebras + Gemini are all healthy). Drift uptime monitor is failing every poll cycle (`drift-uptime] fetch failed; keeping state = unknown`) — that is a bug surface but not a perf issue (30 min cadence).

### Concurrency bottlenecks
- `LAYER_1_TOKEN_CONCURRENCY = 10` (`tokenScanner.ts:1010`) with `MAX_TOKENS_PER_SCAN = 50` (line 38) means up to 5 batches of serialized work *if every worker hits a slow path*. Bumping to 15–20 should be safe given the sliding-window rate limiters on each provider.
- `processToken` fetches `c1h` serially before the parallel block (line 1271 vs 1284). **See Section 1, win #4.**

### `tickPositions` (`src/lib/automonke/engine.ts:502`)
- Loops users serially: `for (const [inboxId, positions] of _openPositions.entries())` (line 506), then loops positions per user serially. With N users × M positions, total fetch chain is sequential.
- Per position it calls `fetchPrice(pos.mint)` (line 510) and `fetchTA(pos.mint)` (line 537). The TA call is synchronous (just a `getLastScanResults().find(...)` linear scan — same anti-pattern as the chat hot path).
- Caller schedules every 2 min (`xmtpOnlyMonkes.ts:1781-1794`). With 5 users × 3 positions × 1 s per fetch = 15 s tick. Within budget today; will become a problem when user count grows.
- **Fix:** parallelize across users with `Promise.all`, keep per-user serial for safety. Build a `Map<mint, Position[]>` once per tick to dedupe `fetchPrice` calls (the same mint is often held by multiple users).
- **Fix #2:** the `getLastScanResults().find(...)` at `xmtpOnlyMonkes.ts:1784` is called per position. Pre-build a `Map<mint, ScanResult>` at the start of each tick.

### Drift uptime monitor
- `startDriftUptimeMonitor()` (`src/services/driftUptimeMonitor.ts`) runs 30 min poll cadence (line 27). Initial fetch fires in `setTimeout(check, 5_000)` (verified by the LaunchAgent log showing `[drift-uptime] Monitoring https://bet.drift.trade/ every 30 min` shortly after start). It does **not** block service init. ✅
- Stage-1 cheap fetch is fast (`looksLikeStayTuned` is a regex test). LLM gate only fires on transition. No perf concern.

### Hermes Memory disk reads
- `loadLearning()` is called **34 times** inside `src/lib/hermesMemory.ts` — every recorder function does `const state = loadLearning()` → mutate → `saveLearning(state)`. Each call is a `readFileSync` of the JSON file (no in-memory cache).
- Hot-path callers from outside the module include:
  - `tokenScanner.ts:33` — `getAutoMutedTokens`, `getPerTokenThresholds` (per scan cycle: 1 read).
  - `priceStream.ts:21` — `getAutoMutedTokens` (potentially per-tick).
  - `automonke/engine.ts:26` — `recordUserEvent`, `recordPnlEvent`, `recordAlertOutcome`, `recordSkipDecision` (per trade event: 1 read + 1 write each).
  - `riskManager.ts` lazy-requires `getUserKellyStats` per risk computation.
- The `LEARNING_FILE` JSON grows toward ~1 000 alerts + 500 bets + 500 near-misses. Stringify/parse cycles will eventually dominate.
- **Fix:** keep an in-memory `_state: LearningState | null` cached on first read; use `fs.watch` (or a dirty flag with debounced flush) instead of writing on every mutation. With 5 user events per minute × `JSON.stringify(state, null, 2)` of a 1 MB document, you're spending ~20 ms × 5/min = 100 ms/min of pure serialization.

### LLM chain
- See Section 1, win #5 — first-provider Groq cold path adds up to 20 s to chat replies on outage.
- `keep_alive: "1h"` for Ollama (`fallbackChain.ts:267`) is correct — keeps the model in RAM.
- Circuit-breaker is **per provider** but Ollama uses **per-model** keys (`ollama:${ollamaModel}`, line 250). That's correct.

---

## Section 6 — Quick wins (≤30 min each)

1. **Switch avatar `Image` → `ExpoImage` with `memory-disk` cache** (`src/components/MessageBubble.tsx:672`). Single line change. Eliminates per-render JPEG decode of 50 KB base64 strings.
2. **Memoize `getPrimaryInboxId(message.senderAddress)`** (`src/components/MessageBubble.tsx:558`) — wrap in `useMemo([message.senderAddress])`. Even before the deeper reverse-index fix, this avoids the O(N) scan on every render.
3. **Lower Groq timeout to 8 s + trip breaker after 2 failures** (`src/lib/llm/fallbackChain.ts:103, 51`). Two-line change.
4. **Convert `applyReaction` / `applyEdit` / `applyStickerReaction` to `findIndex` + `slice` + spread** (`src/lib/xmtp.ts:524, 582, 1379`). Drops O(N) clone to O(1) clone.
5. **Add `_msgById: Map<string, ChatMessage>` to `chatStore.ts`** alongside `_msgIdSet` (`src/store/chatStore.ts:43-209`). Replace every `messages.find(m => m.id === ...)` in `useXmtp.ts:1017, 1036, 1185, 1220, 1386` with `_msgById.get(...)`.
6. **Defer `useFreeRasp()`** behind `setTimeout(2000)` in `_layout.tsx:43`. Already established pattern (see push registration on line 122).
7. **Move `registerLiveKitGlobals()` to first room-join site** instead of `_layout.tsx:33` module load. The function is idempotent.
8. **Cache `loadLearning()` result in module-level variable** in `src/lib/hermesMemory.ts:837`. Set dirty flag inside `saveLearning()`, do `_cache = null` after writes. ~10 lines.
9. **Pre-build `Map<mint, ScanResult>` in `xmtpOnlyMonkes.ts:1781`** before the tick callback runs, so `fetchTA` becomes O(1) instead of `getLastScanResults().find()`.
10. **Parallelize 1 H + 4 H + 15 m + 1 D OHLCV fetches** in `tokenScanner.ts:1271-1288`. The pre-filter on 1 H can run after `Promise.all` resolves; if the filter rejects, the parallel results are simply dropped (already paid the rate-limiter token).
11. **Compress watermark.png** (`assets/watermark.png` is 916 KB at 1 536×1 024 RGBA — way oversized for a 120×60 render target). Down-sample to 240×120 to save ~870 KB of asset bundle.
12. **Re-check `firebase` (web SDK) in deps** — `node_modules/firebase` is 58 MB and `@firebase` is 104 MB. Only `@react-native-firebase/*` is actually used. Removing the transitive `firebase` web SDK could trim 1–2 MB of Hermes bytecode.

---

## Section 7 — Larger refactors

### A. Split `useXmtp.ts` (2 183 lines) into focused modules
- `useXmtp.ts` is the single biggest JS module on the cold-start path (imported by `_layout.tsx:17` for `triggerProfileRebroadcast`). Splitting it into:
  - `xmtp/init.ts` (group bootstrap, identity)
  - `xmtp/stream.ts` (live message handling)
  - `xmtp/decode.ts` (`decodeAndEnrich`, reaction/sticker apply)
  - `xmtp/profileRebroadcast.ts` (the 80-line piece `_layout.tsx` actually needs)
- would let Metro tree-shake half of it from cold-start parse.

### B. `appStore` slice subscriptions
- `ChatScreen.tsx` subscribes to ~40 individual fields (`ChatScreen.tsx:114-159`). Many trigger re-renders that the screen doesn't actually use (e.g. `nftDominantColor` is only used to compute `headerAuraColor`). Migrate to the slice files mentioned in `appStore.ts:10-16` (`useUserAuthStore`, `useAppSettingsStore`, etc.) so unrelated state changes don't ripple through ChatScreen.

### C. Reverse index for `getPrimaryInboxId` + `getDeduplicatedUsers`
- Both functions today scan `_profileCache.entries()`. Build:
  - `_walletToPrimary: Map<wallet, inboxId>` updated in `cacheProfile()` (`userProfile.ts:156`) — O(1) lookup.
  - `_walletToInboxes: Map<wallet, Set<inboxId>>` for dedup logic.
- Touches `cacheProfile`, `getPrimaryInboxId`, `getDeduplicatedUsers`, and the LRU eviction code. ~150 lines of refactor.

### D. Hermes Memory state-management
- The current "load → mutate → save" pattern on every event is the wrong shape for a 1 MB+ JSON file with bursty writes.
- Replace with:
  - Single in-memory `_state` initialized lazily.
  - Write-through API: `recordX()` mutates `_state` and marks dirty.
  - Background flusher debounces writes to once per 5 s.
  - `process.on('beforeExit')` flushes synchronously.
- Side benefit: `getAutoMutedTokens` / `getPerTokenThresholds` become O(1) Map lookups instead of file reads.

### E. Bot scanner provider abstraction
- `tokenScanner.ts` is 1 509 lines with 8+ inlined provider functions (`fetchOHLCVFromGT`, `fetchOHLCVFromDP`, etc.). Extract each into `src/lib/scanner/providers/<name>.ts` with a uniform `OhlcvProvider` interface. Lets you parallel-fan-out attempts across providers and pick the first valid response (instead of strict serial fallback).
- Also lets you write provider-level unit tests in isolation.

### F. ChatScreen → split into `ChatScreen` (1 584 lines) + `ChatScreenHooks`
- The screen file mixes UI, network init, AppState handling, and OTA upgrade sweepers. Pulling effects out into a dedicated `useChatLifecycle()` hook would make the render function tractable and reduce accidental re-render scope.

---

## Appendix — files cited
- App: `/Users/davidmartin/AndroidStudioProjects/OnlyMonkes/app/_layout.tsx`, `/src/screens/ChatScreen.tsx`, `/src/screens/GlobeScreen.tsx`, `/src/components/MessageBubble.tsx`, `/src/components/ChatMessageList.tsx`, `/src/store/chatStore.ts`, `/src/store/appStore.ts`, `/src/hooks/useXmtp.ts`, `/src/lib/xmtp.ts`, `/src/lib/userProfile.ts`, `/src/lib/geocode.ts`, `/src/lib/remoteConfig.ts`, `/src/lib/constants.ts`, `/assets/watermark.png`, `/assets/icon.png`, `/.expo-export-perf-audit/_expo/static/js/android/entry-a520e9439ea5b99706d1a60908f6ea30.hbc`.
- Bot: `/Users/davidmartin/Monke_Eliza/agents/monke-trader/src/services/xmtpOnlyMonkes.ts`, `/services/driftUptimeMonitor.ts`, `/lib/scanner/tokenScanner.ts`, `/lib/automonke/engine.ts`, `/lib/llm/fallbackChain.ts`, `/lib/hermesMemory.ts`.
- Log: `/tmp/monke-bot.log` (17 MB, 212 609 lines).
