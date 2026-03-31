# OnlyMonkes — Rules for Claude

This file stores all rules and constraints so Claude never makes the same mistakes twice.
Rules are added over time as issues arise.

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

## XMTP & Messaging

- **System message prefixes** (PRESENCE:, TYPING:, PROFILE_UPDATE:, EVENT:, EDIT:, REACT:, STICKER_REACT:, LIVE_ROOM:, VIDEO_ROOM:, AVATAR_ROOM:, THREAD:, PIN:, UNPIN:, NFT_LIST:, NFT_BID:, NFT_OFFER:, NFT_ACCEPT:, NFT_DELIST:, NFT_SWAP:, NFT_COMPLETE:) must ALWAYS be filtered in `decodeMessage()` so they never appear as chat messages.
- Bot message format is **always** `MSG:AI Agent #9385:<content>` — any deviation breaks display in the app.
- PRESENCE heartbeats are sent every 60s via XMTP group `send()` — the bot must ignore them (they are not user messages).
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
- **Chat LLM chain**: Hermes/Groq (Llama 70B) → Cerebras (Llama 70B) → Ollama (DeepSeek R1/Qwen 2.5) → Anthropic (last resort).
- **Trade confidence**: Multi-perspective analysis (Bull/Bear/Risk) via Groq+Cerebras+Ollama in parallel — replaced OpenClaw gate in engine.ts. Synthesis: `bull*0.4 + (100-bear)*0.3 + risk*0.3`.
- **Solana Agent Kit** (`src/lib/sak/`): DM commands `/limit`, `/stake`, `/unstake` via `solana-agent-kit@2.0.10`. Borrow-and-return keypair pattern via `withSAK()`. Risk-gated through existing `riskManager.ts`.
- **Bot persona**: "Monke" — ball-busting, banana-obsessed, confident. Defined in `~/.hermes/SOUL.md` + `buildSystemPrompt()`.
- Data files (`.xmtp_bot_key`, `.xmtp_welcomed.json`, `.xmtp_stale_tokens.json`) live in `~/Monke_Eliza/agents/monke-trader/`, NOT in `~/solana-alert-bot/`.

## UI / UX

- Live room signaling (`AVATAR_ROOM:`, `VIDEO_ROOM:`, `LIVE_ROOM:`) must NEVER show raw JSON in chat. Use `LIVE_PILL:` synthetic messages to display a styled pill with JOIN button.
- **Live Audio rooms are DISCONTINUED** (v2.33). Replaced by Avatar Rooms. `LIVE_ROOM:` messages still parsed for backward compat but no new audio rooms can be started. Files kept but unused: `liveAudio.ts`, `LiveAudioRoomScreen.tsx`, `LiveAudioPill.tsx`, `app/live-room.tsx`.
- **Avatar Rooms** (`avatarRoom.ts`): Animated NFT PFP avatars driven by MediaPipe face tracking (52 blendshapes). Skia canvas overlay for continuous expressions (mouth, eyes, brows). Minimize to pill in Main Chat. Sticker reactions via data channel.
- Messages load newest-first on app open. Older messages load in background without visible flicker.
- `react-native-svg` is NOT installed — do not use SVG components. Use View-based alternatives.
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
- `react-native-mediapipe` for 52-blendshape face tracking
- `react-native-vision-camera` v4.3.2 + `react-native-worklets-core` for camera frame processing
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
- **Jupiter API**: Use `api.jup.ag/swap/v1/quote` and `api.jup.ag/swap/v1/swap` — the old `quote-api.jup.ag/v6/` endpoints are deprecated and return DNS errors from CF Workers.
- Swap amount capped at **5 SOL max** for safety. Tips capped at 10 SOL.
- All wallet addresses and token mints MUST be validated via `new PublicKey()` before use.
- Worker secrets: `HELIUS_API_KEY`, `JUP_API_KEY` (set via `wrangler secret put`)

## Message Loading

- XMTP `messages({ afterNs })` returns messages **newest-first**.
- When trimming to N most recent: `slice(0, N)` FIRST, then `reverse()` for oldest-first processing. Never reverse then slice (that keeps the N oldest).
- Main Chat loads 48 hours of messages, trims to 50 newest content messages (PRESENCE/TYPING/system filtered out).

## LightRAG

- Local Docker container, port 9621 (localhost only)
- Start: `npm run lightrag:start` (from OnlyMonkes root or Monke_Eliza/agents/monke-trader)
- Logs: `npm run lightrag:logs`
- Pipeline module: `worker-actions/src/lightrag-pipeline.ts` (canonical) + `~/Monke_Eliza/agents/monke-trader/src/lib/lightrag.ts` (bot import)
- Backfill: `npm run lightrag:backfill`
- Data persisted in: `infra/data/lightrag/` (gitignored)
- Config: `infra/.env.lightrag` (gitignored)
- LLM backend: Groq llama-3.3-70b-versatile (OpenAI-compatible)
- Embedding: Ollama nomic-embed-text (local, free) via `http://host.docker.internal:11434`
- All ingest calls are fire-and-forget — never block the bot
- queryLightRAG has a hard 3s timeout — returns "" on failure

## Code Style

- Path alias: `@/` maps to `src/`
- Zustand for state: `appStore` (user/wallet/NFT), `chatStore` (messages/UI)
- Do not add unnecessary comments, docstrings, or type annotations to unchanged code.
- Do not over-engineer — keep changes minimal and focused on the task.
