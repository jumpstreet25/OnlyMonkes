# OnlyMonkes — Solana Mobile dApp

A **production-ready scaffold** for an NFT-gated global chatroom on Solana Mobile (Android). Holders of the **Saga Monkes** collection connect their wallet, prove ownership on-chain, and join a decentralized group chat via XMTP.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        User Device                       │
│                                                          │
│   ┌─────────────────────────────────────────────────┐   │
│   │           NFT Chat (React Native + Expo)        │   │
│   │                                                  │   │
│   │  ConnectScreen  ──►  VerifyScreen  ──►  Chat    │   │
│   │       │                   │                │     │   │
│   │       ▼                   ▼                ▼     │   │
│   │    MWA Hook         NFT Verify         XMTP Hook │   │
│   └─────────────────────────────────────────────────┘   │
│            │                   │                │        │
│            ▼                   ▼                ▼        │
│       Wallet App        Helius DAS API     XMTP Network  │
│    (Phantom / Solflare)  (NFT ownership)  (P2P messages) │
└─────────────────────────────────────────────────────────┘
```

### Auth Flow

```
1. Connect Wallet (MWA)
        │
        ▼
2. Fetch NFTs from Helius DAS API
        │
        ├── No collection NFT found → Access Denied
        │
        ▼
3. Sign XMTP identity message (wallet sign, no tx)
        │
        ▼
4. Join global XMTP conversation (all holders share same topic)
        │
        ▼
5. Load history + stream live messages
```

---

## Project Structure

```
nft-chat-dapp/
├── app/                      # Expo Router routes
│   ├── _layout.tsx           # Root layout (fonts, providers)
│   ├── index.tsx             # → ConnectScreen
│   ├── verify.tsx            # → VerifyScreen
│   └── chat.tsx              # → ChatScreen (auth-guarded)
│
├── src/
│   ├── components/
│   │   ├── MessageBubble.tsx # Message w/ reactions + reply
│   │   └── ChatInput.tsx     # Composer w/ reply strip
│   │
│   ├── hooks/
│   │   ├── useMobileWallet.ts  # MWA connect + signMessage
│   │   ├── useNFTVerification.ts
│   │   └── useXmtp.ts          # XMTP init, stream, send
│   │
│   ├── lib/
│   │   ├── constants.ts        # Theme, config, collections
│   │   ├── nftVerification.ts  # Helius DAS API + fallback
│   │   └── xmtp.ts             # XMTP client + message utils
│   │
│   ├── screens/
│   │   ├── ConnectScreen.tsx
│   │   ├── VerifyScreen.tsx
│   │   └── ChatScreen.tsx
│   │
│   ├── store/
│   │   ├── appStore.ts         # Zustand: wallet + auth state
│   │   └── chatStore.ts        # Zustand: messages
│   │
│   └── types/index.ts
│
├── global.ts                  # Buffer / process polyfills
├── metro.config.js            # Node.js shims for Solana
├── app.config.ts              # Expo config + env vars
└── babel.config.js
```

---

## Setup

### 1. Clone & Install

```bash
git clone <your-repo>
cd nft-chat-dapp
npm install
```

### 2. Configure Your Collection

Edit `src/lib/constants.ts` or use environment variables:

```bash
# .env (all values already hardcoded — no .env needed for defaults)
NFT_COLLECTION_ADDRESS=8vN3ke2Q7dbv8hpEsvcbR7jDmPp85sK6qagd77aR73jx  # ✅ Saga Monkes
HELIUS_API_KEY=f222b023-3712-4ab5-9dd1-caff88d27c40                   # ✅ Already set
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

Collection name and app name are already set in `src/lib/constants.ts`:
```ts
export const COLLECTION_NAME = "Saga Monkes"; // ✅
```

### 3. Add Fonts

Download from Google Fonts and place in `assets/fonts/`:
- [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) — Bold, Medium
- [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) — Regular
- [Inter](https://fonts.google.com/specimen/Inter) — Regular, Medium, SemiBold

### 4. Update App Identity (for MWA)

In `src/hooks/useMobileWallet.ts`:
```ts
const APP_IDENTITY = {
  name: "Your App Name",
  uri: "https://yourapp.com",
  icon: "favicon.ico",
};
```

### 5. Run (Android only — MWA requires Android)

```bash
# Build dev client
npx expo run:android

# Or with EAS Build
eas build --platform android --profile development
```

> ⚠️ **MWA requires a physical Android device or emulator** with a Solana wallet app installed (Phantom, Solflare).  
> Expo Go does **not** support MWA — you must use a dev build.

---

## Key Dependencies

| Package | Purpose |
|---|---|
| `@solana-mobile/mobile-wallet-adapter-protocol-web3js` | MWA — wallet connect + signing |
| `@solana/web3.js` | Solana RPC, PublicKey |
| `@metaplex-foundation/js` | NFT metadata decoding |
| `@xmtp/react-native-sdk` | Decentralized messaging |
| `zustand` | Lightweight state management |
| `expo-router` | File-based navigation |

---

## NFT Verification Details

### Helius DAS API (Recommended)
Uses `getAssetsByOwner` to efficiently scan all NFTs in a wallet and filter by `collection.group_value`. Fast, paginated, handles large wallets.

**Get a free API key:** [helius.dev](https://helius.dev)

### On-Chain Fallback
Without Helius, falls back to `getTokenAccountsByOwner`. This does **not** verify collection membership — only detects NFTs (amount=1, decimals=0). For production, Helius is required.

---

## Messaging Architecture (XMTP)

- All verified holders connect to **the same XMTP conversation** (anchored to a fixed peer address).
- Messages are **E2E encrypted** at the XMTP protocol level.
- **Reactions** are sent as plain messages with the format `REACT:emoji:targetId` and applied client-side.
- **Replies** are encoded as `REPLY:targetId:senderAddr:content`.
- No per-message Solana transactions — messaging is free.

---

## Production Checklist

- [x] `NFT_COLLECTION_ADDRESS` set → `8vN3ke2Q7dbv8hpEsvcbR7jDmPp85sK6qagd77aR73jx`
- [x] `HELIUS_API_KEY` set → Helius mainnet
- [x] Collection name set → Saga Monkes
- [x] App name set → OnlyMonkes
- [ ] Download + bundle fonts
- [ ] Update `APP_IDENTITY` URI to your published app URL
- [ ] Configure splash screen and icon assets
- [ ] Test on physical Android device with Phantom installed
- [ ] Submit to Solana dApp Store: [docs.solanamobile.com](https://docs.solanamobile.com/dapp-publishing/intro)

---

## Extending the App

### Add DM support
Create a new XMTP conversation to the target wallet address:
```ts
const dmConversation = await client.conversations.newConversation(peerAddress);
```

### Add NFT-per-collection chat rooms
Use the collection mint as part of the XMTP conversation topic to segment holders.

### Add push notifications
Integrate with XMTP's push notification service or use a custom backend.

### Add user profiles
Store display names/bios in a Solana on-chain program or off-chain (e.g., Ceramic / Shadow Drive).
