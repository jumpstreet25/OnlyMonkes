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
- **Share to X** — after sending a photo, a popup offers to share on X with auto-caption "I snapped this using @xOnlyMonkes via Solana Mobile, The Future is Monke!" and the watermark baked in
- **Direct Messages** — 1-on-1 encrypted DMs with any Monkes holder; inbox screen with compose modal, searchable user directory, message preview and timestamps; cross-app portable via XMTP (conversations accessible from any XMTP-compatible wallet app)
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
- **In-app Jupiter swaps** — `/buy $TOKEN [SOL]`, `/sell $TOKEN [%]`, `/swap $A for $B` resolve tokens via Jupiter strict list, show a confirmation modal (amounts, price impact, slippage), and execute via MWA biometric sign — all without leaving the app; 3% profit-based fee on sells (no fee if the trade lost money)
- **Trading fee system** — transparent profit-based fees to support development: 2% on NFT sales (deducted from sale price), 3% on token trade profits, 5% on AutonoMonke autonomous trade profits; fees are only charged on gains — no fee if you lose money; cost basis tracked per token via AsyncStorage
- **Fee disclaimer popups** — all fee agreements use unified dark theme (black background, OnlyMonkes blue `#0096C7` text) with "I Understand" / "Decline" buttons; MarketplaceFeeModal (one-time before first listing), SwapConfirmModal (per-swap with fee policy), AutoMonkeDisclaimerModal (before enrollment)
- **Solana Actions / Blinks** — bot trade alerts embed interactive Blink cards in chat; one-tap swap execution via Cloudflare Worker (`onlymonkes-actions.jumpstreet25.workers.dev`); cards show icon, title, amount buttons (0.05 / 0.1 / 0.5 SOL); tapping a button POSTs to the worker which builds a Jupiter v2 swap transaction, client refreshes the blockhash for reliability, then signs and sends via MWA biometric; also supports tip actions; swap capped at 5 SOL, tips at 10 SOL; worker secrets: `HELIUS_API_KEY`, `JUP_API_KEY`
- **In-app tipping** — `/tip @username [amount]` resolves username → wallet from the profile cache, opens a confirmation modal, and sends $SKR via MWA one-tap biometric; Support OnlyMonkes button also tips the dev wallet in-app
- **SOL → SKR swap tips** — users without $SKR can tip using SOL; Jupiter swap + SPL transfer chained in a single `transact()` session (one biometric prompt)

### Community
- **Bot alert channels** — four dedicated read-only feeds for categorized bot alerts: Monke Bets, Monke Trades, Monke Sales, Monke Predictions; each backed by a separate XMTP group configured via remote app config; channel icons in the toolbar below the message bar with white badge bubbles showing blue unread counts (tap to navigate + clear, long-press to clear); mute/unmute button in each channel header; warm cache with 60s TTL for instant re-opens without reload; real-time badge count streaming from background XMTP listeners; branded banner headers per channel (Bets.png, Trade.png, Sales.png, Predictions.png)
- **Sports filter** — per-sport mute toggles in Monke Bets channel; persisted to AsyncStorage and broadcast in PROFILE_UPDATE so the bot filters server-side; client-side filtering hides muted sport alerts in the Bets feed in real time; survives app restarts
- **dApp side chats** — per-dApp community channels (hamburger menu)
- **Community events calendar** — schedule, view, and RSVP to events; OnlyMonkes-tagged events support "Start Live Audio Chat" and "Start Video Call" when time arrives
- **Community badges** — white pill badges with OnlyMonkes blue count on hamburger menu items (DMs, Events, Links); total badge count on hamburger button; auto-clear on view
- **Support banner** — live $SKR token price (DexScreener) and Saga Monkes floor price (Magic Eden) flanking the "Help Support OnlyMonkes" banner; auto-refresh every 60s; floor price is a tappable blue pill that navigates to the in-app Marketplace
- **NFT Marketplace (MonkeMarkets)** — peer-to-peer Saga Monkes trading inside the app; list, bid, accept, delist — all via XMTP protocol messages; dedicated Marketplace screen with branded MonkeMarkets banner header; accessible from menu and from the tappable floor price button in the chat footer
  - **Trait filtering** — horizontally scrollable trait type tabs (Background, Fur, Eyes, Clothes, etc.) with expandable value selection; AND logic across trait types filters listings in real time; "Clear (N)" pill to reset
  - **Trait floor pricing** — when listing an NFT, the top trait's Magic Eden floor price is shown with a one-click "Set price" button for instant pricing; floor data fetched from Magic Eden Attributes API
  - **Guest access** — non-holders can browse MonkeMarkets listings (read-only); bidding and listing require NFT ownership
  - **2% sale fee** — a 2% fee is deducted from the sale price and sent to the dev wallet; injected atomically into the swap transaction (buyer pays listed price, seller receives 98%); fee agreement modal shown once before first listing
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

### Banana Reward System
- **Daily banana rewards** — 7-day streak cycle (5/5/10/10/15/15/50 bananas); streak does NOT reset on missed days, picks up where you left off; animated "GMonke!" claim popup with streak bar, confetti on Day 7, share-to-X prompt
- **Banana Shop** — 4-tier in-app UI customization store with 22+ items; chat bubble glow colors (Tier 1, $1), text/name styles (Tier 2, $2), PFP themes (Tier 3, $3), app-wide themes (Tier 4, $4); payment in $SKR or $SOL via MWA; bananas + crypto required to purchase; one-time permanent ownership; equip one per category
- **Loot Crates** — spend 50 bananas for a random spin; Common 60% (5-15 bananas back), Uncommon 25% (2x earnings 24h), Rare 10% (free Tier 1 item), Epic 4% (free Tier 2), Legendary 1% (exclusive holographic bubble)
- **MonkeClout Leaderboard** — reputation score (0-1000) based on streak length (20%), trade accuracy (30%), chat activity (25%), banana balance (25%); top 3 earn "Alpha Ape" flair; displayed in Community popup
- **Monke of the Week** — Hermes auto-picks top CloutScore user every Monday; featured in Community popup with special frame; bot announces in main chat; shareable to X
- **Activity cNFT Badges** — 13 soulbound compressed NFT achievement badges across 4 categories (Streak, Trading, Social, Special); $4.99 mint fee in $SKR or $SOL via MWA; Bubblegum (Metaplex) minting; displayed on profile
- **Limited Drops / Auctions** — seasonal 48-hour timed auctions for exclusive items; bid bananas + SOL; highest bidder wins
- **AI Dream Mode** — after completing a full 7-day banana cycle, Hermes generates a personalized "trading dream" narrative with mood-based visuals (bullish/chaotic/zen/legendary); shareable to X; mintable as soulbound cNFT
- **Banana push notifications** — streak at risk (20h warning), loot crate ready, leaderboard passed, new auction, Monke of the Week
- **Share-to-X milestones** — auto-prompt to share on X when earning badges, Day 7 bonus, loot wins, leaderboard top 3, Monke of the Week; branded tweets with @xOnlyMonkes + hashtags

### Monke Globe
- **3D interactive globe** — WebView + Three.js with Blue Marble earth texture; finger rotate (OrbitControls), pinch-to-zoom, auto-spin
- **User PFP markers** — Saga Monkes NFT profile pictures rendered as circular sprites on the globe at their chosen location; data URI → canvas → circular clip → CanvasTexture; cached to avoid reloads
- **Solana ecosystem events** — Lu.ma calendar scraping for Solana, Solana Mobile, Solflare, Saga Monkes events; blue markers with beams
- **IRL app events** — community calendar events appear as green markers; auto-removed after event date passes
- **User location** — free-text location field in profile; geocoded via Nominatim (OpenStreetMap); cached in AsyncStorage; broadcast via PROFILE_UPDATE `loc` field
- **Tap markers** — tap user markers to open profile modal; tap events to see date/time/location/Lu.ma link

### UI / Design
- **Dark glassmorphism chat bubbles** — semi-transparent frosted glass with inner gradient (top lighter → bottom darker); OnlyMonkes blue glow radiating behind each bubble (2-layer: glassGlow wrapper + glassBubble); pill-shaped (borderRadius 22)
- **PFP floating effect** — user avatars outside the bubble with diffused Solana purple hue shadow + depth drop shadow
- **Community popup** — centered modal with search bar, grid layout (6 icon buttons: Messages, Events, Links, Marketplace, Tools, Settings), banana streak bar + shop button
- **Onboarding tutorial** — 3-screen overlay for first-time users (Bananas → Globe → Community); awards 25 banana welcome bonus
- **Skeleton loaders** — shimmer placeholders for chat messages, globe, and community popup
- **Badge notification banner** — slides down from top when badge earned; auto-dismisses after 4s; tap to share on X
- **Scroll-to-bottom FAB** — floating arrow button with unread count badge; appears when scrolled up
- **Monke-personality errors** — randomized on-brand error messages ("The blockchain ghosted us", "Transaction failed. Much like my patience.")

### Notifications
- **Push notifications (v8)** — FCM V1 API via service account + Expo push relay with Bearer auth; all channels use MAX importance for heads-up banners (including bot alerts); legacy channels (v1–v7) auto-deleted on startup; foreground heads-up alerts via native DirectNotif module (bypasses Expo groupKey silent interception)
- **Per-user notification prefs** — opt-in categories: All Messages, @Mentions Only, Bot/AI alerts, DM notifications, Live Room start alerts; prefs persisted to AsyncStorage and broadcast in `PROFILE_UPDATE` so the bot filters server-side; muted bot channels and sports filters also persisted and survive app restarts
- **Direct DM push relay** — when a user sends a DM, a push notification is sent directly to the recipient's FCM token (peer-to-peer, no bot required); includes sender NFT avatar in the data payload
- **FCM token fallback** — direct FCM token generation (not Expo relay) for server-side bot push; cached in SecureStore and broadcast with PROFILE_UPDATE
- **Background sync** — `expo-background-fetch` task keeps profile and data fresh when backgrounded
- **Smart notification timing** — learns each user's historically active hours from message timestamps; high-priority alerts push during active hours, medium batch during inactive, low-priority deliver in-app only; batched notifications summarized and flushed when user comes online

### Intelligence & Monitoring
- **Prediction accuracy tracking** — MonkePredictions (Drift) outcomes tracked separately from trade accuracy; per-user win rate feeds into MonkeClout scoring
- **Sports bet accuracy tracking** — MonkeBets outcomes tracked per user and per sport; feeds into CloutScore
- **Community Alpha** — users whose CONFIRM commands precede winning trades get bonus Clout; "Community Alpha" flair for 60%+ WR on 5+ confirms; leaderboard of top alpha callers
- **Alert auto-tuning** — rolling 7-day accuracy tracking per market condition (trending_bull/bear, ranging, volatile); dynamic threshold adjustment based on win rate; posts to MonkeTrades: "🧠 Hermes Confidence Adjustment: raised threshold from 45 → 48 (last 20 signals hit 54% WR)"
- **Token auto-blacklist** — 3 consecutive losses = blacklisted (skipped for signals); auto-whitelisted after 48h or market condition change
- **Daily Saga Monkes holder snapshot** — noon EST daily; fetches holder count via Helius DAS API; witty "Good Afternoon" message + holder count + daily % change (green ↑ / red ↓) + 7-day trend
- **Helius RPC health monitor** — checks every 5 min; auto-switches to public Solana RPC if Helius degraded (>2s latency); switches back when recovered
- **Cloudflare Worker monitor** — pings Actions worker every 15 min; DMs dev if down
- **Globe marker clustering** — 2-3 users at same location: orbital ring (PFPs spread in circle); 4+ users: cluster bubble with count badge → tap for bottom sheet with all PFPs

### Profiles & Wallets
- **User profiles** — tap any username to view their NFT, bio, wallet, and social links
- **Online status** — green dot and "Online" / "Last seen Xm ago" shown in profile modal
- **Tipping** — send SOL tips directly to a user's tip wallet from their profile card
- **Monke Tools** 🔧 — ecosystem links, settings, and notification controls
- **MWA biometric re-auth** — cached wallet adapter auth tokens for silent re-authentication with biometric prompt; no app-switch needed after first connect

### AI Agent & TA Scanner
- **AI Agent #9385 (Monke)** — unified XMTP bot identity with a confident, ball-busting, banana-obsessed persona; powers all features: TA scanning, trade alerts, NFT sales, sports betting, prediction markets, DM commands, and LLM chat; built on ElizaOS v2 with plugin-solana for trade execution; Pyth Hermes SSE streaming for sub-second price feeds
- **Multi-LLM brain chain** — Hermes Agent (Cerebras Qwen-3-235B, persistent per-user sessions) → OpenClaw (local gateway) → Groq direct → Ollama local → Anthropic; each fallback preserves the Monke persona
- **Multi-timeframe TA scanner** — professional-grade scanner covering 100+ Solana SPL tokens (53 watchlist + Birdeye discovery + Hermes Solana Toolkit discoveries) every 10 min across 15m/1H/4H/daily candles; OHLCV from GeckoTerminal → DexPaprika → Birdeye fallback chain; posts confluence alerts to Monke Trades channel when signal score ≥50 (bipolar scale) with medium+ conviction; sentiment gate on ALL alert types (TA, sports, predictions, Drift); whale and chat sentiment gates; low-conviction signals and bad Fib data alerts automatically filtered
- **Hermes Alert Quality Badge** — every TA alert includes a Hermes confidence overlay: "🧠 Hermes: 🟢 72% — similar setups: 8/11 hit T1 in ~3.8h | $NOS: 3W/1L"; scores each signal against historical outcomes by matching confluence bracket + TF alignment + token track record
- **TA candle charts** — every bullish TA alert includes a generated candlestick chart image (with Fibonacci levels, entry/stop/targets overlaid, EMA12/26, Bollinger Bands, volume bars) sent to the Monke Trades channel
- **AutonoMonke** — autonomous trading engine with 12-step gate: disclaimer → wallet → TA score ≥50 → 2+ aligned TFs → RSI guard → bearish factor gate → 4h cooldown → max positions (3) → max exposure (20%) → position sizing (2%) → OpenClaw AI confidence ≥60% → Jupiter execution; stop loss clamped 5-12%; Fibonacci targets validated against entry price
- **Slash commands** — `/tip @Username [amt]` (send $SKR), `/buy $TOKEN`, `/sell $TOKEN`, `/swap $A for $B` — all execute in-app via MWA biometric sign + Jupiter aggregator
- **DM slash commands** — DM the bot for 40+ commands: `/automonke`, `/risk`, `/predictions`, `/bets`, `/price`, `/ta`, `/buy`, `/portfolio`, `/hermes`, `/backtest`
- **Color-coded risk alerts** — 🟢 Low Risk, 🟡 Medium, 🔴 High Risk dots on all TA alerts; compact confluence tags (RSI + MACD Cross + BB Squeeze); inline chart links (DEXScreener, Birdeye, Jupiter); Solana Actions Blink cards for one-tap execution
- **Per-user TA risk settings** — DM the bot `/risk` to set position size, stop-loss %, conviction threshold, blacklist, mute, and more
- **Backtesting** — DM `/backtest $TOKEN [days]` for historical signal replay with win/loss stats, Sharpe ratio, max drawdown
- **Portfolio Copilot** — DM `/portfolio` for open positions, closed P&L, Sharpe ratio, and Hermes-powered analysis: personal win rate vs community, best/worst tokens, actionable suggestions

### Hermes Intelligence Layer
- **Per-user encrypted memory** — AES-256-GCM encrypted trading history per user (buys, sells, PNL, config changes, streaks); max 200 entries; decrypted only for the requesting user
- **Global learning engine** — aggregates all users' outcomes: win rate, avg PNL, best confluence ranges, best TF alignment, best/worst tokens, avg win duration; recalculates after every outcome
- **Alert Outcome Monitor** — every 10 min, checks current prices against all open alerts; auto-closes when T1, T2, or stop is hit; expires after 48h; feeds outcomes into the learning engine automatically — no paper trading needed
- **Personalized DM warnings** — when an alert fires for a token a user has a poor track record on (3+ trades, <40% WR), they get a DM warning before the alert
- **Auto-Tuning** — weekly (Sunday 6am) Hermes analyzes win rate by score bracket and recommends threshold adjustments; posts report to Trades channel
- **Weekly Digest** — Hermes posts what it learned: token performance, accuracy trend, best/worst setups
- **Bot Self-Awareness** — LLM system prompt includes Hermes learning data so the bot explicitly cites its own track record when users ask about trades
- **Social Signals** — alerts show "🐒 4 Monkes bought $NOS in the last 2h" (anonymized cross-user crowd wisdom)
- **Streaks & Achievements** — Hot Streak (3 wins), Sharpshooter (5), Monke Legend (7), Diamond Hands (10), AI Monke, Meme Lord
- **`/hermes` DM command** — users query their own memory: `/hermes stats`, `/hermes best`, `/hermes worst`, `/hermes history`, `/hermes achievements`
- **Hermes Solana Toolkit** — OpenClaw extension with `solana_trending` (discover trending SPL tokens) and `solana_token_chart` (OHLCV + EMA + RSI + Fib for any token); discoveries auto-feed into the bot's scanner universe

### MonkePredictions (Drift BET)
- **Autonomous prediction markets** — AI-powered prediction market engine on Drift Protocol (Solana); scans active BET markets with full TA analysis (MACD, RSI, EMA, Ichimoku, Bollinger, Fibonacci, candlestick patterns); fires alerts to Monke Predictions channel when signal score ≥65/100
- **DM commands** — `/predictions start` to enroll (separate risk disclaimer), `/predictions stop|resume` to pause/resume, `/predictions confidence <50-100>` to set AI confidence threshold, `/predictions size <1-500>` max USDC per position, `/predictions max <1-10>` max concurrent positions, `/predictions positions` to view open, `/predictions history` for closed P&L, `/predictions markets` to browse active Drift BET markets, `/predictions withdraw` to close all, `/predictions delete` to full opt-out
- **9-gate decision engine** — disclaimer check → wallet check → drawdown halt ($50 max) → TA score gate (65) → cooldown (4hr) → max positions → already-in-market → position sizing → OpenClaw AI confidence; every gate must pass before any autonomous trade executes
- **Position management** — real-time position monitoring with stop-loss enforcement, Fibonacci target notifications (T1 alert, T2 auto-close), persistent position tracking across bot restarts
- **Drift Protocol** — BET markets are PerpMarkets with ContractType.PREDICTION; LONG = YES, SHORT = NO; price 0-1 represents probability; collateral is USDC; all on Solana mainnet
- **Reuses AutonoMonke wallet** — same encrypted hot wallet; no separate wallet setup needed
- **5% profit fee** — fee only on winning predictions; no fee on losses

### MonkeBets (Monaco Protocol)
- **Autonomous sports betting** — AI-powered sports betting engine on Monaco Protocol (Solana); value edge detection via SharpAPI + OddsAPI fed through TA analysis; fires alerts to Monke Bets channel with Monaco market links
- **DM commands** — `/bets start` to enroll (separate risk disclaimer), `/bets stop|resume` to pause/resume, `/bets edge <3-25>` to set minimum value edge %, `/bets confidence <50-100>` for AI confidence threshold, `/bets size <1-200>` max USDT per bet, `/bets max <1-20>` max concurrent bets, `/bets sports NBA,NFL,MLB` to filter by sport (or `all`), `/bets positions` to view open bets, `/bets history` for closed P&L, `/bets markets` to browse active Monaco markets, `/bets cancel` to cancel all open + pause, `/bets delete` to full opt-out
- **9-gate decision engine** — enrolled/active → wallet check → drawdown halt ($50) → edge threshold → sport filter → cooldown → max open bets → already-bet-on-game → stake sizing → OpenClaw AI confidence
- **Edge-based sizing** — bets placed only when algorithmic value edge exceeds user-configured threshold (default 7%); BACK (bet FOR) and LAY (bet AGAINST) support
- **Monaco Protocol** — exchange-style sports betting on Solana; orders placed on-chain via `createOrderUiStake()`; collateral is USDT; supports NFL, NBA, MLB, NHL, EPL, UCL, UFC, NCAAF, NCAAB
- **Reuses AutonoMonke wallet** — same encrypted hot wallet
- **5% profit fee** — fee only on winning bets; no fee on losses
- **Combined TA** — sports alerts cross-reference both SharpAPI edge detection and TA scoring for higher-confidence signals
- **NFT sale images** — Saga Monkes sales alerts include the actual NFT artwork fetched via Helius DAS API, displayed in the MonkeSales channel and as a big-picture push notification
- **Unified push notifications** — all bot alerts (TA signals, NFT sales, sports bets, predictions, GMonke, PNL reports) route through a single FCM v1 + Expo push pipeline with user preference filtering, per-channel muting, stale token pruning, and big-picture image support
- **NFT ownership gate** — AI Agent #9385 verifies Saga Monke NFT ownership via Helius DAS before processing any DM command; cached 24 hours per user, checked lazily on first interaction; users who sold their Monke get troll responses instead of bot services; fail-open on API errors to avoid false lockouts
- **Cross-app inbox portability** — XMTP is a decentralized protocol: your inbox is tied to your wallet identity, not to any specific app. Users can DM the bot from any XMTP-compatible app (Converse, Coinbase Wallet, etc.) and the same NFT gate applies — the verification happens bot-side, so selling your Saga Monke blocks access everywhere, not just in OnlyMonkes
- **LLM chain** — OpenClaw (local, persistent memory) → Ollama → Anthropic; all app users can DM the bot for free AI chat
- **Support OnlyMonkes button** — in the Tools drawer; quick-tip 5/10/25/50 $SKR to the dev wallet via in-app MWA biometric (no app switch)
- **Per-type push titles** — 🐒 MONKE #1234 Sold! / 🐒 TA Signal: $TOKEN / 🔮 Prediction Alert per alert type
- **Rich push images** — TA trade alerts include the candlestick chart as a big-picture notification; NFT sales include the Monke artwork

### Reliability & Hardening (31-point audit, 2026-03-28)
- **XMTP sync timeouts** — 15s timeout on all group.sync() calls prevents app freeze on poor network
- **Stream error boundaries** — top-level try-catch on all XMTP stream callbacks prevents one bad message from killing the stream
- **Stream reconnect backoff** — exponential 5s→60s (was fixed 5s), shared resync gate, max 20 attempts per stream
- **Own messages cached** — sent messages now persisted to AsyncStorage immediately; survives force close
- **Typing timeout cap** — Map capped at 100 entries with LRU eviction; prevents memory leak in long sessions
- **Message store cap** — reduced 500→300 for 8GB devices
- **Reaction cap** — 50 reactors per emoji per message; prevents O(n²) rendering
- **Profile cache LRU** — evicts least-recently-accessed profiles instead of oldest-written
- **Profile broadcast debounce** — 500ms coalesce prevents simultaneous calls from racing
- **Blink fetch rate limit** — max 2 concurrent metadata requests; overflow queued
- **Jupiter token list timeout** — 8s AbortSignal + response validation
- **Notification error logging** — all silent catches replaced with console.warn
- **Marketplace payload validation** — required fields checked on all NFT_LIST/BID/ACCEPT/DELIST messages
- **SKR tip pre-flight** — checks sender balance before opening MWA; "Insufficient SKR" thrown early
- **@mention sanitization** — strips non-printable Unicode before username lookup
- **Bot inbox from remote config** — reads `config.botInboxId`, falls back to hardcoded
- **Glassmorphism modals** — all 13+ popups use shared GlassModal with BlurView backdrop

### Infrastructure & Quality
- **EAS Update (OTA)** — over-the-air updates via `expo-updates`; silent download on launch, prompt to restart; avoids full dApp Store resubmission for minor fixes
- **cNFT Badges** — compressed NFT badges minted via Helius Mint API for community milestones (first message, 100 messages, 50 reactions, 7-day streak, 30-day streak, leaderboard win, and more); 9 badge types with automatic progress tracking; badges appear as on-chain cNFTs in the user's wallet
- **TipLink** — claimable SOL links in chat; `/tiplink <amount>` generates an ephemeral Solana keypair, funds it via MWA, and sends a green-themed claim link in chat; recipients tap to sweep SOL to their wallet
- **File sharing** — native XMTP RemoteAttachment support; share files from the camera action sheet via `expo-document-picker`; files uploaded to Cloudinary and rendered as tappable attachment bubbles in chat
- **Pyth Hermes price streaming** — sub-second Solana token prices via Pyth Network SSE streaming (16 major tokens); used as primary price source in the TA scanner with Jupiter API fallback
- **Unit tests** — Jest with `react-native` preset; tests for appStore (8 tests), chatStore (7 tests), badges (13 tests), and tipLink parsing (5 tests); `npm test` / `npm run test:coverage`
- **E2E tests** — Detox config for end-to-end testing (requires bare workflow build); suites for media sharing and slash commands
- **Crash reporting** — Sentry integration (`@sentry/react-native`) with PII scrubbing; captures errors, breadcrumbs, and user identification
- **Analytics** — Firebase Analytics (`@react-native-firebase/analytics`); tracks app opens, messages sent, DMs opened, tips sent, swaps executed, daily sessions, chat duration, user properties
- **Self-hosted LiveKit** — Docker Compose config for self-hosted LiveKit SFU on VPS; embedded TURN for NAT traversal; ~$6-10/mo on Hetzner CX22 (2 vCPU, 4GB RAM); handles 5-10 concurrent rooms with simulcast
- **LightRAG** — Local Docker knowledge graph memory for Hermes bot; port 9621 (localhost only); Groq llama-3.3-70b-versatile LLM + OpenAI text-embedding-3-small; ingests TA alerts, outcomes, chat, NFT sales, bets, predictions; enriches DM commands and LLM context via 3s-timeout RAG queries

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
| Token Swaps | Jupiter v2 `/build` API (fee-free instructions) via MWA `VersionedTransaction` |
| Solana Actions | Cloudflare Worker serving Blinks (interactive swap/tip cards in chat) |
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
| Prediction Markets | Drift Protocol (`@drift-labs/sdk`) — BET PerpMarkets on Solana |
| Sports Betting | Monaco Protocol (`@monaco-protocol/client`) — exchange-style on-chain bets |
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
│   │   ├── BlinkCard.tsx             # Solana Actions card: fetches metadata, renders interactive swap/tip buttons, signs via MWA
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
│   │   ├── MarketplaceFeeModal.tsx    # One-time fee agreement for MonkeMarkets (2% sale fee)
│   │   ├── SwapConfirmModal.tsx      # Jupiter swap confirmation (amounts, price impact, slippage, fee policy)
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
│   │   ├── badges.ts                # cNFT badge system: 9 badge types, progress tracking, Helius Mint API minting
│   │   ├── tipLink.ts               # Claimable SOL links: ephemeral keypair, MWA funding, claim URL generation
│   │   ├── analytics.ts              # Firebase Analytics: app open, messages, DMs, tips, swaps, session duration
│   │   ├── backgroundSync.ts         # expo-background-fetch task registration
│   │   ├── calendar.ts               # Event helpers
│   │   ├── constants.ts              # COLORS, fonts, collection config, fee constants
│   │   ├── costBasis.ts             # Per-token SOL cost basis tracker (AsyncStorage, profit-based fees)
│   │   ├── giphy.ts                  # GIPHY search + sticker API wrapper
│   │   ├── linkPreview.ts            # OpenGraph metadata fetching (16KB head-only, in-memory cache, 5s timeout)
│   │   ├── liveAudio.ts              # LiveKit Room singleton — audio rooms, persists across navigation
│   │   ├── liveVideo.ts              # LiveKit Room singleton — video calls with simulcast, data channel reactions
│   │   ├── livekit.ts                # LiveKit JWT generation (HS256, client-side); room helpers
│   │   ├── marketplace.ts            # P2P NFT marketplace: list, bid, accept, delist via XMTP protocol
│   │   ├── nftSwap.ts               # Atomic NFT swap: build + validate swap tx with 2% fee injection
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
│   │   ├── blinkActions.ts            # Solana Actions / Blinks client: URL detection, metadata fetch, POST execute
│   │   ├── jupiterSwap.ts            # Jupiter v2 swap: token resolution, /build instructions, MWA execution, profit-based fees
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
│   │   ├── chatStore.test.ts         # 7 unit tests for chatStore
│   │   ├── badges.test.ts           # 13 unit tests for badge system
│   │   └── tipLink.test.ts          # 5 unit tests for TipLink parsing
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
│   ├── docker-compose.lightrag.yml   # LightRAG knowledge graph (local Docker, port 9621)
│   ├── .env.lightrag.example         # LightRAG env template (Groq LLM + OpenAI embeddings)
│   ├── start-lightrag.sh             # Launch script for LightRAG container
│   └── livekit.yaml                  # LiveKit server config (TURN, simulcast, room defaults)
│
├── worker-actions/
│   ├── src/index.ts                  # Cloudflare Worker — Solana Actions server (swap + tip endpoints via Jupiter v2 /build)
│   └── src/lightrag-pipeline.ts      # LightRAG ingestion + query pipeline (canonical module)
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
| `TIPLINK:` | `TIPLINK:<claimUrl>\|<amountSol>\|<senderUsername>` | Claimable SOL tip link |
| `ATTACHMENT:` | `ATTACHMENT:<url>\|<filename>` | File attachment (RemoteAttachment codec) |
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

## Solana Actions / Blinks Flow

```
Bot sends trade alert with Action URL
        │
        ▼
MessageBubble detects Action URL → renders <BlinkCard>
        │
        ▼
BlinkCard GETs metadata from worker → shows icon, title, amount buttons
        │
        ▼
User taps "Buy TOKEN (0.1 SOL)"
        │
        ▼
BlinkCard POSTs {account: wallet} to worker
        │
        ▼
Worker: Jupiter v2 /build → assemble VersionedTransaction → return base64
        │
        ▼
Client: deserialize → fetch fresh blockhash → decompile → recompile with fresh blockhash
        │
        ▼
MWA transact(): authorize → signAndSendTransactions(freshTx)
        │
        ▼
✓ Transaction sent → "confirmed" state shown on card
```

Worker: `https://onlymonkes-actions.jumpstreet25.workers.dev`
Source: `worker-actions/src/index.ts`
Deploy: `cd worker-actions && npx wrangler deploy`
Secrets: `wrangler secret put HELIUS_API_KEY` / `wrangler secret put JUP_API_KEY`

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

## Security

### App Security
- **E2E encryption** — all messages encrypted via XMTP MLS v5 protocol; no central server can read message content
- **Secure credential storage** — wallet sessions and XMTP identity stored in `expo-secure-store` (Android Keystore-backed encryption); never in AsyncStorage or plaintext
- **NFT ownership gate** — both app-side (wallet connect) and bot-side (Helius DAS API) verification; non-holders cannot access chat, DMs, or bot services
- **MWA biometric auth** — all on-chain transactions (swaps, tips, NFT trades) require biometric confirmation via Mobile Wallet Adapter; no transaction executes without explicit user approval
- **No secrets in code** — all API keys, service accounts, and credentials loaded from `.env` via `app.config.ts`; none committed to git
- **PII scrubbing** — Sentry crash reports strip wallet addresses, inbox IDs, and push tokens before upload

### Bot Security (Monke_Eliza)
- **Encrypted wallet vault** — AutonoMonke hot wallets encrypted with AES-256-GCM; private keys never stored in plaintext or logged
- **12-step gate system** — autonomous trades require: disclaimer acceptance → wallet check → NFT ownership → drawdown halt → TA score → cooldown → position limits → dedup → sizing → AI confidence → execution → notification; every gate is a hard stop
- **Drawdown halt** — automatic $50 max cumulative loss halt across AutonoMonke, MonkePredictions, and MonkeBets; cannot be bypassed
- **OpenClaw AI confidence** — every autonomous trade/bet passes through an AI confidence check; low-confidence signals are rejected even if TA score passes
- **Per-user isolation** — each user has independent state, risk settings, position tracking, and drawdown counters; no cross-user data leakage
- **NFT DM gate** — bot verifies Saga Monke ownership before processing any DM command that touches funds; cached 24hr, fail-open on API errors
- **Separate disclaimers** — AutonoMonke (trading), MonkePredictions (Drift BET), and MonkeBets (Monaco Protocol) each require independent opt-in with explicit risk acknowledgment
- **No eval / no injection** — all user input sanitized; no `eval()`, `Function()`, template literals from user input, or dynamic code execution
- **Position file safety** — `.json` state files contain only public keys and trade metadata; never private keys or secrets

### Infrastructure Security
- **HTTPS everywhere** — all API calls (Helius, Jupiter, Birdeye, GIPHY, Cloudinary, SharpAPI, OddsAPI) over TLS
- **LiveKit encryption** — DTLS for signaling, SRTP for media; embedded TURN for NAT traversal
- **FCM V1 auth** — push notifications sent via service account with scoped OAuth2 tokens; no legacy server keys
- **Dependency auditing** — `npm audit` run before releases; critical vulnerabilities must be resolved before shipping

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
HELIUS_API_KEY=<YOUR_KEY_HERE>               # helius.dev
GIPHY_API_KEY=<YOUR_KEY_HERE>               # developers.giphy.com
CLOUDINARY_CLOUD_NAME=<YOUR_KEY_HERE>       # cloudinary.com
CLOUDINARY_UPLOAD_PRESET=<YOUR_KEY_HERE>    # unsigned upload preset

LIVEKIT_URL=wss://<YOUR_PROJECT>.livekit.cloud
LIVEKIT_API_KEY=<YOUR_KEY_HERE>             # livekit.io cloud dashboard
LIVEKIT_API_SECRET=<YOUR_KEY_HERE>

JUP_API_KEY=<YOUR_KEY_HERE>                # portal.jup.ag
SKR_MINT=SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3
DEV_WALLET=7tLrnPvgcR5mLtyUcVwvmhAD1wXbAKgWcLBPWxpwyZ1J

SENTRY_DSN=<YOUR_KEY_HERE>                  # sentry.io
```

These are injected via `app.config.ts` → `Constants.expoConfig.extra`.

### 4. Self-Hosted LiveKit (Optional)

For self-hosted video/audio infrastructure:

```bash
cd infra
docker-compose -f docker-compose.livekit.yml up -d
```

Requires a VPS with public IP, ports 7880 (WS), 7881 (TCP), 3478/5349 (TURN), 50000-60000/UDP (RTC). Cost: ~$6-10/mo on Hetzner CX22.

### 5. Start LightRAG (local knowledge graph)

```bash
cp infra/.env.lightrag.example infra/.env.lightrag
# Add your API keys to infra/.env.lightrag
npm run lightrag:start
# First time only — seed with historical data:
npm run lightrag:backfill
```

### 6. Run on Android

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
| **NFT Verification** | Helius DAS API (`getAssetsByOwner`) — app-side join gate + bot-side DM gate |

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
| `expo-document-picker` | File selection for chat attachments |
| `bs58` | Base58 encoding for Solana keypairs (TipLink claim URLs) |
| `@drift-labs/sdk` | Drift Protocol prediction market integration (bot-side) |
| `@monaco-protocol/client` | Monaco Protocol sports betting integration (bot-side) |
| `@coral-xyz/anchor` | Anchor framework for Monaco Protocol on-chain interactions |
