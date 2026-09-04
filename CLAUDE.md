# OnlyMonkes — Rules for Claude and Grok

This file stores all rules and constraints so **Claude and Grok** never make the same mistakes twice.
Rules are added over time as issues arise.

**Do not add new files at this repo root** (no extra `NOTES.md`, plans, or audits next to `package.json`). App code goes under `src/`, `app/`, `worker-actions/`. Scratch goes in `/tmp` or `.claude/`.

**Bot host (VPS, no GPU):** keep `Monke_Eliza/agents/monke-trader/VPS.md` and `Monke_Eliza/CLAUDE.md` in lockstep with this file. The bot repo has its own `CLAUDE.md` — AIs working in `Monke_Eliza` will not see this app file. Any change to where the bot runs, the LLM chain, Ollama, or Helius webhooks must update that `VPS.md` + both `CLAUDE.md` files + both READMEs **in the same commit**. After push: `git pull` on `monke@157.173.192.39:/home/monke/Monke_Eliza`.

---

## Security & Privacy

- **NEVER store keys or sensitive data from any users.** No private keys, seed phrases, wallet secrets, or authentication tokens are persisted in code, logs, or state.
- **NEVER log or expose** XMTP inbox IDs, wallet addresses, or push tokens in user-visible UI. Internal debug logs only. **One deliberate, narrow exception (2026-09-02)**: `DmInboxScreen`'s long-press → "View Sender Info" modal shows the peer's inboxId + wallet address (if known) for anti-scam identity verification in 1:1 DMs — opt-in only, never shown by default, requested explicitly to stop a PFP+name-only DM from being spoofable/ambiguous. Do not extend this pattern to any always-visible UI (chat bubbles, profile cards, etc.) without the same explicit reasoning.
- **NEVER commit** `.env`, `.xmtp_bot_key`, `credentials.json`, keystore files, or any file containing secrets to git.
- **NEVER hardcode** API keys, private keys, or secrets in source code. Always use environment variables.

## Build & Deploy

- **NEVER run `adb uninstall`** — it wipes XMTP credentials + wallet state, resetting the app completely.
- **Always use `adb install -r`** (replace) for APK installs. Never uninstall + reinstall.
- On signature mismatch: **fix the keystore**, do NOT uninstall.
- The project debug keystore lives at `android/app/debug.keystore` — if it changes between builds, signature mismatch occurs.
- AAPT2 rejects JPEG files with `.png` extensions — always verify image format with `file` command before adding assets.
- Bare workflow: `runtimeVersion` must be a static string (e.g., `'2.22'`), NOT `{ policy: 'appVersion' }`.
- **Runtime 3.3 is the published dApp Store binary (Saga). Do not rebuild it.** No new APK, no native MainActivity/Gradle/edge-to-edge changes, no `eas build` targeting production 3.3. Store 3.3 is Reanimated 3 — **never OTA master / Reanimated 4 JS to runtime 3.3**. Fixes for live 3.3 users are **JS OTA only** from the `ota-3.3` worktree (`eas update --branch production`, `runtimeVersion: '3.3'`). Do not port 3.4-only native features (immersive / edge-to-edge) onto 3.3.
- **Runtime 3.4 / v3.0 (versionCode 49) is the current dApp Store submission APK.** Master `app.config.ts` `runtimeVersion` is `'3.4'`. versionCode 48 was already consumed by the rejected 3.0.3 upload — do not reuse 48.
- **2026-08-31 policy — this 3.4 binary is OTA-only until further notice.** All work against this codebase from here on must be JS-only and OTA-deployable (`eas update` against runtime 3.4, no native/Gradle/manifest/permission changes, no new native modules) so it can ship to the submitted binary without a new APK/re-review. The moment a task genuinely needs a native rebuild (new native module, Gradle/Kotlin/NDK bump, manifest permission, native crash fix that can't be patched JS-side, etc.), **do not build it against master** — start a fresh `OnlyMonkes-3.1` worktree/folder (same pattern as the existing `OnlyMonkes-ota-3.3`/`OnlyMonkes-ota-3.4` worktrees) and accumulate native-requiring work there until there's enough to justify the next APK build + dApp Store resubmission. Ask before assuming a change is OTA-safe if unsure — check against this exact list first.
- **Expo SDK 53 + RN 0.79.6** requires: Gradle 8.11.1, Kotlin 2.0.21, compileSdk 35, NDK 26.1.10909125 — **bumped to NDK 27.1.12297006 on 2026-07-09** for Nitro Modules (vision-camera 5 / react-native-nitro-modules / react-native-nitro-image, which require NDK 27+). Untested combo as of this note; if a native build breaks in a new way, check here first.
- **SoLoader must use merged SO mapping**: `SoLoader.init(this, OpenSourceMergedSoMapping)` — NOT `SoLoader.init(this, false)`. RN 0.79 merges native libs into `libreactnative.so`; without the mapping, `libreact_featureflagsjni.so` crash on startup.
- **`LiveKitReactNative.setup(this, AudioType.CommunicationAudioType())` must run at the top of `MainApplication.onCreate()`**, above SoLoader/Sentry. Without it, LiveKit's own teardown (`invalidate()`, fired on every `ReactInstance.destroy()` — i.e. ANY JS reload, including an `expo-updates` OTA apply) throws `IllegalStateException: audioRecordSamplesDispatcher is not initialized!` and crashes the whole app, regardless of whether Avatar Room/LiveKit was ever used that session. Found missing 2026-08-25 (present on both master/3.4 and the published dApp Store 3.3 binary — the 3.3 binary can't be patched, only avoided going forward on 3.4+ builds).
- **R8/ProGuard disabled** for release builds — R8 strips JNI loaders needed by RN 0.79 new arch. APK is ~88MB without minification.
- **Face tracking uses Google ML Kit** via `react-native-vision-camera-face-detector`, NOT MediaPipe. `FaceTracker.tsx` runs a 1×1px invisible camera + frame processor and derives blendshape-shaped values (jawOpen from lipGap/faceH, head rotation, smile/blink) for the Avatar Room data channel. MediaPipe was retired — no patch file needed.
- **Post-build cleanup**: run `scripts/post-build-cleanup.sh` after each build to reclaim ~3GB of native build intermediates. Critical on low-disk Macs.
- **My Passport** (`/Volumes/MyPassport/OnlyMonkes-cache/`) stores NDK 25, build-tools 36, platforms, and Gradle caches offloaded from local disk.

## XMTP & Messaging

- **Inbox ID is wallet-bound, not device-bound.** Never use `Client.createRandom()` for a logged-in wallet. Same Solana wallet must produce the same XMTP inboxId on every phone, runtime (3.3/3.4), OTA, and reinstall: `prepareWalletBoundXmtp()` + `src/lib/xmtpIdentity.ts` (HKDF of a domain-separated MWA `signMessage` → secp256k1 EOA → `Client.create` / `addAccount`). Do **not** change `XMTP_IDENTITY_DOMAIN` (`onlymonkes-xmtp-identity-v1`) or the signed message shape — that would mint a new inbox for every user. Local `dbEncryptionKey` may stay per-device (installation). Legacy random inboxes: first device to bind `addAccount`s the derived EOA onto the existing inbox; the other phone `Client.create`s into that inbox.
- **Combine leftover APK inboxes by wallet, never by deleting MLS members.** Do not auto-`removeMembers` leftover inboxes (that can lock a still-open install out of chat). Bot: `backfillFromInboxWalletMap` on boot from `.xmtp_user_wallets.json` into `knownInboxIds`; skip "Welcome home" when `isReturningWallet`; count unique wallets not unique inboxes. App: `rememberLocalInboxId` + signature-verified `/myinboxes` for `isMineInbox`. Do **not** treat PROFILE_UPDATE `w` as proof of ownership (spoofable). `/reclaim` restores bananas/shop; it does not merge MLS history.
- **Group / channel IDs are remote and frozen.** `config/app-config.json` (`globalGroupId`, `botChannels.trades`). Never mint a new MLS group from the app (`getOrCreateGlobalChat` / dApp groups join-only). After a bot-side DB wipe + group recreate, update `app-config.json` **and** bot `.env` — do not create a replacement group in the client.
- **System message prefixes** (PRESENCE:, TYPING:, PROFILE_UPDATE:, EVENT:, EDIT:, DELETE:, REACT:, STICKER_REACT:, LIVE_ROOM:, VIDEO_ROOM:, AVATAR_ROOM:, THREAD:, PIN:, UNPIN:, NFT_LIST:, NFT_BID:, NFT_OFFER:, NFT_ACCEPT:, NFT_DELIST:, NFT_SWAP:, NFT_COMPLETE:, AUTOMONKE_STATUS:, TRADE_CLOSED:, MY_INBOXES:, JOIN_REQUEST:, GENESIS_JOIN_REQUEST:) must ALWAYS be filtered in `decodeMessage()` so they never appear as chat messages.
- **DELETE:** broadcasts a message deletion (`src/lib/deletedMessages.ts`, format `DELETE:<messageId>`) so it propagates to every device and survives history resyncs — a bare local removal doesn't (the network copy resurrects on the next reconnect). Authorized senders: the target message's original author, or the app's single admin inboxId (owner — can delete anything, including the bot's messages). Verified on BOTH the sending client's UI gate (`MessageBubble`: `isOwn || isGroupAdmin`) and the receiving client (`useXmtp.ts` stream handler cross-checks the requester against the target's real sender / admin inboxId) since a decentralized log can't enforce permissions server-side.
- **TRADE_CLOSED:** structured DM emitted by the bot's AutonoMonke close path (`engine.ts:closePosition`). Format: `TRADE_CLOSED:{token,mint,entrySolAmount,exitSolAmount,pnlPct,pnlSol,durationMs,reason,ts,...}`. App parses via `parseTradeClosed()` in xmtp.ts (sender must be in `BOT_INBOX_IDS` to prevent spoofing) and pushes a `ClosedTrade` to `tradesStore`. Manual round-trip swaps emit the same `ClosedTrade` shape locally via `src/lib/positions.ts` hooked into `executeSwap`.
- Bot message format is **always** `MSG:AI Agent #9385:<content>` — any deviation breaks display in the app.
- PRESENCE heartbeats are sent every 3 min via XMTP group `send()` — the bot must ignore them (they are not user messages).
- After any XMTP DB wipe + group recreation, the group ID changes — update `app-config.json` and bot `.env`.

## Architecture

- **solana-alert-bot is RETIRED** (archived at `~/solana-alert-bot.retired`). All bot functionality lives in Monke_Eliza.
- Monke_Eliza is the single source of truth for TA scanning, alerts, and bot behavior. No `bot_state.json` dependency.
- The token scanner (`tokenScanner.ts`) scans the discovery universe every 10 min (GeckoTerminal when a slot is free — never wait — + DexPaprika + PumpFun + Birdeye last resort). Moralis does NOT support Solana OHLCV — removed. **PumpFun/some DexPaprika candles are TOKEN/USD while `token.price` is TOKEN/SOL.** Rescale USD→SOL with `applyUsdSolRescale` from the token's own SOL price — **do not use Pyth SOL/USD** (SSE 401 left KMNO-only coverage, 2026-08-26). Real mismatches (wrong pool, 1e9×) still skip. Live book is MonkeBrain; classic TA is Hermes shadow only. **PYTH token is blocked from AutonoMonke/MonkeBrain alerts & fills; `/chart` `/ta` still work.**
- **Saga Monkes is an NFT collection, not an SPL token.** `/ta`, `/chart`, `$SAGAMONKES`, and group asks like “sagamonkes chart / Fibonacci” must **not** go to Birdeye/Dex/LLM (that printed ~2.15 SOL on a random mint). Intercept via `isSagaMonkesQuery` + `formatSagaMonkesFloorTa` (`agents/monke-trader/src/lib/nft/sagaMonkesFloor.ts`): live CoinGecko floor (~0.61 SOL as of 2026-08-20), reconstructed daily floor candles, Fib, Tensor link, optional chart image. Label it collection floor.
- **taSavvyMonke.ts is DELETED** — all scanner/TA/AutonoMonke/Drift BET functionality merged into xmtpOnlyMonkes.ts (single unified bot identity: "AI Agent #9385").
- **Alert threshold**: 50 (bipolar scale -100 to +100). Regime-adaptive: bull=45, bear=60, ranging=52, volatile=55. Low conviction signals filtered. Alerts with bad Fib data (>50% off entry) are skipped entirely.
- **MonkeBrain is AutonoMonke.** Classifier is automatic: **age < 7d → NEW TOKEN** (safety/liq/vol/flows/holders/mom, fills **0.05 SOL**). Else MEME vs ESTABLISHED. Classic TA composite is Hermes shadow only — do not buy off bipolar composite. **After entry, `tickPositions` still manages the trade**. Pump.fun sniper is a separate 0–10m lane. **HQ/Legendary fills are not vetoed by user `minConfidence` (HQ 72 used to die on a 75 AI bar).** **2026-09-04:** `risk_on`/`risk_off` is **not** an entry gate. Alerts + AutonoMonke fire at **MonkeScore ≥ 69** (Conditional+) on any tape. Watchlist band is parking only (safety/liq/bundle slam). Classic TA 60–69 near-misses may show as `TA SHADOW — no fill` in MonkeTrades (max 2/cycle, no AutonoMonke). Future Pro: NewTokenBrain / MemeBrain / AltBrain inside MonkeBrain. See `Monke_Eliza/agents/monke-trader/src/lib/monkeBrain/` + bot `CLAUDE.md`. **2026-09-03: `engine.ts`'s `evaluateSignalForUser` carried its own duplicate copy of this gate, out of sync with the canonical one** — silently re-rejected HQ signals ($OTC, $MYCEL) that had already passed. Fixed (missing `newToken` risk_off-RS exemption + missing `!isMonkeBrain` volume-floor carve-out); `processSignalForAllUsers` now returns a real fill count instead of blindly logging `traded: true`.
- **Hermes Memory** (`hermesMemory.ts`): per-user AES-256-GCM encrypted trading memory + global learning engine. Auto-closes alert outcomes every scan cycle by monitoring real prices against T1/T2/stop. Feeds: Alert Quality Badge, Personalized DM Warnings, Portfolio Copilot, Auto-Tune, Weekly Digest, Bot Self-Awareness, Social Signals, Streaks, `/hermes` command.
- **Hermes Solana Toolkit**: OpenClaw extension at `~/.openclaw/extensions/solana-toolkit/` — `solana_trending` + `solana_token_chart`. Discoveries written to `~/.hermes_memory/hermes_signals.json`, ingested by bot scanner.
- **Chat LLM chain**: Groq direct (`openai/gpt-oss-20b` / `GROQ_FAST_MODEL`, TPD 200k — 429 opens Groq 15m) → Gemini 3.6 Flash → OpenRouter (Llama 3.3 70B aggregator) → Ollama local (DeepSeek R1 1.5B + Qwen 3 1.7B) → xAI (`grok-4.20-0309-non-reasoning`, `XAI_API_KEY`) **last, on purpose**. Cerebras is opt-in (`CEREBRAS_ENABLED=true`) — the account is paid-quota (HTTP 402). Model IDs live in `src/lib/llm/models.ts`. Anthropic SDK has been removed from the chain — circuit breaker (2 failures = 5min cooldown per provider) defined in `src/lib/llm/fallbackChain.ts`. Groq retired `llama-3.3-70b-versatile` / `llama-3.1-8b-instant` on 2026-08-16. MonkeBrain alert copy is combinator-only unless `MONKEBRAIN_LLM_COPY=1`. **2026-09-01: `grok-4-1-fast` never existed on this xAI account/plan** (confirmed via `GET /v1/models` — it 404'd silently since whenever that config was written); swapped to `grok-4.20-0309-non-reasoning`. **Also moved xAI to the LAST position in the chain, per explicit user direction** — it's the only paid-per-token step left, so every free/local option gets tried first (don't burn xAI credits on requests Groq/Gemini/OpenRouter/Ollama could have handled). Do **not** put grok-4.6 on this chain (too slow/expensive for a fallback hop). **2026-09-03: Ollama timeouts tightened 90s/60s → 45s/30s** — the two Ollama attempts alone could burn 150s of a ~211s worst-case chain, plausible root cause of "the bot doesn't reply" reports. Also: chat replies (group @mention/reply-to-bot + all DMs) now run detached from the XMTP stream's `for await` loop instead of being awaited inline — both streams process every message sequentially bot-wide, so one slow reply used to block every other user's message behind it.
- **`/donate [usdc] [amt]` DM/group command** (2026-09-01, `xmtpOnlyMonkes.ts`, same Solana Pay deep-link pattern as `/tip` — no hot wallet/bot custody, the user's own wallet app signs it): sends SOL (default, cap 10) or USDC (cap 500) straight to the publisher/treasury wallet (`DEV_WALLET`/`BzyaYyd7ew7SRqC1P9Q6z61ebfYmdXRFU6UfKjHzcQ2o`) to help cover server/RPC/AI API costs — same wallet the OnlyTreasury screen/digest already track. xAI has no crypto/API for automatic top-ups (confirmed) — this only gets SOL/USDC into the treasury wallet; converting that into actual xAI account credit is still a manual step via console.x.ai.
- **Trade confidence**: Multi-perspective analysis (Bull/Bear/Risk) via Groq + Gemini (Cerebras only if `CEREBRAS_ENABLED=true`) + Ollama in parallel — replaced OpenClaw gate in engine.ts. Synthesis: `bull*0.4 + (100-bear)*0.3 + risk*0.3`.
- **Production bot is VPS-only**: `systemd` unit `monketrader.service` on `monke@157.173.192.39` (`/home/monke/Monke_Eliza/agents/monke-trader`). Logs: `/home/monke/monke-bot.log`. **Never start** `com.onlymonkes.monketrader` on the Mac — a second bun process locks the XMTP DB. Mac LaunchAgent plist is leftover, not production.
- **VPS has no GPU** (KVM AMD EPYC). Ollama there is CPU-only (`deepseek-r1:1.5b`, `qwen3:1.7b`) and last-resort. Do not pull GPU models. Do not route chat through the Mac Ollama tunnel. Full host notes: `Monke_Eliza/agents/monke-trader/VPS.md`.
- **Solana Agent Kit** (`src/lib/sak/`): DM commands `/limit`, `/stake`, `/unstake` via `solana-agent-kit@2.0.10`. Borrow-and-return keypair pattern via `withSAK()`. Risk-gated through existing `riskManager.ts`.
- **Bot persona**: "Monke" — ball-busting, banana-obsessed, confident. Defined in `~/.hermes/SOUL.md` + `buildSystemPrompt()`.
- Data files (`.xmtp_bot_key`, `.xmtp_welcomed.json`, `.xmtp_stale_tokens.json`) live in `~/Monke_Eliza/agents/monke-trader/`, NOT in `~/solana-alert-bot/`.

## UI / UX

- **Bot alert cards (MonkeTrades TA setups + MonkeBrain) must never collapse.** `MessageBubble.tsx`'s `showBotExpand` auto-collapses any bot message over 9 lines/380 chars to `maxHeight: 9*22` with a small "expand" label — both alert formats (`formatMainChatAlert`, `formatMonkeBrainAlert`) routinely exceed that and always end with `⚡ <Blink action>` then a closing "DYOR" sentence, so real production alerts were reliably clipping that tail off (2026-09-03 bug report — looked like the Blink buy button itself was cut off, though it's a separate `BlinkCard` that still rendered fine below). Fixed by exempting any bot message containing a Blink action (`extractBlinkUrl(displayContent)`) from the collapse. Don't remove that exemption without re-checking real alert length against the 9-line/380-char thresholds.
- Live room signaling (`AVATAR_ROOM:`, `VIDEO_ROOM:`, `LIVE_ROOM:`) must NEVER show raw JSON in chat. Use `LIVE_PILL:` synthetic messages to display a styled pill with JOIN button.
- **Live Audio rooms are DISCONTINUED** (v2.33). Replaced by Avatar Rooms. `LIVE_ROOM:` messages still parsed for backward compat but no new audio rooms can be started. Files kept but unused: `liveAudio.ts`, `LiveAudioRoomScreen.tsx`, `LiveAudioPill.tsx`, `app/live-room.tsx`.
- **Avatar Rooms** (`avatarRoom.ts`): Animated NFT PFP avatars with mouth sprite overlays driven by ML Kit face tracking jaw openness (or audio energy fallback). Head tilt/nod/turn from face tracking rotation. Skia canvas overlay (`SkiaAvatarOverlay.tsx`) exists but is unwired — the consumer is `AnimatedAvatar.tsx`; `SkiaAvatarOverlay` is a future option pending per-collection (Saga Monkes) calibration of eye/brow positions. Minimize to pill in Main Chat. Sticker reactions via data channel.
- Messages load newest-first on app open. Older messages load in background without visible flicker.
- **No native BlurView, anywhere — use `src/components/LiquidGlass.tsx` instead.** Both `expo-blur`'s Android path and `@sbaiahmed1/react-native-blur` (removed 2026-08-24) wrap the same `com.github.Dimezis`-lineage `PreDrawBlurController`, which crashes (`IndexOutOfBoundsException`) whenever it redraws mid-`react-native-screens` transition — hit repeatedly across 4+ separate sessions (2026-08-19, twice on 2026-08-22, confirmed root-caused 2026-08-23) and never fully closed by "defer the mount" timing hacks. `LiquidGlass` (a translucent gradient scrim, same call-site shape: `<LiquidGlass as BlurView style={...} />`) sidesteps the crash class entirely — no real per-pixel blur, but zero native-crash risk. Chrome-bar color identity when no World/Banana-Shop-theme is equipped comes from `MONKE_BLUE`/`resolveBarTint()` in `src/lib/constants.ts`, not a flat neutral tint.
- `react-native-svg` is a REQUIRED transitive dependency (`sonner-native` toast icons depend on it; it is installed at the SDK-53 version `15.11.2` and linked into the APK). Do NOT remove it — its absence breaks the Metro bundle (`Unable to resolve module react-native-svg`). The old "removed in 2026-04 cleanup" note was wrong: it had merely drifted out of `package.json` while lingering in `node_modules`, and a clean install on 2026-06-19 pruned it and broke the bundle (now pinned explicitly). Still avoid adding NEW SVG-based UI in our own components (use View-based alternatives) — that guidance is about our code, not the package.
- **Genesis Chat** (2026-08-20, member posting added 2026-08-24): restricted tier for Saga Genesis Token (`46pcSL5gmjBrPqGKFaLbbCmR6iVuLJbnQy13hAe7s6CC`) or Seeker Genesis Token (soulbound Token-2022, mint authority `GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4`). No Saga Monke → Genesis Chat (plain text-only message bar, no CAM/GIF/slash-commands — bot still only posts its own scheduled content, doesn't reply to member chatter) + BananaShop + Leaderboard only. **Join DMs bind to XMTP `senderInboxId`**, payload is only `JOIN_REQUEST:<wallet>` / `GENESIS_JOIN_REQUEST:<wallet>`. Bot verifies **wallet owns** the credential (`walletOwnsSagaMonke` / `checkGenesisGate`) — never "this mint string is in the collection" and never a claimed inboxId. Genesis join never adds to Main/Trades. SGT cannot be sold (device-bound); genesis session flag is wallet-scoped with 6h TTL for wallet-switch, not resale. Dual holders: `ChatModeSwitch`. 3.4 only — do not OTA onto runtime 3.3. Create the Genesis MLS group fail-closed (admin), then `genesisGroupId` in remote config + `XMTP_GENESIS_GROUP_ID` on VPS.
- **Bot channel bar is MonkeTrades only.** Bets / Predictions / Sales icons stay off the composer. NFT sales alerts are merged into the Trades group (`salesGroup = tradesGroup`). Apply on **both** runtimes: 3.3 production OTA from `ota-3.3` worktree; 3.4 preview OTA from `ota-3.4` worktree. Do not resurrect the 4-icon bar. **2026-09-03: sale delivery had a silent-drop bug** — both the bot's direct-to-bot Helius webhook (`POST /helius-webhook`, port 3001, publicly bound) and its 180s polling safety-net (`sagaMonkesSales.ts`, single creator wallet — royalties always pay on Tensor so coverage wasn't the issue) used to mark a sale seen/persisted *before* confirming the send succeeded, so a transient failure on either path blackholed the sale forever with zero retry. Both now only mark/persist after a confirmed send.
- **BananaBetting fully removed from the bot (2026-09-02)** — not just the composer icon. Zero real participation across every bet ever generated (confirmed: all 9 open bets in `.banana_bets.json` had empty stake pools). Deleted bot-side: the 4x/day (9am/1pm/6pm/10pm EST) Main Chat generator, `/bet`/`BANANA_BET_PLACED:` placement, `/settlebet`/`/openbets` admin commands, auto-resolve tick, all broadcast/payout/settlement helpers, and the underlying `lib/betting/{bananaBetting,bananaBetGenerator}.ts` + `lib/predictions/` (Polymarket/Kalshi/Jupiter sports+prediction market scanning) source files in `Monke_Eliza`. App-side `BANANA_BET_*` message parsing/filtering left in place (harmless, needed for old chat history) — do not resurrect the scanner or generator without a fresh product decision.
- **Composer toolbar:** CAM / LIVE / GIF pack **left** (not `space-evenly` after dropping 3 channels). **Right:** Messages envelope (`MenuIcon` `messages`, Banana Shop / world accent) + MonkeTrades. **Center** (dual Saga-Monke-+-Genesis-Token holders only, absolutely positioned so it's truly centered regardless of the left/right groups' widths — 2026-08-24, moved down from the header): the Main/Genesis switcher (`ChatModeTabs`, passed into `ChatInput` via its `chatModeTabs` prop — only Main Chat's usage passes it, DM/GroupDM/Thread never do). Messages is **not** a Banana Menu grid tile. **3.4 debug APKs do not receive preview OTAs** unless they were built with `channel: preview` — debug still shows the 4-icon bar and dead Giphy until a new debug install or Metro from current source.
- **Ads (2026-08-24)**: `react-native-google-mobile-ads`, pinned to exactly `16.0.0` (no caret — newer versions pull a `play-services-ads` whose Kotlin metadata this project's Kotlin 2.1.20 toolchain can't read; see `src/hooks/useAppOpenAdGate.ts` for the fuller build-fix history if this ever needs revisiting). Two formats: `RewardedAdPill` (tap-to-watch, banana reward, Main 15 / Genesis 25) and an **automatic App Open ad** (`useAppOpenAdGate`, mounted once at the app root) — shows itself with no tap, only once per cold start (force-close + reopen, never on a plain background→foreground resume) and rate-limited to `APP_OPEN_MIN_INTERVAL_MS` (2h) even across repeated cold starts. **Never fires before a user is verified** — `verified`/`isGenesisHolder` aren't persisted (appStore.ts has no `persist` middleware), so both are false at cold start and the ad unit ID stays `null` (inert) until this session's own on-chain ownership check actually completes. **First-ever automatic ad is preceded by `AdDisclosureModal`** (AsyncStorage flag, once per install) — explains the ad exists, and that revenue is swapped to $SKR, staked, used to pay OnlyMonkes' server/API costs, and builds a standing $SKR Vault (eventually: community giveaways + buying Saga Monkes to add to the Vault) — never shown silently before that disclosure is acknowledged. All ad unit IDs in `src/lib/ads.ts` are still Google's public **test** constants — swap for real ones under publisher account `pub-5684183956469893` once they exist; nothing else needs to change.
- **TEEPIN:** no public third-party TEEPIN API (reconfirmed 2026-08-22 against docs.solanamobile.com + the TEEPIN press release — Guardian Network is still first-party-only). App uses Android Keystore/StrongBox (`DeviceAttestModule`) + worker `/api/sentiment/*` (dwell oracle). Hermes stamps `oracleContext` on alerts from `GET /api/sentiment/score`.
- **Device Integrity Attestation** (2026-08-22): the general-purpose follow-up to the dwell oracle's own "cert chain never verified server-side" gap — reuses the SAME `DeviceAttestModule` hardware key (no second key, no new native code). Worker (`worker-actions/src/deviceIntegrity.ts`) parses + chain-verifies the Android Key Attestation `KeyDescription` X.509 extension via `@peculiar/x509`/`@peculiar/asn1-android` against two pinned Google hardware roots (legacy RSA to 2042 + newer ECDSA "Key Attestation CA 1" to 2035 — Google is mid-RKP-rotation, both currently valid), combined with RASP-clean state + live Saga Monke/Genesis ownership (`worker-actions/src/genesisVerify.ts`, ported from app/bot). Verdict is **backend-verified + KV-cached (`DEVICE_INTEGRITY` namespace), NOT on-chain** — priced real Solana Attestation Service issuance at ~78 SOL/year in re-issuance tx fees at a 7-day expiry, declined given nothing on-chain reads this credential today; verdict shape intentionally mirrors what a SAS schema would hold so mirroring on-chain later is additive. Routes: `POST /api/device-integrity/{challenge,issue}`, `GET /api/device-integrity/status?wallet=`. App-side (`src/lib/deviceIntegrity.ts` + `useDeviceIntegrity.ts`): wired into `VerifyScreen.tsx` — a **confirmed hardware-chain failure hard-blocks chat** (same severity as failing NFT ownership), RASP/transient failures **soft-degrade** (chat proceeds, only sensitive actions gate). `ConnectScreen.tsx`'s fast session-restore path never blocks on this, only fires a non-blocking background refresh. Bot-side: `agents/monke-trader/src/lib/nft/deviceIntegrityGate.ts` (same cached-file pattern as `nftGate.ts`) closes a real gap — banana-bet placement (`BANANA_BET_PLACED:` / `/bet`) previously ran with **zero** ownership or integrity check. Explicitly out of scope: Google Play Integrity (unusable — OnlyMonkes never ships via Google Play, so its app/licensing verdicts would false-positive-reject every real install), IP-based geo-gating (spoofable, not built), biometric human-uniqueness (no integration path). Known gap: no revocation-list checking against `android.googleapis.com/attestation/status` yet.
- **FlashList** replaces FlatList in ChatScreen for message list (cell recycling, 3-5x fewer frame drops).
- **$TOKEN mentions are tappable** in chat — opens ChartModal with candlestick chart (react-native-wagmi-charts).
- **Free-RASP** runtime security: root/jailbreak detection, Frida hook detection, app tampering, emulator detection. `useFreeRasp()` in `_layout.tsx`. Call `assertDeviceTrusted(action)` (throws on a hard threat) before sensitive operations — already wired into swap/tip/purchase/NFT-sale/receipts/dApp-bridge/Blink-action paths; `isDeviceCompromised()` is the non-throwing bool-check variant, used less often. Don't conflate the two when auditing coverage — a 2026-08-22 planning pass did and had to correct itself.
- **Krisp noise filter** enabled in Avatar Room audio (`@livekit/react-native-krisp-noise-filter`).

## Dependencies & Compatibility

- Expo SDK 51, React Native (bare workflow)
- `expo-router` file-based routing under `app/` — no v3+ features
- `@livekit/react-native` + `livekit-client` for audio/video/avatar rooms
- `@livekit/react-native-krisp-noise-filter` for AI noise cancellation
- `@xmtp/react-native-sdk` v5 MLS for messaging
- `@shopify/react-native-skia` for GPU-rendered avatar expression overlays
- `@shopify/flash-list` for high-performance message list
- `react-native-vision-camera` + `react-native-vision-camera-face-detector` (Google ML Kit) + `react-native-worklets-core` for camera frame processing & face tracking
- `react-native-wagmi-charts` for candlestick token charts
- `freerasp-react-native` for runtime application self-protection
- `solana-agent-kit` + `@solana-agent-kit/plugin-token` for DeFi DM commands (bot)
- `react-native-google-mobile-ads` **pinned to exactly `16.0.0`** (no `^`) — see Ads note above; do not bump without re-checking the Kotlin-metadata/API-availability constraint that pin exists for
- BouncyCastle `bcprov-jdk15on` must be excluded in `build.gradle` to avoid duplicate class conflicts

## Security Scanning (MANDATORY — run on every code change)

Every time code is written or modified, the following security checks MUST pass before committing. These are non-negotiable and apply to all files in both the app (`OnlyMonkes/`) and bot (`Monke_Eliza/`) codebases.

### Pre-commit checks

1. **Secrets scan** — grep all staged files for hardcoded secrets before every commit:
   - API keys, private keys, seed phrases, mnemonics, JWTs, bearer tokens
   - Patterns: `/[A-Za-z0-9_-]{32,}/` near `key`, `secret`, `token`, `password`, `credential`, `mnemonic`, `seed`
   - Firebase service account JSON files, `.p8` files, keystore passwords
   - If ANY match is found, **block the commit** and move the value to `.env` or SecureStore

2. **No secrets in source** — the following must NEVER appear in `.ts`, `.tsx`, `.js`, `.json`, or `.gradle` files:
   - Hardcoded API keys (Helius, GIPHY, Cloudinary, LiveKit, Sentry, Jupiter, Birdeye, OpenAI, Anthropic, SharpAPI, OddsAPI)
   - Hardcoded private keys or wallet keypairs (Solana `Uint8Array`, base58-encoded keys)
   - Hardcoded Firebase service account credentials
   - Hardcoded XMTP bot keys
   - Inline connection strings with passwords

3. **Sensitive data logging** — NEVER log to console or Sentry:
   - Private keys, seed phrases, or wallet secrets
   - Full XMTP inbox IDs in user-facing UI (debug logs OK)
   - Push tokens, FCM tokens, or auth tokens
   - User wallet addresses in error messages visible to other users
   - AES encryption keys or IVs from AutonoMonke wallet vault

4. **Input validation at boundaries** — all external input MUST be validated:
   - User DM commands: sanitize before processing (no eval, no template injection)
   - API responses: validate shape before accessing nested properties
   - XMTP message content: always decode safely, never trust raw payload structure
   - URL parameters: validate and sanitize before use in fetch/navigation
   - Amounts/numbers from user input: parseFloat/parseInt with bounds checking and NaN guards

5. **OWASP Top 10 for mobile** — check every code change against:
   - **Injection**: no string concatenation in queries, RPC calls, or shell commands; use parameterized patterns
   - **Broken auth**: wallet sessions use SecureStore (encrypted); never store session tokens in AsyncStorage or plaintext
   - **Sensitive data exposure**: all keys in `.env` or SecureStore; never in git, logs, or state dumps
   - **Insecure communication**: all API calls use HTTPS; LiveKit uses WSS + DTLS/SRTP; XMTP uses E2E MLS encryption
   - **Insufficient cryptography**: AutonoMonke uses AES-256-GCM; never roll custom crypto; use established libraries
   - **Insecure data storage**: no secrets in AsyncStorage; use SecureStore for credentials; wallet keys in encrypted vault only
   - **Client code quality**: no `eval()`, no `Function()` constructor, no `dangerouslySetInnerHTML`, no dynamic `require()` with user input

6. **Dependency audit** — when adding new packages:
   - Run `npm audit` and resolve critical/high vulnerabilities before committing
   - Check package last-publish date (avoid abandoned packages >2 years)
   - Prefer packages with >1000 weekly downloads and active maintenance
   - Never install packages that request unnecessary permissions

7. **Wallet & transaction security** — for any code touching Solana transactions:
   - NEVER sign transactions without user confirmation (MWA biometric in app, explicit DM approval for bot)
   - NEVER expose private keys outside the encrypted vault (AutonoMonke `walletVault.ts`)
   - Validate all transaction amounts against user-configured limits before execution
   - Fee injection must be atomic (same transaction) — never separate transfers
   - Stop-loss and position limits must be enforced server-side, not just in UI

8. **Bot-specific security** — for Monke_Eliza code:
   - NFT ownership gate must be checked before processing any DM command that accesses funds or trading
   - AutonoMonke, MonkePredictions, and MonkeBets all require explicit user opt-in + disclaimer acceptance
   - Drawdown halts ($50 max) must be enforced and cannot be bypassed
   - OpenClaw AI confidence check is a hard gate — never skip it for autonomous trades/bets
   - Position files (`.json`) must never contain private keys — only public keys and trade metadata

### How to run the security scan

Before every commit, mentally (or actually) run:
```
# 1. Secrets grep (run on all staged files)
git diff --cached --name-only | xargs grep -inE '(api_key|apikey|secret|private_key|mnemonic|seed_phrase|bearer|password)\s*[:=]' || echo "✅ No secrets"

# 2. Hardcoded key patterns
git diff --cached | grep -E '[A-Za-z0-9]{32,}' | grep -ivE '(sha256|sha512|md5|hash|commit|signature|publicKey|inboxId|groupId|\.toBase58)' || echo "✅ No suspicious keys"

# 3. Dangerous patterns
git diff --cached | grep -inE '(eval\(|Function\(|dangerouslySet|\.env\.|process\.env\.)' || echo "✅ No dangerous patterns"
```

If ANY check fails, fix the issue before committing. No exceptions.

## Remote code-fix via bot DM (updated 2026-09-03 — **not live yet**)

Goal: from **OnlyMonkes 3.0** on Seeker, DM the bot to file a coding task. Normal chat DMs are Groq→Gemini→Grok *talk*. These slash commands are *code*.

**Commands** (admin-only via `isAdmin()` / `ADMIN_INBOX_ID`, silent no-op for anyone else, not in `/help`):

- `/claude [app|bot] <task>`
- `/grok [app|bot] <task>`
- Example: `/claude app Treasury shows the wrong SKR balance on first load`

**Code (local, uncommitted until you ship it):**

- Bot: `Monke_Eliza/agents/monke-trader/src/lib/claudeFixIssue.ts` + handler in `xmtpOnlyMonkes.ts`. Issues go to `jumpstreet25/OnlyMonkes` (`app`) or `jumpstreet25/AI-Agent-9385` (`bot`) — **not** the old `Monke_Eliza` GitHub name.
- Labels: `claude-fix` / `grok-fix` (already created on both repos).
- Workflows (uncommitted): `OnlyMonkes/.github/workflows/claude-fix.yml` (PR vs `master`, OTA-only 3.4) and `Monke_Eliza/.github/workflows/claude-fix.yml` (PR vs `develop`). Need GitHub secret `ANTHROPIC_API_KEY` on both repos. Grok files the issue only — no auto-coder until a Grok session opens that issue.
- `.env.example` documents `GITHUB_ISSUES_TOKEN`.

**Still blocked (do these when you resume):**

1. Fine-grained PAT, **Issues: write** on OnlyMonkes + AI-Agent-9385. VPS bot `.env`: `GITHUB_ISSUES_TOKEN=github_pat_...` then `sudo systemctl restart monketrader`. **Not set** as of 2026-09-03 — DMs will error until it is.
2. DM the bot `/myid` from the 3.0 install. If it ≠ `ADMIN_INBOX_ID` (wallet-bound inbox can differ from the old random one), update `.env` and restart.
3. Push bot + workflow commits; `git pull` on `monke@157.173.192.39:/home/monke/Monke_Eliza`.
4. Optional: Claude Code GitHub connection at claude.ai/code (subscription path) *or* the Action + `ANTHROPIC_API_KEY` secret (API-billed). Old routine ids: `trig_011XPmixSD6PRc1MZjdPAA5h` / `env_01MBYqS7JRRaEgQtaFKS9NGa` — still unused until GitHub is connected.

Interactive fallback (no bot): claude.ai/code or Grok TUI from the phone browser. Never let the bot push to `master`/`develop`.

## Solana Actions / Blinks

- **Actions worker**: `https://onlymonkes-actions.jumpstreet25.workers.dev` (Cloudflare Worker)
- Worker source: `worker-actions/src/index.ts` — swap and tip endpoints
- **Jupiter API**: Use `api.jup.ag/swap/v2/quote` and `api.jup.ag/swap/v2/swap` — the old `quote-api.jup.ag/v6/` and `swap/v1/` endpoints are deprecated and return DNS errors from CF Workers.
- Swap amount capped at **5 SOL max** for safety. Tips capped at 10 SOL.
- All wallet addresses and token mints MUST be validated via `new PublicKey()` before use.
- Worker secrets: `HELIUS_API_KEY`, `JUP_API_KEY` (set via `wrangler secret put`)

## Message Loading

- XMTP `messages({ afterNs })` returns messages **newest-first**.
- When trimming to N most recent: `slice(0, N)` FIRST, then `reverse()` for oldest-first processing. Never reverse then slice (that keeps the N oldest).
- Main Chat loads 48 hours of messages, trims to 50 newest content messages (PRESENCE/TYPING/system filtered out).

## Code Style

- Path alias: `@/` maps to `src/`
- Zustand for state: `appStore` (user/wallet/NFT), `chatStore` (messages/UI)
- Do not add unnecessary comments, docstrings, or type annotations to unchanged code.
- Do not over-engineer — keep changes minimal and focused on the task.
