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

### Messaging
- **Emoji reactions** — react to any message with any emoji
- **Sticker reactions** — react with GIF stickers
- **Reply threads** — long-press any message to quote-reply
- **GIF search** — powered by GIPHY, inline animated GIFs in chat
- **Video messages** — record and send short video clips; thumbnails displayed inline with playback
- **Direct Messages** — 1-on-1 encrypted DMs with any Monkes holder; inbox screen lists all active DMs
- **Message search** — search through chat history

### Community
- **dApp side chats** — per-dApp community channels (hamburger menu)
- **Community events calendar** — schedule, view, and RSVP to events; OnlyMonkes-tagged events support "Start Live Audio Chat" when time arrives
- **Live Audio Rooms** — Twitter Spaces-style voice chat rooms via LiveKit WebRTC; host / listener grid with speaking highlights, mute toggle, live participant count, pinned banner in main chat
- **Activity leaderboard** — weekly stats tracking messages sent/reactions given/received; top-3 with medals in the Members tab; auto-resets on Monday UTC
- **Login streaks** 🔥 — daily login streak counter; confetti fires on the 7th day

### Notifications & Background
- **Push notifications** — Expo push tokens relayed via AI Agent bot; alerts for new messages and live room starts
- **Background sync** — `expo-background-fetch` task keeps profile and data fresh when the app is backgrounded

### Profiles & Wallets
- **User profiles** — tap any username to view their NFT, bio, wallet, and social links
- **Tipping** — send SOL tips directly to a user's tip wallet from their profile card
- **Monke Tools** 🔧 — ecosystem links, settings, and notification controls

### AI Agent
- **AI Agent #9385** — XMTP bot in the group chat; delivers technical analysis alerts (RSI, MACD, EMA) for Solana tokens and responds to DMs via Claude AI; built on ElizaOS v2 with plugin-solana for trade execution

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo SDK 51 (bare workflow) |
| Navigation | Expo Router v3 (file-based) |
| Messaging | XMTP v5 MLS (`@xmtp/react-native-sdk`) |
| Live Audio | LiveKit WebRTC (`livekit-client`, `@livekit/react-native`) |
| Wallet | Mobile Wallet Adapter (`@solana-mobile/mobile-wallet-adapter-protocol-web3js`) |
| NFT Verification | Helius DAS API (`getAssetsByOwner`) |
| State | Zustand |
| Server State | TanStack Query (`@tanstack/react-query`) |
| Images | `expo-image` (disk-cached GIFs, NFT avatars) |
| Video | `expo-camera`, `expo-av`, `expo-video-thumbnails` |
| Video Hosting | Cloudinary (upload preset, unsigned) |
| GIF Search | GIPHY API |
| Push Notifications | Expo Push + FCM (via AI Agent relay) |
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
│   ├── chat.tsx                      # → ChatScreen (main NFT-gated group)
│   ├── dapp-chat.tsx                 # → DAppChatScreen
│   ├── dms.tsx                       # → DmInboxScreen
│   ├── dm/[inboxId].tsx              # → DmScreen (1-on-1 DM route)
│   └── live-room.tsx                 # → LiveAudioRoomScreen
│
├── src/
│   ├── components/
│   │   ├── CalendarModal.tsx         # Community event scheduler (default location: OnlyMonkes)
│   │   ├── ChatInput.tsx             # Message composer: text, GIF, video, camera, reply strip
│   │   ├── ConfettiView.tsx          # 40-particle Reanimated confetti (login streak milestones)
│   │   ├── GifPickerModal.tsx        # GIPHY search + inline GIF picker
│   │   ├── LiveRoomBanner.tsx        # Pinned banner: host PFP, LIVE badge, count, Join/Leave
│   │   ├── MenuDrawer.tsx            # Slide-out drawer: dApp chats, Members, Community/Events
│   │   ├── MessageBubble.tsx         # Bubble: text/GIF/IMAGE/VIDEO/reactions/reply preview
│   │   ├── MonkeToolsModal.tsx       # Ecosystem links + notification settings
│   │   ├── NftPickerModal.tsx        # NFT avatar selector
│   │   ├── SearchModal.tsx           # Message history search
│   │   ├── TipModal.tsx              # SOL tipping flow
│   │   ├── UserProfileModal.tsx      # Profile card: NFT, bio, wallet, DM, tip buttons
│   │   ├── UsernameModal.tsx         # First-launch username setup
│   │   └── VideoCameraModal.tsx      # Full-screen camera: record, preview, upload to Cloudinary
│   │
│   ├── hooks/
│   │   ├── useDm.ts                  # 1-on-1 DM conversation hook
│   │   ├── useDmInbox.ts             # DM inbox list hook
│   │   ├── useGroupChat.ts           # Legacy group chat hook
│   │   ├── useMobileWallet.ts        # MWA wallet connect + signMessage
│   │   ├── useNFTVerification.ts     # NFT ownership check
│   │   └── useXmtp.ts                # XMTP client init, stream, send, react, broadcastLiveRoom
│   │
│   ├── lib/
│   │   ├── activityTracker.ts        # Weekly stats: sent/given/received; getLeaderboard()
│   │   ├── backgroundSync.ts         # expo-background-fetch task registration
│   │   ├── calendar.ts               # Event helpers (create, parse, RSVP)
│   │   ├── constants.ts              # COLORS, fonts, collection config
│   │   ├── giphy.ts                  # GIPHY search API wrapper
│   │   ├── livekit.ts                # LiveKit JWT generation (HS256, client-side); room helpers
│   │   ├── matrica.ts                # Matrica holder verification helper
│   │   ├── nftColor.ts               # NFT dominant-color extractor
│   │   ├── nftVerification.ts        # Helius DAS API + on-chain fallback
│   │   ├── notifications.ts          # Expo push token registration + local notifications
│   │   ├── remoteConfig.ts           # Remote feature flags
│   │   ├── session.ts                # Session persistence (SecureStore)
│   │   ├── solana.ts                 # Solana RPC helpers
│   │   ├── streaks.ts                # Daily login streak (AsyncStorage)
│   │   ├── theme.ts                  # Extended theme tokens
│   │   ├── userProfile.ts            # Profile cache (in-memory + AsyncStorage, 6hr freshness)
│   │   ├── videoUpload.ts            # Cloudinary video + thumbnail upload
│   │   └── xmtp.ts                   # XMTP client, message encode/decode, group/DM helpers
│   │
│   ├── screens/
│   │   ├── ChatScreen.tsx            # Main group chat: header, live banner, input, leaderboard
│   │   ├── ConnectScreen.tsx         # Wallet connect landing
│   │   ├── DAppChatScreen.tsx        # Per-dApp community chat
│   │   ├── DmInboxScreen.tsx         # DM inbox list
│   │   ├── DmScreen.tsx              # 1-on-1 DM screen
│   │   ├── LiveAudioRoomScreen.tsx   # Twitter Spaces-style audio room (LiveKit)
│   │   └── VerifyScreen.tsx          # NFT ownership verification
│   │
│   ├── store/
│   │   ├── appStore.ts               # Zustand: wallet, NFT, push token, activeLiveRoom, streak
│   │   └── chatStore.ts              # Zustand: messages, reply state, typing indicators
│   │
│   └── types/index.ts
│
├── assets/
│   ├── icon.png
│   ├── splash.png
│   ├── header.png
│   ├── ai-agent.pdf                  # AI Agent feature overview asset
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
| `PROFILE_UPDATE:` | `PROFILE_UPDATE:<json>` | Profile broadcast (username, bio, NFT, push token…) |
| `TYPING:` | `TYPING:<inboxId>:<username>` | Typing indicator |
| `VIDEO:` | `VIDEO:<videoUrl>\|<thumbUrl>` | Video message (Cloudinary URLs) |
| `LIVE_ROOM:` | `LIVE_ROOM:<json>` | Live audio room signal (start/end/count) |

---

## Auth Flow

```
Connect Wallet (MWA)
        │
        ▼
Fetch NFTs via Helius DAS API
        │
        ├── No Saga Monkes found → Access Denied
        │
        ▼
Sign XMTP identity (wallet sign — no transaction, no fee)
        │
        ▼
Join global XMTP MLS group
        │
        ▼
Broadcast PROFILE_UPDATE (username, NFT avatar, push token)
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
        ├── AI Agent relays push notification to all registered tokens
        │
        ▼
Members tap Join → navigate to /live-room
        │
        ▼
AudioSession.startAudioSession() → room.connect(LK_URL, token)
        │
        ▼
Twitter Spaces UI: host card + listener grid + speaking highlights
        │
        ▼
Host ends room → LIVE_ROOM: {active: false} → banner dismissed
```

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
```

These are injected into the app via `app.config.ts` → `Constants.expoConfig.extra`.

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
| `@solana/web3.js` | Solana RPC + PublicKey |
| `expo-router` | File-based navigation |
| `expo-notifications` | Push notifications + local alerts |
| `expo-camera` | Video recording |
| `expo-av` | Video playback |
| `expo-video-thumbnails` | Video thumbnail generation |
| `expo-image` | Disk-cached image rendering (GIFs, NFT avatars) |
| `expo-background-fetch` | Background profile + data sync |
| `expo-task-manager` | Background task registration |
| `expo-secure-store` | Secure XMTP credential storage |
| `@tanstack/react-query` | Server state + caching |
| `zustand` | Client state management |
| `react-native-reanimated` | Animations (speaking ring, confetti, fade-in) |
| `react-native-gesture-handler` | Swipe + gesture support |
| `crypto-js` | HS256 JWT signing for LiveKit tokens (client-side) |
