# OnlyMonkes

An NFT-gated social app for **Saga Monkes** holders on Solana Mobile. Connect your wallet, prove ownership, and chat with other verified holders — group chat, live audio rooms, live video calls, direct messages, GIFs, video, reactions, tipping, community events, and an AI trading agent — all powered by on-chain identity and decentralized messaging via XMTP.

---

## Features

### Core
- **NFT-gated access** — only verified Saga Monkes holders can join
- **Decentralized messaging** — group chat powered by XMTP v5 MLS (E2E encrypted, no central server)
- **NFT avatar** — your Monke NFT is your profile picture, verified on-chain
- **Custom username & bio** — set a display name and bio, synced across all group members via XMTP profile broadcasts
- **Legendary badge** 🌟 — special suffix for legendary-tier Monkes
- **Persistent login** — wallet session persists indefinitely across app updates (SecureStore); no re-login required unless the user explicitly logs out
- **7-day message history** — chat messages cached locally for 7 days (AsyncStorage); merged with live XMTP history on startup so older messages are never lost; media and link messages preserved indefinitely
- **Persistent user profiles** — all user avatars, usernames, and profile data cached locally and survive app restarts/updates; enriched on every startup from profile cache
- **Solana Mobile optimized** — built for Seeker / Saga devices (arm64-v8a only)
- **Onboarding carousel** — animated 3-slide explainer shown once on first launch (🐒 Only Saga Monkes · 🔐 Private by Design · 🎙 Live & Growing)
- **Not-a-holder screen** — non-holders see a branded gate with Magic Eden + Tensor marketplace CTAs and a "Why Saga Monkes?" breakdown
- **Skeleton loader** — animated shimmer + rotating fun loading texts while NFT ownership is verified on-chain

### Messaging
- **Emoji reactions** — react to any message with any emoji
- **Sticker reactions** — react with GIF stickers (SagaMonkes GIPHY sticker pack)
- **Reply threads** — long-press any message to quote-reply
- **Edit messages** — edit your own text messages within 1 minute of sending; `EDIT:` protocol message updates the bubble in-place with "(edited)" label
- **Copy messages** — long-press any message to copy its text to clipboard (Main Chat & DMs)
- **GIF search** — powered by GIPHY, inline animated GIFs in chat
- **Video messages** — record and send short video clips; thumbnails displayed inline with playback
- **Image watermark** — all sent photos and videos display a persistent OnlyMonkes watermark (bottom-right); watermark stays consistent size/position in both chat bubble and fullscreen lightbox
- **Share to X/Twitter** — after sending a photo, a popup offers to share on X with auto-caption "Shot Using @xOnlyMonkes" and the watermark baked in
- **Direct Messages** — 1-on-1 encrypted DMs with any Monkes holder; inbox screen with compose modal, searchable user directory, message preview and timestamps
- **Rich text links** — `@username` mentions render blue and are tappable (opens PFP modal); `$TOKEN` symbols render gold
- **Inline sender labels** — sender name + timestamp rendered inside every chat bubble (bottom-aligned); own messages right-aligned, others left-aligned
- **OnlyMonkes blue branding** — all blues unified to the signature sky blue (`#6CB4EE`) from the header logo: sender names, @mention links, toolbar labels (CAM/LIVE/GIF), live audio pill, default chat bubble theme, Community drawer title, and badge numbers
- **Bot command ticker** — continuously scrolling horizontal ticker in the Main Chat header showing all bot commands (white text, blue dot separators); DM with bot shows DM-only commands (Ask anything, APPROVE, REJECT, etc.)
- **Bot slash commands** — type `/` to autocomplete 10 bot commands: `/price`, `/ta`, `/watchlist`, `/alerts`, `/sports`, `/tip`, `/buy`, `/sell`, `/swap`, `/help`
- **Message search** — search through chat history
- **Pinned messages** — admins can pin important messages; pinned bar at top of chat with scroll-to and unpin controls
- **Link previews (OpenGraph)** — URLs shared in chat show inline card previews with title, description, and thumbnail (16KB head-only fetch, in-memory cache, 5s timeout)
- **Threads** — reply threads within the group; thread pill ("💬 N replies") below threaded messages; tap to open dedicated ThreadScreen
- **Online indicators** — green dot on user avatars showing who's currently active; "Last seen Xm ago" in profile modal; presence heartbeat system (60s interval, 2-min online threshold)
- **In-app Jupiter swaps** — `/buy $TOKEN [SOL]`, `/sell $TOKEN [%]`, `/swap $A for $B` resolve tokens via Jupiter strict list, show a confirmation modal (amounts, price impact, slippage), and execute via MWA biometric sign — all without leaving the app
- **In-app tipping** — `/tip @username [amount]` resolves username → wallet from the profile cache, opens a confirmation modal, and sends $SKR via MWA one-tap biometric; Support OnlyMonkes button also tips the dev wallet in-app
- **SOL → SKR swap tips** — users without $SKR can tip using SOL; Jupiter swap + SPL transfer chained in a single `transact()` session (one biometric prompt)

### Community
- **Bot alert channels** — four dedicated read-only feeds for categorized bot alerts: Monke Bets, Monke Trades, Monke Sales, Monke Predictions; each backed by a separate XMTP group configured via remote app config; channel icons in the toolbar below the message bar with white badge bubbles showing blue unread counts (tap to navigate + clear, long-press to clear); mute/unmute button in each channel header; warm cache with 60s TTL for instant re-opens without reload; real-time badge count streaming from background XMTP listeners; branded banner headers per channel (Bets.png, Trade.png, Sales.png, Predictions.png)
- **Sports filter** — per-sport mute toggles in Monke Bets channel; persisted to AsyncStorage and broadcast in PROFILE_UPDATE so the bot filters server-side; client-side filtering hides muted sport alerts in the Bets feed in real time; survives app restarts
- **dApp side chats** — per-dApp community channels (hamburger menu)
- **Community events calendar** — schedule, view, and RSVP to events; OnlyMonkes-tagged events support "Start Live Audio Chat" and "Start Video Call" when time arrives
- **Community badges** — white pill badges with OnlyMonkes blue count on hamburger menu items (DMs, Events, Links); total badge count on hamburger button; auto-clear on view
- **Support banner** — live $SKR token price (DexScreener) and Saga Monkes floor price (Magic Eden) flanking the "Help Support OnlyMonkes" banner; auto-refresh every 60s; floor price is a tappable blue pill that navigates to the in-app Marketplace
- **NFT Marketplace** — peer-to-peer Saga Monkes trading inside the app; list, bid, accept, delist — all via XMTP protocol messages; dedicated Marketplace screen with branded MonkeMarkets banner header; accessible from menu and from the tappable floor price button in the chat footer
- **Live Audio Rooms** — Twitter Spaces-style voice chat via LiveKit WebRTC; host/listener grid with speaking-highlight rings, mute toggle, live participant count, pinned banner in main chat
  - **Minimize to chat** — tap ⌄ to collapse the audio room back to the chat without disconnecting; a floating blue pill stays pinned at the top of the chat showing `@host · N Monkes`, a live mute/unmute button, and an expand arrow to return to the full room
- **Live Video Calls** — multi-person video group calls (3–15 participants) via LiveKit WebRTC SFU with 720p simulcast; native camera rendering via `@livekit/react-native` VideoView (RTCView); adaptive grid layout (1→full, 2→1x2, 3-4→2x2, 5-6→2x3, 7-9→3x3, 10-15→3x5 scroll); controls for mic, camera, flip camera, screen share, leave; embedded TURN for NAT traversal; DTLS/SRTP media encryption; runtime camera + mic permission requests on Android
  - **iOS-style PiP bubble** — minimize the video call to a floating picture-in-picture bubble overlaid on the ChatScreen header; shows the active speaker's NFT avatar with animated speaking ring, pulsing LIVE badge, participant count; tap to expand back to full-screen
  - **Real-time sticker reactions** — send SagaMonkes GIPHY stickers during video calls; reactions float up from the bottom-right with scale + fade animations; broadcast to all participants in real time via LiveKit data channel; horizontal sticker tray toggled by the 🐵 button in controls
  - **Video room banner** — pinned in-chat banner showing VIDEO badge, host PFP, participant count, Join/Leave/End buttons
  - **XMTP signaling** — video call start/end coordinated via `VIDEO_ROOM:` protocol messages; all connected clients see the banner and can join
- **Activity leaderboard** — weekly stats tracking messages sent/reactions given/received; top-3 with medals in the Members tab; auto-resets on Monday UTC
- **Login streaks** — daily login streak counter; confetti fires on the 7th day
- **Daily GMonke** — bot posts "GMonke" every morning at 8am EST to Main Chat
- **Weekly PNL report** — bot sends hypothetical PNL for all trade alerts every Sunday at 5am EST to Monke Trades channel; tracks all signaled trades persistently with entry price, targets, and stop loss
- **Popup modals** — all popup dialogs (edit message, X share) use dark theme (black background, OnlyMonkes blue text) matching the app aesthetic

### Notifications
- **Push notifications (v8)** — FCM V1 API via service account + Expo push relay with Bearer auth; all channels use MAX importance for heads-up banners (including bot alerts); legacy channels (v1–v7) auto-deleted on startup; foreground heads-up alerts via native DirectNotif module (bypasses Expo groupKey silent interception)
- **Per-user notification prefs** — opt-in categories: All Messages, @Mentions Only, Bot/AI alerts, DM notifications, Live Room start alerts; prefs persisted to AsyncStorage and broadcast in `PROFILE_UPDATE` so the bot filters server-side; muted bot channels and sports filters also persisted and survive app restarts
- **Direct DM push relay** — when a user sends a DM, a push notification is sent directly to the recipient's FCM token (peer-to-peer, no bot required); includes sender NFT avatar in the data payload
- **FCM token fallback** — direct FCM token generation (not Expo relay) for server-side bot push; cached in SecureStore and broadcast with PROFILE_UPDATE
- **Background sync** — `expo-background-fetch` task keeps profile and data fresh when backgrounded

### Profiles & Wallets
- **User profiles** — tap any username to view their NFT, bio, wallet, and social links
- **Online status** — green dot and "Online" / "Last seen Xm ago" shown in profile modal
- **Tipping** — send SOL tips directly to a user's tip wallet from their profile card
- **Monke Tools** 🔧 — ecosystem links, settings, and notification controls
- **MWA biometric re-auth** — cached wallet adapter auth tokens for silent re-authentication with biometric prompt; no app-switch needed after first connect

### AI Agent & TA Scanner
- **AI Agent #9385** — XMTP bot in the group chat; delivers TA alerts (RSI, MACD, EMA) for Solana tokens, Saga Monke NFT sale alerts, and responds to DMs via Groq LLM (70B, sub-second); built on ElizaOS v2 with plugin-solana for trade execution
- **TA Savvy Monke** — professional-grade multi-timeframe TA scanner; scans all verified Solana SPL tokens every 8 min across 15m/1H/4H/daily candles; posts confluence alerts (Ichimoku, Fibonacci, Bollinger, Stochastic, ADX, OBV, candle patterns) to Main Chat + Monke Trades channel when signal score ≥69/100; sentiment gate (Birdeye trending + wash trading detection)
- **TA candle charts** — every bullish TA alert includes a generated candlestick chart image (with Fibonacci levels, entry/stop/targets overlaid) sent to both Main Chat and the Monke Trades channel
- **AutonoMonke** — autonomous trading engine; TA scanner signals with ≥69% confluence + 2+ aligned timeframes auto-execute trades via Jupiter for enrolled users; DM `/automonke start` to enroll, `/automonke size` to set position %, `/automonke positions` to view open trades, `/automonke withdraw` to close all and withdraw
- **Slash commands** — `/tip @Username [amt]` (send $SKR), `/buy $TOKEN`, `/sell $TOKEN`, `/swap $A for $B` — all execute in-app via MWA biometric sign + Jupiter aggregator
- **DM slash commands** — DM the bot for 24 commands: `/automonke` (status/start/stop/size/confidence/positions/history/withdraw/fund), `/risk` (size/stop/max/drawdown/auto/mincap/conviction/blacklist), `/price`, `/ta`, `/buy`
- **Color-coded risk alerts** — 🟢 Low Risk, 🟡 Medium, 🔴 High Risk dots on all TA alerts; compact confluence tags (RSI + MACD Cross + BB Squeeze); inline chart links (DEXScreener, Birdeye, Jupiter)
- **Per-user TA risk settings** — DM the bot `/risk` to set position size, stop-loss %, conviction threshold, blacklist, mute, and more
- **Backtesting** — DM `/backtest $TOKEN [days]` for historical signal replay with win/loss stats, Sharpe ratio, max drawdown
- **Portfolio tracking** — DM `/portfolio` for open positions, closed P&L, and daily summaries
- **NFT sale images** — Saga Monkes sales alerts include the actual NFT artwork fetched via Helius DAS API, displayed in the MonkeSales channel and as a big-picture push notification
- **Unified push notifications** — all bot alerts (TA signals, NFT sales, sports bets, predictions, GMonke, PNL reports) route through a single FCM v1 + Expo push pipeline with user preference filtering, per-channel muting, stale token pruning, and big-picture image support
- **LLM chain** — Groq (primary, free, 70B, sub-second) → Ollama (local fallback) → Anthropic (last resort); all app users can DM the bot for free AI chat
- **Support OnlyMonkes button** — in the Tools drawer; quick-tip 5/10/25/50 $SKR to the dev wallet via in-app MWA biometric (no app switch)
- **Per-type push titles** — 🐒 MONKE #1234 Sold! / 🐒 TA Signal: $TOKEN / 🔮 Prediction Alert per alert type
- **Rich push images** — TA trade alerts include the candlestick chart as a big-picture notification; NFT sales include the Monke artwork

### Infrastructure & Quality
- **EAS Update (OTA)** — over-the-air updates via `expo-updates`; silent download on launch, prompt to restart; avoids full dApp Store resubmission for minor fixes
- **Unit tests** — Jest with `react-native` preset; tests for appStore (8 tests) and chatStore (7 tests); `npm test` / `npm run test:coverage`
- **E2E tests** — Detox config for end-to-end testing (requires bare workflow build)
- **Crash reporting** — Sentry integration (`@sentry/react-native`) with PII scrubbing; captures errors, breadcrumbs, and user identification
- **Analytics** — Firebase Analytics (`@react-native-firebase/analytics`); tracks app opens, messages sent, DMs opened, tips sent, swaps executed, daily sessions, chat duration, user properties
- **Self-hosted LiveKit** — Docker Compose config for self-hosted LiveKit SFU on VPS; embedded TURN for NAT traversal; ~$6-10/mo on Hetzner CX22 (2 vCPU, 4GB RAM); handles 5-10 concurrent rooms with simulcast

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo SDK 51 (bare workflow) |
| Navigation | Expo Router v3 (file-based) |
| Messaging | XMTP v5 MLS (`@xmtp/react-native-sdk`) |
| Live Audio | LiveKit WebRTC (`livekit-client`, `@livekit/react-native`) |
| Live Video | LiveKit WebRTC with 720p simulcast + data channels for reactions |
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
| OTA Updates | EAS Update (`expo-updates`) |
| Crash Reporting | Sentry (`@sentry/react-native`) |
| Analytics | Firebase Analytics (`@react-native-firebase/analytics`) |
| JWT Signing | `crypto-js` (HS256 for LiveKit tokens, client-side) |
| Animations | `react-native-reanimated` ~3.10 |
| Gestures | `react-native-gesture-handler` |
| Fonts | Space Grotesk, Inter, JetBrains Mono |

---

## Project Structure

```
OnlyMonkes/
├── app/                              # Expo Router screens
│   ├── _layout.tsx                   # Root layout: LiveKit globals, push token, bg-sync, Sentry, analytics, OTA
│   ├── index.tsx                     # → ConnectScreen
│   ├── verify.tsx                    # → VerifyScreen
│   ├── bot-channel.tsx               # → BotChannelScreen (read-only bot alert feed)
│   ├── chat.tsx                      # → ChatScreen (main NFT-gated group)
│   ├── dapp-chat.tsx                 # → DAppChatScreen
│   ├── dms.tsx                       # → DmInboxScreen
│   ├── dm/[inboxId].tsx              # → DmScreen (1-on-1 DM route)
│   ├── live-room.tsx                 # → LiveAudioRoomScreen
│   ├── video-room.tsx                # → VideoRoomScreen (multi-person video calls)
│   ├── thread.tsx                    # → ThreadScreen (reply thread view)
│   └── marketplace.tsx               # → MarketplaceScreen (P2P NFT trading)
│
├── src/
│   ├── components/
│   │   ├── CalendarModal.tsx         # Community event scheduler
│   │   ├── BotCommandTicker.tsx      # Scrolling horizontal ticker: bot commands (chat variant + DM variant)
│   │   ├── ChatInput.tsx             # Message composer: text, reply strip + toolbar (CAM/LIVE/GIF + bot channel icons w/ badges)
│   │   ├── ConfettiView.tsx          # 40-particle Reanimated confetti (login streak milestones)
│   │   ├── GifPickerModal.tsx        # GIPHY search + inline GIF picker
│   │   ├── LinkPreviewCard.tsx       # OpenGraph link preview card (title, description, thumbnail)
│   │   ├── LiveAudioPill.tsx         # Floating OnlyMonkes blue pill: host, count, mute/unmute (minimized room)
│   │   ├── LiveRoomBanner.tsx        # Pinned banner: host PFP, LIVE badge, count, Join/Leave
│   │   ├── MenuDrawer.tsx            # Slide-out drawer: dApp chats, Members, Events, Settings, community badges
│   │   ├── MessageBubble.tsx         # Bubble: text/GIF/IMAGE/VIDEO/reactions/reply preview/link preview/thread pill/online dot
│   │   ├── MonkeToolsModal.tsx       # Ecosystem links + notification settings
│   │   ├── NftPickerModal.tsx        # NFT avatar selector
│   │   ├── OnboardingCarousel.tsx    # First-launch 3-slide animated explainer
│   │   ├── OnlineDot.tsx             # Green presence indicator dot
│   │   ├── PinnedBar.tsx             # Pinned messages bar with scroll-to and unpin
│   │   ├── SearchModal.tsx           # Message history search
│   │   ├── SwapConfirmModal.tsx      # Jupiter swap confirmation (amounts, price impact, slippage)
│   │   ├── TipModal.tsx              # SKR tipping flow (in-app MWA biometric)
│   │   ├── UserProfileModal.tsx      # Profile card: NFT, bio, wallet, DM, tip buttons, online status
│   │   ├── UsernameModal.tsx         # First-launch username setup
│   │   ├── VideoCallPip.tsx          # iOS-style PiP bubble: active speaker avatar, speaking ring, count, tap to expand
│   │   ├── VideoCameraModal.tsx      # Full-screen camera: record, preview, upload to Cloudinary
│   │   ├── VideoReactionOverlay.tsx  # Floating sticker reactions with upward drift + fade animation
│   │   ├── VideoRoomBanner.tsx       # Pinned in-chat banner: VIDEO badge, host PFP, Join/Leave/End
│   │   └── VideoStickerTray.tsx      # Horizontal sticker picker for video calls (SagaMonkes GIPHY stickers)
│   │
│   ├── hooks/
│   │   ├── useDm.ts                  # 1-on-1 DM hook (includes direct push relay to recipient)
│   │   ├── useDmInbox.ts             # DM inbox list hook
│   │   ├── useGroupChat.ts           # Generic XMTP group chat hook (warm cache, 60s TTL, bot channels/dApp chats)
│   │   ├── useMobileWallet.ts        # MWA wallet connect + signMessage + biometric re-auth
│   │   ├── useNFTVerification.ts     # NFT ownership check
│   │   └── useXmtp.ts                # XMTP client init, stream, send, react, broadcastProfile, broadcastLiveRoom, broadcastVideoRoom
│   │
│   ├── lib/
│   │   ├── activityTracker.ts        # Weekly stats: sent/given/received; getLeaderboard()
│   │   ├── analytics.ts              # Firebase Analytics: app open, messages, DMs, tips, swaps, session duration
│   │   ├── backgroundSync.ts         # expo-background-fetch task registration
│   │   ├── calendar.ts               # Event helpers
│   │   ├── constants.ts              # COLORS, fonts, collection config
│   │   ├── giphy.ts                  # GIPHY search + sticker API wrapper
│   │   ├── linkPreview.ts            # OpenGraph metadata fetching (16KB head-only, in-memory cache, 5s timeout)
│   │   ├── liveAudio.ts              # LiveKit Room singleton — audio rooms, persists across navigation
│   │   ├── liveVideo.ts              # LiveKit Room singleton — video calls with simulcast, data channel reactions
│   │   ├── livekit.ts                # LiveKit JWT generation (HS256, client-side); room helpers
│   │   ├── marketplace.ts            # P2P NFT marketplace: list, bid, accept, delist via XMTP protocol
│   │   ├── messageCache.ts           # AsyncStorage message cache (7-day expiry, 2000 msg cap, merged with XMTP history on startup)
│   │   ├── matrica.ts                # Matrica holder verification
│   │   ├── nftVerification.ts        # Helius DAS API + on-chain fallback
│   │   ├── notifications.ts          # Expo push token registration + FCM fallback + local notifications
│   │   ├── offlineQueue.ts           # Offline message queue + auto-flush
│   │   ├── otaUpdates.ts             # EAS Update: check on launch, download silently, prompt restart
│   │   ├── pinnedMessages.ts         # Pinned messages: PIN: protocol, AsyncStorage persistence, in-memory cache
│   │   ├── presence.ts               # PRESENCE: heartbeat system (60s interval, 2-min online threshold)
│   │   ├── remoteConfig.ts           # Remote app config fetch (bot channel IDs, feature flags)
│   │   ├── sentry.ts                 # Sentry init, user identification, error capture, breadcrumbs
│   │   ├── session.ts                # Session persistence (SecureStore, indefinite — survives app updates)
│   │   ├── jupiterSwap.ts            # Jupiter v6 swap: token resolution, quotes, MWA execution
│   │   ├── solana.ts                 # SKR tipping, SOL→SKR swap tips, wallet validation
│   │   ├── streaks.ts                # Daily login streak (AsyncStorage)
│   │   ├── theme.ts                  # Extended theme tokens
│   │   ├── threads.ts                # Thread replies: THREAD: protocol, metadata tracking, AsyncStorage persistence
│   │   ├── userProfile.ts            # Profile cache (in-memory + AsyncStorage, push token per user)
│   │   ├── videoUpload.ts            # Cloudinary video + thumbnail upload
│   │   └── xmtp.ts                   # XMTP client, message encode/decode, group/DM/video room helpers
│   │
│   ├── screens/
│   │   ├── BotChannelScreen.tsx      # Bot alert feed w/ mute button + sports filter (Bets, Trades, Sales, Predictions)
│   │   ├── ChatScreen.tsx            # Main group chat: header, live banner, video PiP bubble, floating pill, input
│   │   ├── ConnectScreen.tsx         # Wallet connect landing + onboarding carousel
│   │   ├── DAppChatScreen.tsx        # Per-dApp community chat
│   │   ├── DmInboxScreen.tsx         # DM inbox list with compose modal
│   │   ├── DmScreen.tsx              # 1-on-1 DM screen
│   │   ├── LiveAudioRoomScreen.tsx   # Spaces-style audio room; minimize ⌄ / leave ✕
│   │   ├── MarketplaceScreen.tsx     # P2P NFT trading: listings, bids, accept/delist
│   │   ├── ThreadScreen.tsx          # Thread reply view with message history
│   │   ├── VerifyScreen.tsx          # NFT verification: skeleton shimmer, fun texts, not-a-holder gate
│   │   └── VideoRoomScreen.tsx       # Multi-person video calls: adaptive grid, sticker reactions, minimize to PiP
│   │
│   ├── store/
│   │   ├── appStore.ts               # Zustand: wallet, NFT, push token, live room, video room, notif prefs, bot channels, MWA auth, community badges
│   │   └── chatStore.ts              # Zustand: messages, reply state, typing indicators
│   │
│   ├── __tests__/
│   │   ├── appStore.test.ts          # 8 unit tests for appStore
│   │   └── chatStore.test.ts         # 7 unit tests for chatStore
│   │
│   └── types/index.ts
│
├── assets/
│   ├── icon.png
│   ├── splash.png
│   ├── header.png
│   └── fonts/                        # Space Grotesk, Inter, JetBrains Mono
│
├── docs/
│   ├── privacy.html                  # Privacy Policy (GitHub Pages, dedicated URL for dApp Store)
│   └── terms.html                    # Terms and Conditions (GitHub Pages, dedicated URL for dApp Store)
│
├── infra/
│   ├── docker-compose.livekit.yml    # Self-hosted LiveKit SFU Docker config
│   └── livekit.yaml                  # LiveKit server config (TURN, simulcast, room defaults)
│
├── app.config.ts                     # Expo config + env vars (Helius, GIPHY, Cloudinary, LiveKit, Sentry)
├── eas.json                          # EAS Build + Update config (preview + production channels)
├── jest.config.js                    # Jest config (react-native preset)
├── jest.setup.js                     # AsyncStorage mock for tests
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
| `EDIT:` | `EDIT:<originalMsgId>:<username>:<newContent>` | Edit a previously sent message (within 1 min) |
| `LIVE_ROOM:` | `LIVE_ROOM:<json>` | Live audio room signal (start/end) |
| `VIDEO_ROOM:` | `VIDEO_ROOM:<json>` | Live video call signal (start/end) |
| `PIN:` | `PIN:<messageId>:<action>` | Pin/unpin message (admin only) |
| `PRESENCE:` | `PRESENCE:<inboxId>:<timestamp>` | Online presence heartbeat |
| `THREAD:` | `THREAD:<parentId>:<username>:<content>` | Thread reply |
| `NFT_LIST:` | `NFT_LIST:<json>` | NFT marketplace listing |
| `NFT_BID:` | `NFT_BID:<json>` | NFT marketplace bid |
| `NFT_ACCEPT:` | `NFT_ACCEPT:<json>` | Accept NFT bid |
| `NFT_DELIST:` | `NFT_DELIST:<json>` | Remove NFT listing |

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

## Live Video Call Flow

```
Host taps Start Video Call (Events tab or ChatInput)
        │
        ▼
createVideoRoom() → LiveKit token + VIDEO_ROOM: XMTP broadcast
        │
        ▼
VideoRoomBanner appears for all members (VIDEO badge, Join button)
        │
        ├── Push notification: "username started a Video Call"
        │
        ▼
Members tap Join → navigate to /video-room → liveVideo singleton connects
        │
        ▼
Adaptive grid UI: 720p simulcast, speaking-highlight borders, NFT avatars
        │
        ├── 🐵 Sticker tray → tap sticker → LiveKit data channel → all see reaction
        │       → Stickers float up from bottom-right with scale + fade animation
        │
        ├── Tap ⤡ (Minimize) → router.back() — Room stays connected in singleton
        │       │
        │       ▼
        │   iOS-style PiP bubble (top-right of ChatScreen header)
        │   Shows: active speaker avatar (animated ring), VIDEO label, N Monkes
        │   Tap bubble → expand back to full-screen VideoRoomScreen
        │
        ▼
Host ends room → VIDEO_ROOM: {active: false} → banner + PiP dismissed
        │
        └── disconnectFromVideoRoom() → AudioSession.stopAudioSession()
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

SENTRY_DSN=your-sentry-dsn                 # sentry.io
```

These are injected via `app.config.ts` → `Constants.expoConfig.extra`.

### 4. Self-Hosted LiveKit (Optional)

For self-hosted video/audio infrastructure:

```bash
cd infra
docker-compose -f docker-compose.livekit.yml up -d
```

Requires a VPS with public IP, ports 7880 (WS), 7881 (TCP), 3478/5349 (TURN), 50000-60000/UDP (RTC). Cost: ~$6-10/mo on Hetzner CX22.

### 5. Run on Android

```bash
npx expo run:android
```

> **Requires a physical Android device** (Seeker or Saga recommended) with a Solana wallet app installed (Phantom or Solflare). Expo Go is not supported — MWA requires a custom dev build.

### 6. Run Tests

```bash
npm test                # unit tests
npm run test:watch      # watch mode
npm run test:coverage   # coverage report
```

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
| `livekit-client` | WebRTC room/participant/speaker management + data channels |
| `@livekit/react-native` | LiveKit native audio session + WebRTC globals |
| `@solana-mobile/mobile-wallet-adapter-protocol-web3js` | MWA wallet connect |
| `@solana/web3.js` | Solana RPC + PublicKey + VersionedTransaction |
| `@solana/spl-token` | SPL token transfers + ATA management (tipping) |
| `expo-router` | File-based navigation |
| `expo-notifications` | Push notifications + local alerts |
| `expo-updates` | OTA updates via EAS Update |
| `expo-camera` | Video recording |
| `expo-av` | Video playback |
| `expo-video-thumbnails` | Video thumbnail generation |
| `expo-image` | Disk-cached image rendering (GIFs, NFT avatars) |
| `expo-background-fetch` | Background profile + data sync |
| `expo-task-manager` | Background task registration |
| `expo-secure-store` | Secure XMTP credential storage |
| `@sentry/react-native` | Crash reporting + error tracking |
| `@react-native-firebase/analytics` | Usage analytics + session tracking |
| `zustand` | Client state management |
| `react-native-reanimated` | Animations (speaking ring, confetti, fade-in, PiP pulse) |
| `react-native-gesture-handler` | Swipe + gesture support |
| `crypto-js` | HS256 JWT signing for LiveKit tokens (client-side) |
| `@shopify/react-native-skia` | GPU-accelerated 2D rendering engine |
| `expo-clipboard` | Copy message text to clipboard |
