# OnlyMonkes

An NFT-gated group chat for **Saga Monkes** holders on Solana Mobile. Connect your wallet, prove ownership, and chat with other verified holders — all on-chain identity, decentralized messaging via XMTP.

---

## Features

- **NFT-gated access** — only verified Saga Monkes holders can join
- **Decentralized messaging** — group chat powered by XMTP (E2E encrypted, no central server)
- **NFT avatar** — your Monke NFT is your profile picture in chat
- **Custom username** — set a display name on first launch
- **Banana reactions** 🍌 — react to any message
- **Reply threads** — long press any message to reply
- **dApp side chats** — per-dApp community channels via the hamburger menu
- **Monke Tools** 🔧 — ecosystem links and notification settings
- **User profiles** — tap any username to view their NFT and bio
- **Push notifications** via expo-notifications
- **Solana Mobile optimized** — built for Seeker / Saga devices

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo (bare workflow) |
| Navigation | Expo Router (file-based) |
| Messaging | XMTP v5 (`@xmtp/react-native-sdk`) |
| Wallet | Mobile Wallet Adapter (`@solana-mobile/mobile-wallet-adapter-protocol-web3js`) |
| NFT Verification | Helius DAS API |
| State | Zustand |
| Fonts | Space Grotesk, Inter, JetBrains Mono |

---

## Project Structure

```
OnlyMonkes/
├── app/                        # Expo Router screens
│   ├── _layout.tsx             # Root layout (fonts, providers)
│   ├── index.tsx               # → ConnectScreen
│   ├── verify.tsx              # → VerifyScreen
│   ├── chat.tsx                # → ChatScreen (NFT-gated)
│   └── dapp-chat.tsx           # → DAppChatScreen
│
├── src/
│   ├── components/
│   │   ├── ChatInput.tsx       # Message composer with reply strip
│   │   ├── MenuDrawer.tsx      # Slide-out dApp navigation drawer
│   │   ├── MessageBubble.tsx   # Message with reactions + reply preview
│   │   ├── MonkeToolsModal.tsx # Ecosystem links + notification settings
│   │   ├── NftPickerModal.tsx  # NFT avatar selector
│   │   ├── UserProfileModal.tsx# Tappable user profile card
│   │   └── UsernameModal.tsx   # First-launch username setup
│   │
│   ├── hooks/
│   │   ├── useGroupChat.ts     # XMTP group chat logic
│   │   ├── useMobileWallet.ts  # MWA wallet connect + signMessage
│   │   ├── useNFTVerification.ts
│   │   └── useXmtp.ts          # XMTP client init, stream, send, react
│   │
│   ├── lib/
│   │   ├── constants.ts        # Theme, fonts, collection config
│   │   ├── nftVerification.ts  # Helius DAS API + on-chain fallback
│   │   ├── notifications.ts    # Push notification helpers
│   │   ├── session.ts          # Session persistence
│   │   ├── userProfile.ts      # Profile save/load (AsyncStorage)
│   │   └── xmtp.ts             # XMTP client + message codec utils
│   │
│   ├── screens/
│   │   ├── ChatScreen.tsx      # Main global chatroom
│   │   ├── ConnectScreen.tsx   # Wallet connect landing
│   │   ├── DAppChatScreen.tsx  # Per-dApp community chat
│   │   └── VerifyScreen.tsx    # NFT ownership verification
│   │
│   ├── store/
│   │   ├── appStore.ts         # Zustand: wallet, NFT, auth state
│   │   └── chatStore.ts        # Zustand: messages, reply state
│   │
│   └── types/index.ts
│
├── assets/
│   ├── header.png              # Header background image
│   ├── icon.png
│   ├── splash.png
│   └── fonts/                  # Space Grotesk, Inter, JetBrains Mono
│
├── app.config.ts               # Expo config + env vars
├── global.ts                   # Buffer / process polyfills
└── metro.config.js             # Node.js shims for Solana libs
```

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
Sign XMTP identity (wallet sign, no transaction / no fee)
        │
        ▼
Join global XMTP group chat
        │
        ▼
Load history + stream live messages
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

### 3. Configure (optional)

Defaults are already set for the Saga Monkes collection. To change the collection, edit `src/lib/constants.ts`:

```ts
export const NFT_COLLECTION_ADDRESS = 'your-collection-address';
export const COLLECTION_NAME = 'Your Collection';
export const HELIUS_API_KEY = 'your-helius-api-key'; // helius.dev
```

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

**Signing credentials** are stored in `android/gradle.properties`. Keep your keystore file (`onlymonkes-release.keystore`) backed up — it is required for all future updates.

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
| `@xmtp/react-native-sdk` | Decentralized group messaging |
| `@solana-mobile/mobile-wallet-adapter-protocol-web3js` | MWA wallet connect |
| `@solana/web3.js` | Solana RPC + PublicKey |
| `expo-router` | File-based navigation |
| `expo-notifications` | Push notifications |
| `expo-secure-store` | Secure credential storage |
| `zustand` | State management |
| `react-native-reanimated` | Animations |
