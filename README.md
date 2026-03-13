# OnlyMonkes

An NFT-gated social app for **Saga Monkes** holders on Solana Mobile. Connect your wallet, prove ownership, and chat with other verified holders — group chat, live audio rooms, direct messages, GIFs, video, reactions, tipping, community events, and an AI trading agent — all powered by on-chain identity and decentralized messaging via XMTP.

---

## Features

### Core
- **NFT-gated access** — only verified Saga Monkes holders can join
- **Decentralized messaging** — group chat powered by XMTP v5 MLS (E2E encrypted, no central server)
- **NFT avatar** — your Monke NFT is your profile picture, verified on-chain
- **Custom username & bio** — set a display name and bio, synced across all group members via XMTP profile broadcasts
- **Legendary badge** 🌟 — special suffix for legendary-tier Monkes
- **Solana Mobile optimized** — built for Seeker / Saga devices (arm64-v8a only)
- **Onboarding carousel** — animated 3-slide explainer shown once on first launch (🐒 Only Saga Monkes · 🔐 Private by Design · 🎙 Live & Growing)
- **Not-a-holder screen** — non-holders see a branded gate with Magic Eden + Tensor marketplace CTAs and a "Why Saga Monkes?" breakdown
- **Skeleton loader** — animated shimmer + rotating fun loading texts while NFT ownership is verified on-chain

### Messaging
- **Emoji reactions** — react to any message with any emoji
- **Sticker reactions** — react with GIF stickers
- **Reply threads** — long-press any message to quote-reply
- **GIF search** — powered by GIPHY, inline animated GIFs in chat
- **Video messages** — record and send short video clips; thumbnails displayed inline with playback
- **Direct Messages** — 1-on-1 encrypted DMs with any Monkes holder; inbox screen with compose modal, searchable user directory, message preview and timestamps
- **Rich text links** — `@username` mentions render blue and are tappable (opens PFP modal); `$TOKEN` symbols render gold
- **Inline sender labels** — sender name + timestamp rendered inside every chat bubble (bottom-aligned); own messages right-aligned, others left-aligned
- **OnlyMonkes blue branding** — sender names, toolbar buttons (CAM/LIVE/GIF), and Community drawer title all use the signature sky blue (`#6CB4EE`) from the header logo
- **Bot slash commands** — type `/` to autocomplete 10 bot commands: `/price`, `/ta`, `/watchlist`, `/alerts`, `/sports`, `/tip`, `/buy`, `/sell`, `/swap`, `/help`
- **Message search** — search through chat history
- **In-app Jupiter swaps** — `/buy $TOKEN [SOL]`, `/sell $TOKEN [%]`, `/swap $A for $B` resolve tokens via Jupiter strict list, show a confirmation modal (amounts, price impact, slippage), and execute via MWA biometric sign — all without leaving the app
- **In-app tipping** — `/tip @username [amount]` resolves username → wallet from the profile cache, opens a confirmation modal, and sends $SKR via MWA one-tap biometric; Support OnlyMonkes button also tips the dev wallet in-app
- **SOL → SKR swap tips** — users without $SKR can tip using SOL; Jupiter swap + SPL transfer chained in a single `transact()` session (one biometric prompt)

### Community
- **Bot alert channels** — four dedicated read-only feeds for categorized bot alerts: Monke Bets, Monke Trades, Monke Sales, Monke Predictions; each backed by a separate XMTP group configured via remote app config; channel icons in the toolbar below the message bar with unread count badges (tap to navigate + clear, long-press to clear)
- **dApp side chats** — per-dApp community channels (hamburger menu)
- **Community events calendar** — schedule, view, and RSVP to events; OnlyMonkes-tagged events support "Start Live Audio Chat" when time arrives
- **Live Audio Rooms** — Twitter Spaces-style voice chat via LiveKit WebRTC; host/listener grid with speaking-highlight rings, mute toggle, live participant count, pinned banner in main chat
  - **Minimize to chat** — tap ⌄ to collapse the audio room back to the chat without disconnecting; a floating blue pill stays pinned at the top of the chat showing `@host · N Monkes`, a live mute/unmute button, and an expand arrow to return to the full room
- **Activity leaderboard** — weekly stats tracking messages sent/reactions given/received; top-3 with medals in the Members tab; auto-resets on Monday UTC
- **Login streaks** 🔥 — daily login streak counter; confetti fires on the 7th day

### Notifications
- **Push notifications (v8)** — FCM V1 API via service account + Expo push relay with Bearer auth; all channels use MAX importance for heads-up banners (including bot alerts); legacy channels (v1–v7) auto-deleted on startup
- **Per-user notification prefs** — opt-in categories: All Messages, @Mentions Only, Bot/AI alerts, DM notifications, Live Room start alerts; prefs broadcast in `PROFILE_UPDATE` so the bot filters server-side
- **Direct DM push relay** — when a user sends a DM, a push notification is sent directly to the recipient's FCM token (peer-to-peer, no bot required); includes sender NFT avatar in the data payload
- **FCM token fallback** — direct FCM token generation (not Expo relay) for server-side bot push; cached in SecureStore and broadcast with PROFILE_UPDATE
- **Background sync** — `expo-background-fetch` task keeps profile and data fresh when backgrounded

### Profiles & Wallets
- **User profiles** — tap any username to view their NFT, bio, wallet, and social links
- **Tipping** — send SOL tips directly to a user's tip wallet from their profile card
- **Monke Tools** 🔧 — ecosystem links, settings, and notification controls
- **MWA biometric re-auth** — cached wallet adapter auth tokens for silent re-authentication with biometric prompt; no app-switch needed after first connect

### AI Agent & TA Scanner
- **AI Agent #9385** — XMTP bot in the group chat; delivers TA alerts (RSI, MACD, EMA) for Solana tokens, Saga Monke NFT sale alerts, and responds to DMs via Claude AI; built on ElizaOS v2 with plugin-solana for trade execution
- **TA Savvy Monke** — professional-grade multi-timeframe TA scanner; scans all verified Solana SPL tokens every 8 min across 15m/1H/4H/daily candles; posts confluence alerts (Ichimoku, Fibonacci, Bollinger, Stochastic, ADX, OBV, candle patterns) to Main Chat when signal score ≥72/100; sentiment gate (Birdeye trending + wash trading detection)
- **Slash commands** — `/tip @Username [amt]` (send $SKR), `/buy $TOKEN`, `/sell $TOKEN`, `/swap $A for $B` — all execute in-app via MWA biometric sign + Jupiter aggregator
- **Color-coded risk alerts** — 🟢 Low Risk, 🟡 Medium, 🔴 High Risk dots on all TA alerts; compact confluence tags (RSI + MACD Cross + BB Squeeze); inline chart links (DEXScreener, Birdeye, Jupiter)
- **Per-user TA risk settings** — DM the bot `/risk` to set position size, stop-loss %, conviction threshold, blacklist, mute, and more
- **Backtesting** — DM `/backtest $TOKEN [days]` for historical signal replay with win/loss stats, Sharpe ratio, max drawdown
- **Portfolio tracking** — DM `/portfolio` for open positions, closed P&L, and daily summaries
- **Support OnlyMonkes button** — in the Tools drawer; quick-tip 5/10/25/50 $SKR to the dev wallet via in-app MWA biometric (no app switch)
- **Per-type push titles** — 🐒 Saga Monke Sold! / 📈 Bullish Signal / 📉 Bearish Signal per alert type
- **Enriched push payloads** — notifications include `type`, `sender`, `avatarUrl`, `preview` fields for rich display

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo SDK 51 (bare workflow) |
| Navigation | Expo Router v3 (file-based) |
| Messaging | XMTP v5 MLS (`@xmtp/react-native-sdk`) |
| Live Audio | LiveKit WebRTC (`livekit-client`, `@livekit/react-native`) |
| Wallet | Mobile Wallet Adapter (`@solana-mobile/mobile-wallet-adapter-protocol-web3js`) |
| Token Swaps | Jupiter v6 API (quote + swap) via MWA `VersionedTransaction` |
| NFT Verification | Helius DAS API (`getAssetsByOwner`) |
| State | Zustand |
| Images | `expo-image` (disk-cached GIFs, NFT avatars) |
| Video | `expo-camera`, `expo-av`, `expo-video-thumbnails` |
| Video Hosting | Cloudinary (upload preset, unsigned) |
| GIF Search | GIPHY API |
| Push Notifications | FCM V1 API (service account) + Expo push relay (Bearer auth); AI Agent + peer-to-peer DM push |
| Background Tasks | `expo-background-fetch` + `expo-task-manager` |
| JWT Signing | `crypto-js` (HS256 for LiveKit tokens, client-side) |
| Animations | `react-native-reanimated` ~3.10 |
| Gestures | `react-native-gesture-handler` |
| Fonts | Space Grotesk, Inter, JetBrains Mono |

---

## Project Structure

```
OnlyMonkes/
├── app/                              # Expo Router screens
│   ├── _layout.tsx                   # Root layout: LiveKit globals, push token, bg-sync
│   ├── index.tsx                     # → ConnectScreen
│   ├── verify.tsx                    # → VerifyScreen
│   ├── bot-channel.tsx               # → BotChannelScreen (read-only bot alert feed)
│   ├── chat.tsx                      # → ChatScreen (main NFT-gated group)
│   ├── dapp-chat.tsx                 # → DAppChatScreen
│   ├── dms.tsx                       # → DmInboxScreen
│   ├── dm/[inboxId].tsx              # → DmScreen (1-on-1 DM route)
│   └── live-room.tsx                 # → LiveAudioRoomScreen
│
├── src/
│   ├── components/
│   │   ├── CalendarModal.tsx         # Community event scheduler
│   │   ├── ChatInput.tsx             # Message composer: text, reply strip + toolbar (CAM/LIVE/GIF + bot channel icons w/ badges)
│   │   ├── ConfettiView.tsx          # 40-particle Reanimated confetti (login streak milestones)
│   │   ├── GifPickerModal.tsx        # GIPHY search + inline GIF picker
│   │   ├── LiveAudioPill.tsx         # Floating blue pill: host, count, mute/unmute (minimized room)
│   │   ├── LiveRoomBanner.tsx        # Pinned banner: host PFP, LIVE badge, count, Join/Leave
│   │   ├── MenuDrawer.tsx            # Slide-out drawer: dApp chats, Members, Events, Settings
│   │   ├── MessageBubble.tsx         # Bubble: text/GIF/IMAGE/VIDEO/reactions/reply preview
│   │   ├── MonkeToolsModal.tsx       # Ecosystem links + notification settings
│   │   ├── NftPickerModal.tsx        # NFT avatar selector
│   │   ├── OnboardingCarousel.tsx    # First-launch 3-slide animated explainer
│   │   ├── SearchModal.tsx           # Message history search
│   │   ├── SwapConfirmModal.tsx       # Jupiter swap confirmation (amounts, price impact, slippage)
│   │   ├── TipModal.tsx              # SKR tipping flow (in-app MWA biometric)
│   │   ├── UserProfileModal.tsx      # Profile card: NFT, bio, wallet, DM, tip buttons
│   │   ├── UsernameModal.tsx         # First-launch username setup
│   │   └── VideoCameraModal.tsx      # Full-screen camera: record, preview, upload to Cloudinary
│   │
│   ├── hooks/
│   │   ├── useDm.ts                  # 1-on-1 DM hook (includes direct push relay to recipient)
│   │   ├── useDmInbox.ts             # DM inbox list hook
│   │   ├── useGroupChat.ts           # Generic XMTP group chat hook (used by bot channels, dApp chats)
│   │   ├── useMobileWallet.ts        # MWA wallet connect + signMessage + biometric re-auth
│   │   ├── useNFTVerification.ts     # NFT ownership check
│   │   └── useXmtp.ts                # XMTP client init, stream, send, react, broadcastProfile, broadcastLiveRoom
│   │
│   ├── lib/
│   │   ├── activityTracker.ts        # Weekly stats: sent/given/received; getLeaderboard()
│   │   ├── backgroundSync.ts         # expo-background-fetch task registration
│   │   ├── calendar.ts               # Event helpers
│   │   ├── constants.ts              # COLORS, fonts, collection config
│   │   ├── giphy.ts                  # GIPHY search API wrapper
│   │   ├── liveAudio.ts              # LiveKit Room singleton — persists across navigation
│   │   ├── livekit.ts                # LiveKit JWT generation (HS256, client-side); room helpers
│   │   ├── matrica.ts                # Matrica holder verification
│   │   ├── nftVerification.ts        # Helius DAS API + on-chain fallback
│   │   ├── notifications.ts          # Expo push token registration + FCM fallback + local notifications
│   │   ├── remoteConfig.ts           # Remote app config fetch (bot channel IDs, feature flags)
│   │   ├── session.ts                # Session persistence (SecureStore, 7-day TTL)
│   │   ├── jupiterSwap.ts            # Jupiter v6 swap: token resolution, quotes, MWA execution
│   │   ├── offlineQueue.ts           # Offline message queue + auto-flush
│   │   ├── solana.ts                 # SKR tipping, SOL→SKR swap tips, wallet validation
│   │   ├── streaks.ts                # Daily login streak (AsyncStorage)
│   │   ├── theme.ts                  # Extended theme tokens
│   │   ├── userProfile.ts            # Profile cache (in-memory + AsyncStorage, push token per user)
│   │   ├── videoUpload.ts            # Cloudinary video + thumbnail upload
│   │   └── xmtp.ts                   # XMTP client, message encode/decode, group/DM helpers
│   │
│   ├── screens/
│   │   ├── BotChannelScreen.tsx      # Read-only bot alert feed (Bets, Trades, Sales, Predictions)
│   │   ├── ChatScreen.tsx            # Main group chat: header, live banner, floating pill, input
│   │   ├── ConnectScreen.tsx         # Wallet connect landing + onboarding carousel
│   │   ├── DAppChatScreen.tsx        # Per-dApp community chat
│   │   ├── DmInboxScreen.tsx         # DM inbox list with compose modal
│   │   ├── DmScreen.tsx              # 1-on-1 DM screen
│   │   ├── LiveAudioRoomScreen.tsx   # Spaces-style audio room; minimize ⌄ / leave ✕
│   │   └── VerifyScreen.tsx          # NFT verification: skeleton shimmer, fun texts, not-a-holder gate
│   │
│   ├── store/
│   │   ├── appStore.ts               # Zustand: wallet, NFT, push token, live room state, notif prefs, bot channel IDs, MWA auth
│   │   └── chatStore.ts              # Zustand: messages, reply state, typing indicators
│   │
│   └── types/index.ts
│
├── assets/
│   ├── icon.png
│   ├── splash.png
│   ├── header.png
│   └── fonts/                        # Space Grotesk, Inter, JetBrains Mono
│
├── app.config.ts                     # Expo config + env vars (Helius, GIPHY, Cloudinary, LiveKit)
├── global.ts                         # Buffer / process polyfills
└── metro.config.js                   # Node.js shims for Solana libs
```

---

## Message Protocol

All XMTP messages are plain UTF-8 strings with a prefix that determines type:

| Prefix | Format | Description |
|---|---|---|
| `MSG:` | `MSG:<user>:<content>` | Regular chat message |
| `MSG:` (reply) | `MSG:<user>:REPLYv2:<targetId>:<targetSender>:<targetUser>:<origBase64>:<content>` | Quoted reply |
| `REACT:` | `REACT:<emoji>:<targetMsgId>` | Emoji reaction |
| `STICKER_REACT:` | `STICKER_REACT:<url>:<targetMsgId>` | GIF sticker reaction |
| `PROFILE_UPDATE:` | `PROFILE_UPDATE:<json>` | Profile broadcast (username, bio, NFT image, push token, notif prefs) |
| `TYPING:` | `TYPING:<inboxId>:<username>` | Typing indicator |
| `VIDEO:` | `VIDEO:<videoUrl>\|<thumbUrl>` | Video message (Cloudinary URLs) |
| `LIVE_ROOM:` | `LIVE_ROOM:<json>` | Live audio room signal (start/end) |

### PROFILE_UPDATE JSON fields

| Field | Key | Description |
|---|---|---|
| Inbox ID | `id` | XMTP inboxId |
| Username | `u` | Display name |
| Bio | `b` | Profile bio |
| X Account | `x` | Twitter/X handle |
| Wallet | `w` | Solana wallet address |
| Tip Wallet | `tw` | Tip destination wallet |
| NFT Image | `ni` | NFT image URI (data URI or IPFS URL) |
| Legendary | `lg` | `1` if legendary-tier Monke |
| Push Token | `pt` | Expo push token for direct notifications |
| Notif Prefs | `np` | `{all, mentions, bot, dm, live}` opt-in categories |

---

## Auth Flow

```
Connect Wallet (MWA / Matrica)
        │
        ▼
Skeleton shimmer + fun loading texts while verifying…
        │
        ▼
Fetch NFTs via Helius DAS API
        │
        ├── No Saga Monkes found → Branded gate screen (Magic Eden / Tensor CTAs)
        │
        ▼
Create XMTP identity (persisted forever in SecureStore — no manual ID sharing)
        │
        ▼
Auto-send JOIN_REQUEST DM to bot → bot adds to group + all channels (3s retry)
        │
        ▼
Broadcast PROFILE_UPDATE (username, NFT avatar, push token, notif prefs)
        │
        ▼
Load message history + stream live messages
```

---

## Live Audio Room Flow

```
Host taps LIVE in ChatScreen header
        │
        ▼
createRoomName() + createLivekitToken() (HS256, client-side)
        │
        ▼
Broadcast LIVE_ROOM: signal via XMTP group
        │
        ▼
LiveRoomBanner appears for all members (Join button)
        │
        ├── AI Agent relays push to users with live room alerts enabled
        │
        ▼
Members tap Join → navigate to /live-room → liveAudio singleton connects
        │
        ▼
Twitter Spaces UI: host card + listener grid + speaking-highlight rings
        │
        ├── Tap ⌄ (Minimize) → router.back() — Room stays connected in singleton
        │       │
        │       ▼
        │   Floating blue pill in ChatScreen (absolute overlay on logo area)
        │   Shows: 🔴 LIVE · @host · N Monkes · 🎤/🔇 · ⌃
        │   Mute button works live; tap pill to expand back to full room
        │
        ▼
Host ends room → LIVE_ROOM: {active: false} → banner + pill dismissed
        │
        └── liveAudio.disconnectFromRoom() → AudioSession.stopAudioSession()
```

---

## Notification Categories

All channels use MAX importance (v8) for heads-up banners. Legacy channels (v1–v7) are auto-deleted on startup. Managed per-user in Settings; broadcast in `PROFILE_UPDATE np` field so the AI Agent filters server-side:

| Category | Store field | Description |
|---|---|---|
| All messages | `notificationsEnabled` | Group chat messages |
| @Mentions only | `mentionsOnly` | Only push if `@username` in body |
| Bot / AI alerts | `botNotificationsEnabled` | Trade signals & NFT sales |
| DM notifications | `dmNotificationsEnabled` | Peer-to-peer push from sender device |
| Live room alerts | `liveRoomNotificationsEnabled` | When a live room starts |

---

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/jumpstreet25/OnlyMonkes.git
cd OnlyMonkes
npm install
```

### 2. Add Fonts

Download and place in `assets/fonts/`:
- [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) — `SpaceGrotesk-Bold.ttf`, `SpaceGrotesk-Medium.ttf`
- [Inter](https://fonts.google.com/specimen/Inter) — `Inter-Regular.ttf`, `Inter-Medium.ttf`, `Inter-SemiBold.ttf`
- [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) — `JetBrainsMono-Regular.ttf`

### 3. Environment Variables

Create a `.env` file in the project root:

```env
HELIUS_API_KEY=your-helius-api-key          # helius.dev
GIPHY_API_KEY=your-giphy-api-key            # developers.giphy.com
CLOUDINARY_CLOUD_NAME=your-cloud-name       # cloudinary.com
CLOUDINARY_UPLOAD_PRESET=your-preset        # unsigned upload preset

LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-livekit-api-key        # livekit.io cloud dashboard
LIVEKIT_API_SECRET=your-livekit-api-secret

JUP_API_KEY=your-jupiter-api-key           # portal.jup.ag
SKR_MINT=SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3
DEV_WALLET=7tLrnPvgcR5mLtyUcVwvmhAD1wXbAKgWcLBPWxpwyZ1J
```

These are injected via `app.config.ts` → `Constants.expoConfig.extra`.

### 4. Run on Android

```bash
npx expo run:android
```

> **Requires a physical Android device** (Seeker or Saga recommended) with a Solana wallet app installed (Phantom or Solflare). Expo Go is not supported — MWA requires a custom dev build.

---

## Building a Release APK

```bash
cd android
./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

**Signing credentials** are stored in `android/gradle.properties`. Keep `onlymonkes-release.keystore` backed up — it is required for all future updates. Never uninstall the app to fix a signature mismatch; always use `adb install -r`.

---

## Collection

| | |
|---|---|
| **Collection** | Saga Monkes |
| **Chain** | Solana Mainnet |
| **Collection Address** | `GokAiStXz2Kqbxwz2oqzfEXuUhE7aXySmBGEP7uejKXF` |
| **NFT Verification** | Helius DAS API (`getAssetsByOwner`) |

---

## Key Dependencies

| Package | Purpose |
|---|---|
| `@xmtp/react-native-sdk` | Decentralized E2E encrypted group messaging (MLS v5) |
| `livekit-client` | WebRTC room/participant/speaker management |
| `@livekit/react-native` | LiveKit native audio session + WebRTC globals |
| `@solana-mobile/mobile-wallet-adapter-protocol-web3js` | MWA wallet connect |
| `@solana/web3.js` | Solana RPC + PublicKey + VersionedTransaction |
| `@solana/spl-token` | SPL token transfers + ATA management (tipping) |
| `expo-router` | File-based navigation |
| `expo-notifications` | Push notifications + local alerts |
| `expo-camera` | Video recording |
| `expo-av` | Video playback |
| `expo-video-thumbnails` | Video thumbnail generation |
| `expo-image` | Disk-cached image rendering (GIFs, NFT avatars) |
| `expo-background-fetch` | Background profile + data sync |
| `expo-task-manager` | Background task registration |
| `expo-secure-store` | Secure XMTP credential storage |
| `zustand` | Client state management |
| `react-native-reanimated` | Animations (speaking ring, confetti, fade-in) |
| `react-native-gesture-handler` | Swipe + gesture support |
| `crypto-js` | HS256 JWT signing for LiveKit tokens (client-side) |
