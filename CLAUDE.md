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

- **System message prefixes** (PRESENCE:, TYPING:, PROFILE_UPDATE:, EVENT:, EDIT:, REACT:, STICKER_REACT:, LIVE_ROOM:, VIDEO_ROOM:, THREAD:, PIN:, UNPIN:, NFT_LIST:, NFT_BID:, NFT_ACCEPT:, NFT_DELIST:) must ALWAYS be filtered in `decodeMessage()` so they never appear as chat messages.
- Bot message format is **always** `MSG:AI Agent #9385:<content>` — any deviation breaks display in the app.
- PRESENCE heartbeats are sent every 60s via XMTP group `send()` — the bot must ignore them (they are not user messages).
- After any XMTP DB wipe + group recreation, the group ID changes — update `app-config.json` and bot `.env`.

## Architecture

- **solana-alert-bot is RETIRED** (archived at `~/solana-alert-bot.retired`). All bot functionality lives in Monke_Eliza.
- Monke_Eliza is the single source of truth for TA scanning, alerts, and bot behavior. No `bot_state.json` dependency.
- The token scanner (`tokenScanner.ts`) scans the top 40 SPL tokens by volume every 20 minutes.
- Data files (`.xmtp_bot_key`, `.xmtp_welcomed.json`, `.xmtp_stale_tokens.json`) live in `~/Monke_Eliza/agents/monke-trader/`, NOT in `~/solana-alert-bot/`.

## UI / UX

- Live audio/video room signaling (`LIVE_ROOM:`, `VIDEO_ROOM:`) must NEVER show raw JSON in chat. Use `LIVE_PILL:` synthetic messages to display a styled pill with JOIN button.
- Messages load newest-first on app open. Older messages load in background without visible flicker.
- `react-native-svg` is NOT installed — do not use SVG components. Use View-based alternatives.
- FlatList uses `maintainVisibleContentPosition` to prevent scroll jumps when older messages are prepended.

## Dependencies & Compatibility

- Expo SDK 51, React Native (bare workflow)
- `expo-router` file-based routing under `app/` — no v3+ features
- `@livekit/react-native` + `livekit-client` for audio/video rooms
- `@xmtp/react-native-sdk` v5 MLS for messaging
- BouncyCastle `bcprov-jdk15on` must be excluded in `build.gradle` to avoid duplicate class conflicts

## Code Style

- Path alias: `@/` maps to `src/`
- Zustand for state: `appStore` (user/wallet/NFT), `chatStore` (messages/UI)
- Do not add unnecessary comments, docstrings, or type annotations to unchanged code.
- Do not over-engineer — keep changes minimal and focused on the task.
