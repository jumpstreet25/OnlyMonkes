# OnlyMonkes — Rules for Claude and Grok

This file stores all rules and constraints so **Claude and Grok** never make the same mistakes twice.
Rules are added over time as issues arise.

**Bot host (VPS, no GPU):** keep `Monke_Eliza/VPS.md` and `Monke_Eliza/CLAUDE.md` in lockstep with this file. The bot repo has its own `CLAUDE.md` — AIs working in `Monke_Eliza` will not see this app file. Any change to where the bot runs, the LLM chain, Ollama, or Helius webhooks must update `VPS.md` + both `CLAUDE.md` files + both READMEs **in the same commit**. After push: `git pull` on `monke@157.173.192.39:/home/monke/Monke_Eliza`.

---

## Security & Privacy

- **NEVER store keys or sensitive data from any users.** No private keys, seed phrases, wallet secrets, or authentication tokens are persisted in code, logs, or state.
- **NEVER log or expose** XMTP inbox IDs, wallet addresses, or push tokens in user-visible UI. Internal debug logs only.
- **NEVER commit** `.env`, `.xmtp_bot_key`, `credentials.json`, keystore files, or any file containing secrets to git.
- **NEVER hardcode** API keys, private keys, or secrets in source code. Always use environment variables.

## Build & Deploy

- **NEVER run `adb uninstall`** — it wipes XMTP credentials + wallet state, resetting the app completely.
- **Always use `adb install -r`** (replace) for APK installs. Never uninstall + reinstall.
- On signature mismatch: **fix the keystore**, do NOT uninstall.
- The project debug keystore lives at `android/app/debug.keystore` — if it changes between builds, signature mismatch occurs.
- AAPT2 rejects JPEG files with `.png` extensions — always verify image format with `file` command before adding assets.
- Bare workflow: `runtimeVersion` must be a static string (e.g., `'2.22'`), NOT `{ policy: 'appVersion' }`.
- **Expo SDK 53 + RN 0.79.6** requires: Gradle 8.11.1, Kotlin 2.0.21, compileSdk 35, NDK 26.1.10909125 — **bumped to NDK 27.1.12297006 on 2026-07-09** for Nitro Modules (vision-camera 5 / react-native-nitro-modules / react-native-nitro-image, which require NDK 27+). Untested combo as of this note; if a native build breaks in a new way, check here first.
- **SoLoader must use merged SO mapping**: `SoLoader.init(this, OpenSourceMergedSoMapping)` — NOT `SoLoader.init(this, false)`. RN 0.79 merges native libs into `libreactnative.so`; without the mapping, `libreact_featureflagsjni.so` crash on startup.
- **R8/ProGuard disabled** for release builds — R8 strips JNI loaders needed by RN 0.79 new arch. APK is ~88MB without minification.
- **Face tracking uses Google ML Kit** via `react-native-vision-camera-face-detector`, NOT MediaPipe. `FaceTracker.tsx` runs a 1×1px invisible camera + frame processor and derives blendshape-shaped values (jawOpen from lipGap/faceH, head rotation, smile/blink) for the Avatar Room data channel. MediaPipe was retired — no patch file needed.
- **Post-build cleanup**: run `scripts/post-build-cleanup.sh` after each build to reclaim ~3GB of native build intermediates. Critical on low-disk Macs.
- **My Passport** (`/Volumes/MyPassport/OnlyMonkes-cache/`) stores NDK 25, build-tools 36, platforms, and Gradle caches offloaded from local disk.

## XMTP & Messaging

- **System message prefixes** (PRESENCE:, TYPING:, PROFILE_UPDATE:, EVENT:, EDIT:, DELETE:, REACT:, STICKER_REACT:, LIVE_ROOM:, VIDEO_ROOM:, AVATAR_ROOM:, THREAD:, PIN:, UNPIN:, NFT_LIST:, NFT_BID:, NFT_OFFER:, NFT_ACCEPT:, NFT_DELIST:, NFT_SWAP:, NFT_COMPLETE:, AUTOMONKE_STATUS:, TRADE_CLOSED:, MY_INBOXES:) must ALWAYS be filtered in `decodeMessage()` so they never appear as chat messages.
- **DELETE:** broadcasts a message deletion (`src/lib/deletedMessages.ts`, format `DELETE:<messageId>`) so it propagates to every device and survives history resyncs — a bare local removal doesn't (the network copy resurrects on the next reconnect). Authorized senders: the target message's original author, or the app's single admin inboxId (owner — can delete anything, including the bot's messages). Verified on BOTH the sending client's UI gate (`MessageBubble`: `isOwn || isGroupAdmin`) and the receiving client (`useXmtp.ts` stream handler cross-checks the requester against the target's real sender / admin inboxId) since a decentralized log can't enforce permissions server-side.
- **TRADE_CLOSED:** structured DM emitted by the bot's AutonoMonke close path (`engine.ts:closePosition`). Format: `TRADE_CLOSED:{token,mint,entrySolAmount,exitSolAmount,pnlPct,pnlSol,durationMs,reason,ts,...}`. App parses via `parseTradeClosed()` in xmtp.ts (sender must be in `BOT_INBOX_IDS` to prevent spoofing) and pushes a `ClosedTrade` to `tradesStore`. Manual round-trip swaps emit the same `ClosedTrade` shape locally via `src/lib/positions.ts` hooked into `executeSwap`.
- Bot message format is **always** `MSG:AI Agent #9385:<content>` — any deviation breaks display in the app.
- PRESENCE heartbeats are sent every 3 min via XMTP group `send()` — the bot must ignore them (they are not user messages).
- After any XMTP DB wipe + group recreation, the group ID changes — update `app-config.json` and bot `.env`.

## Architecture

- **solana-alert-bot is RETIRED** (archived at `~/solana-alert-bot.retired`). All bot functionality lives in Monke_Eliza.
- Monke_Eliza is the single source of truth for TA scanning, alerts, and bot behavior. No `bot_state.json` dependency.
- The token scanner (`tokenScanner.ts`) scans 100+ SPL tokens (53 hardcoded + Birdeye discovery + Hermes Solana Toolkit discoveries) across 4 rotations of 25 tokens every 10 min, using GeckoTerminal (primary) + DexPaprika (free fallback, no auth) + Birdeye (last resort). Moralis does NOT support Solana OHLCV — removed.
- **taSavvyMonke.ts is DELETED** — all scanner/TA/AutonoMonke/Drift BET functionality merged into xmtpOnlyMonkes.ts (single unified bot identity: "AI Agent #9385").
- **Alert threshold**: 50 (bipolar scale -100 to +100). Regime-adaptive: bull=45, bear=60, ranging=52, volatile=55. Low conviction signals filtered. Alerts with bad Fib data (>50% off entry) are skipped entirely.
- **AutonoMonke min composite**: 50 (only medium+ conviction). Stop loss clamped 5-12%. Fib targets validated ±50% from entry.
- **Hermes Memory** (`hermesMemory.ts`): per-user AES-256-GCM encrypted trading memory + global learning engine. Auto-closes alert outcomes every scan cycle by monitoring real prices against T1/T2/stop. Feeds: Alert Quality Badge, Personalized DM Warnings, Portfolio Copilot, Auto-Tune, Weekly Digest, Bot Self-Awareness, Social Signals, Streaks, `/hermes` command.
- **Hermes Solana Toolkit**: OpenClaw extension at `~/.openclaw/extensions/solana-toolkit/` — `solana_trending` + `solana_token_chart`. Discoveries written to `~/.hermes_memory/hermes_signals.json`, ingested by bot scanner.
- **Chat LLM chain**: Groq direct (`openai/gpt-oss-120b`) → Gemini 3.6 Flash → OpenRouter (Llama 3.3 70B aggregator) → Ollama local (DeepSeek R1 1.5B + Qwen 3 1.7B). Cerebras is opt-in (`CEREBRAS_ENABLED=true`) — the account is paid-quota (HTTP 402). Model IDs live in `src/lib/llm/models.ts`. Anthropic SDK has been removed from the chain — circuit breaker (2 failures = 5min cooldown per provider) defined in `src/lib/llm/fallbackChain.ts`. Groq retired `llama-3.3-70b-versatile` / `llama-3.1-8b-instant` on 2026-08-16.
- **Trade confidence**: Multi-perspective analysis (Bull/Bear/Risk) via Groq + Gemini (Cerebras only if `CEREBRAS_ENABLED=true`) + Ollama in parallel — replaced OpenClaw gate in engine.ts. Synthesis: `bull*0.4 + (100-bear)*0.3 + risk*0.3`.
- **Production bot is VPS-only**: `systemd` unit `monketrader.service` on `monke@157.173.192.39` (`/home/monke/Monke_Eliza/agents/monke-trader`). Logs: `/home/monke/monke-bot.log`. **Never start** `com.onlymonkes.monketrader` on the Mac — a second bun process locks the XMTP DB. Mac LaunchAgent plist is leftover, not production.
- **VPS has no GPU** (KVM AMD EPYC). Ollama there is CPU-only (`deepseek-r1:1.5b`, `qwen3:1.7b`) and last-resort. Do not pull GPU models. Do not route chat through the Mac Ollama tunnel. Full host notes: `Monke_Eliza/VPS.md`.
- **Solana Agent Kit** (`src/lib/sak/`): DM commands `/limit`, `/stake`, `/unstake` via `solana-agent-kit@2.0.10`. Borrow-and-return keypair pattern via `withSAK()`. Risk-gated through existing `riskManager.ts`.
- **Bot persona**: "Monke" — ball-busting, banana-obsessed, confident. Defined in `~/.hermes/SOUL.md` + `buildSystemPrompt()`.
- Data files (`.xmtp_bot_key`, `.xmtp_welcomed.json`, `.xmtp_stale_tokens.json`) live in `~/Monke_Eliza/agents/monke-trader/`, NOT in `~/solana-alert-bot/`.

## UI / UX

- Live room signaling (`AVATAR_ROOM:`, `VIDEO_ROOM:`, `LIVE_ROOM:`) must NEVER show raw JSON in chat. Use `LIVE_PILL:` synthetic messages to display a styled pill with JOIN button.
- **Live Audio rooms are DISCONTINUED** (v2.33). Replaced by Avatar Rooms. `LIVE_ROOM:` messages still parsed for backward compat but no new audio rooms can be started. Files kept but unused: `liveAudio.ts`, `LiveAudioRoomScreen.tsx`, `LiveAudioPill.tsx`, `app/live-room.tsx`.
- **Avatar Rooms** (`avatarRoom.ts`): Animated NFT PFP avatars with mouth sprite overlays driven by ML Kit face tracking jaw openness (or audio energy fallback). Head tilt/nod/turn from face tracking rotation. Skia canvas overlay (`SkiaAvatarOverlay.tsx`) exists but is unwired — the consumer is `AnimatedAvatar.tsx`; `SkiaAvatarOverlay` is a future option pending per-collection (Saga Monkes) calibration of eye/brow positions. Minimize to pill in Main Chat. Sticker reactions via data channel.
- Messages load newest-first on app open. Older messages load in background without visible flicker.
- `react-native-svg` is a REQUIRED transitive dependency (`sonner-native` toast icons depend on it; it is installed at the SDK-53 version `15.11.2` and linked into the APK). Do NOT remove it — its absence breaks the Metro bundle (`Unable to resolve module react-native-svg`). The old "removed in 2026-04 cleanup" note was wrong: it had merely drifted out of `package.json` while lingering in `node_modules`, and a clean install on 2026-06-19 pruned it and broke the bundle (now pinned explicitly). Still avoid adding NEW SVG-based UI in our own components (use View-based alternatives) — that guidance is about our code, not the package.
- **FlashList** replaces FlatList in ChatScreen for message list (cell recycling, 3-5x fewer frame drops).
- **$TOKEN mentions are tappable** in chat — opens ChartModal with candlestick chart (react-native-wagmi-charts).
- **Free-RASP** runtime security: root/jailbreak detection, Frida hook detection, app tampering, emulator detection. `useFreeRasp()` in `_layout.tsx`. Check `isDeviceCompromised()` before sensitive operations.
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
