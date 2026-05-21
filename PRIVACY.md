# OnlyMonkes Privacy Policy

**Last updated:** April 28, 2026 (v2.37)

> The canonical, always-up-to-date version of this Privacy Policy is hosted at
> **https://onlymonkes-actions.jumpstreet25.workers.dev/privacy** and is linked
> from the in-app Settings → Legal section. This file is a Markdown mirror for
> repository-level transparency. If the two ever diverge, the hosted version
> controls.

## Overview

OnlyMonkes is an NFT-gated social application for verified Saga Monkes holders on Solana Mobile. We are committed to protecting your privacy and being transparent about the data we handle.

## Data We Collect

### Wallet Address
- Your Solana wallet public address is used solely to verify Saga Monkes NFT ownership via the Helius DAS API.
- Your wallet address is **never** stored on our servers.

### Messages
- All messages are end-to-end encrypted using the XMTP v5 MLS protocol.
- Messages are stored on the XMTP decentralized network — we cannot read, access, or decrypt your messages.
- Message content is cached locally on your device for performance.

### Push Notifications
- An Expo push token or FCM token is stored in your XMTP profile to enable push notifications.
- This token is used only to deliver notifications about new messages, mentions, reactions, live rooms, and community activity.
- You can disable notifications at any time in your device settings or within the app.

### NFT Metadata
- Your selected Saga Monkes NFT image and metadata are cached locally on your device.
- This data is fetched from public on-chain sources (Helius DAS API, IPFS) and is publicly available on the Solana blockchain.

### Photos and Videos
- Photos and videos you choose to share in chat are uploaded to Cloudinary for delivery to other users.
- Media is uploaded only when you explicitly choose to send it.
- We do not access or analyze the content of your media.

### Username and Profile
- Your chosen username, bio, location, and linked social accounts (e.g., X/Twitter handle) are broadcast to other users via the XMTP protocol.
- This information is not stored on any centralized server.

### In-App Token Swap Cost Basis (device-local)
- If you use the in-app token swap UI, your per-token cost basis (amount of SOL spent per token) is stored locally on your device via AsyncStorage. This data is used solely to calculate the 3%-on-realized-gains fee and is never transmitted off-device.
- Your acceptance of fee agreements (MonkeMarkets, token trades, AutonoMonke) is stored locally on your device so you are not prompted repeatedly.

### Banana Shop and Bananas Balance (device-local)
- Your bananas balance, daily reward streak, and Banana Shop cosmetic purchases are stored locally on your device via AsyncStorage, scoped to your wallet address (so different wallets on the same device don't overwrite each other).
- This data is **not** automatically synchronized across devices. The "Restore from previous device" flow in Settings allows you to manually copy banana state from one device to another by signing with your wallet to prove ownership.
- Server-side wallet-keyed banana sync is on the v2.38 roadmap.

### AutonoMonke Vault, Trading History, and Bot DM State (encrypted backend)
If you opt in to AutonoMonke or interact with bot DM commands, the following data is stored on a backend service operated by OnlyMonkes ("Hermes Memory"), encrypted with AES-256-GCM at rest:
- Your AutonoMonke hot wallet keypair (encrypted)
- AutonoMonke vault state (deposit balance, open positions, risk configuration, enrollment status)
- Per-user trading memory (alerts received, alert outcomes, win-rate, position history)
- Cost basis for bot-executed trades (separate from the device-local cost basis used by the in-app swap UI)

- **Per-wallet isolation.** Each user's encrypted data is keyed on a per-wallet salt derived from your wallet address. Even if backend storage were compromised, one user's data cannot be decrypted with another user's key derivation path.
- **Operator-encrypted, not end-to-end.** The bot operator can decrypt your data when actively managing your vault or processing your trade commands. This is necessary for AutonoMonke to function. We do not access your data outside of providing the service.
- **Multi-device support.** Your wallet address is the durable identity — multiple devices (XMTP inbox IDs) may bind to the same wallet, and switching devices preserves your data.
- **Retention.** Active trading data is retained while your vault is active and for 30 days after vault closure or last activity, then archived to anonymized aggregates and per-user records purged.
- **Encrypted backups.** Per-user encrypted state is backed up nightly with a separate backup encryption key (split-key disaster recovery), retained 30 days, dual-destination (local + external drive), then rotated out.
- **Per-user purge on request.** You may request purge of your per-user data by emailing Jumpstreet25@icloud.com from the address associated with your account, signed with the wallet.

### Crash Reporting (Optional)
- The App may send anonymized crash reports to Sentry to help us diagnose and fix bugs. Reports do not include private keys, message content, or wallet addresses.

## Data We Do NOT Collect
- **Private keys of your main connected wallet** — we never have access. All transaction signing happens in your wallet app (Phantom, Solflare, etc.) via Mobile Wallet Adapter. The AutonoMonke vault keypair is a *separate* hot wallet that the bot generates and encrypts on your behalf when you opt in to autonomous trading.
- Personal identification information (legal name, email address, phone number)
- Precise device location (only approximate region if you opt in to share it on the Globe feature)
- Device identifiers beyond the push notification token
- Browsing history or behavioral analytics

## Data Storage Summary
- **XMTP messages, profile broadcasts, reactions:** stored on the decentralized XMTP MLS network. Cached locally on your device for performance. Not on OnlyMonkes servers.
- **Session credentials, MWA auth tokens:** device's secure storage (SecureStore).
- **In-app cost basis, fee acceptance flags, bananas balance, Banana Shop purchases, login streak:** device-local AsyncStorage, scoped to your wallet address.
- **NFT image cache, profile cache:** device-local.
- **AutonoMonke vault, bot trading history, per-user trading memory, cost basis for bot-executed trades:** encrypted backend (Hermes Memory) operated by OnlyMonkes — AES-256-GCM at rest, per-wallet salted.
- **Encrypted nightly backups:** separate backup key, 30-day retention, dual-destination (local + external drive).

## Data Sharing
We do not sell, rent, or share your personal data with any third parties. The only data shared externally is:
- Your public wallet address, sent to Helius for NFT ownership verification.
- Push notification tokens, sent to Expo/Google for notification delivery.
- Media files you choose to share, uploaded to Cloudinary for delivery.
- Anonymized crash reports, sent to Sentry (if not disabled).

## Third-Party Services
- **XMTP** — Decentralized messaging protocol. https://xmtp.org/privacy
- **Helius** — NFT verification via DAS API. https://helius.dev/privacy
- **Cloudinary** — Media hosting for in-chat photos and videos. https://cloudinary.com/privacy
- **LiveKit** — Live audio, video, and avatar room infrastructure. https://livekit.io/privacy
- **Jupiter** — Token swap aggregator and prediction order routing. https://docs.jup.ag/legal/privacy-policy
- **Expo** — Push notification delivery. https://expo.dev/privacy
- **Sentry** — Crash reporting. https://sentry.io/privacy/

## Children's Privacy
OnlyMonkes is not intended for use by anyone under the age of 18. We do not knowingly collect data from minors. If we become aware that we have collected data from a person under 18, we will take steps to delete that data.

## Your Rights
Because OnlyMonkes does not store user data on centralized servers, most data control is in your hands directly:
- **Access & deletion** — uninstalling the App removes locally stored data. Messages on the XMTP network are subject to XMTP's own retention.
- **Profile visibility** — update or clear your profile (username, bio, social handles) at any time from the in-app settings.
- **Notifications** — disable per-channel or globally from the in-app menu drawer or device settings.
- **Crash reports** — disable Sentry from the in-app settings.

## International Users
The App is operated from the United States. By using the App, users outside the United States acknowledge that their information may be processed in the United States and other locations where our service providers operate.

## Changes to This Policy
We may update this Privacy Policy from time to time. Any changes will be reflected on this page with an updated revision date. Continued use of the App after changes constitutes acceptance of the revised policy.

## Contact

For privacy questions or concerns, contact us at **Jumpstreet25@icloud.com** or open an issue at https://github.com/jumpstreet25/OnlyMonkes/issues.

Please also review our [Terms of Use & End User License Agreement](https://onlymonkes-actions.jumpstreet25.workers.dev/terms) and [Copyright & DMCA Notice](https://onlymonkes-actions.jumpstreet25.workers.dev/copyright).
