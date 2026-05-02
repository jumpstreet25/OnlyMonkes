# OnlyMonkes Security Audit — 2026-05-02

Read-only audit covering the OnlyMonkes app (`/Users/davidmartin/AndroidStudioProjects/OnlyMonkes`), the Monke_Eliza trader bot (`/Users/davidmartin/Monke_Eliza/agents/monke-trader`), and the Cloudflare Actions worker (`worker-actions/`). Scope and checklist follow the project's `CLAUDE.md` mandatory pre-commit security rules. No code modifications were made.

---

## Section 1 — Summary

- **No hardcoded API/private/wallet keys found in any source file.** All secrets (Helius, Giphy, Cloudinary, LiveKit, Sentry, Jupiter, OpenAI/Anthropic-class keys, ESCROW_ENCRYPT_KEY, BOT_HTTP_SECRET, XMTP bot key) load from `process.env` / `Constants.expoConfig.extra` / `wrangler secret`. `.env`, `*-firebase-adminsdk-*.json`, and `*.keystore` are correctly gitignored.
- **Free-RASP gate (`assertDeviceTrusted`) is wired into every value-transfer signing path** in the app — `executeSwap`, `sendShopPayment`, `sendSkrTip`, `sendDevTip`, `sendSolTipAsSkr`, `sellerSignSwap`, `buyerCompleteSwap`, `BlinkCard.handleAction`, `createTipLink`, and `mintPurchaseReceipt`. No bypass surface located.
- **XMTP spoof guards on `TRADE_OPENED:` / `TRADE_CLOSED:` are correct** — both check `BOT_INBOX_IDS` membership before parsing payload (`useXmtp.ts:1611,1638`). All 22 system-prefix strings are filtered in `decodeMessage()` so they never render as chat content.
- **One critical npm dependency vulnerability** (`protobufjs <7.5.5`, GHSA-xq3m-2v4x-88gg, CVSS 9.8 arbitrary code execution) plus 11 high (most notably `undici` ReDoS/smuggling, `@xmldom/xmldom` injection, `bigint-buffer` overflow, `picomatch`/`minimatch`/`d3-color` ReDoS) — all pulled transitively through `@solana/web3.js`, `@expo/cli` toolchain, and `react-native-wagmi-charts`. Triage required.
- **AutonoMonke wallet vault uses AES-256-GCM with PBKDF2-SHA512** (no custom crypto), `secretKey.fill(0)` after every signing operation, and trades require a YES/NO DM confirmation with a 30s window. Position files contain only public-key + trade metadata (HMAC integrity verified in `.automonke_positions.json`).

---

## Section 2 — Critical / High issues

### CRITICAL-1 — `protobufjs` arbitrary code execution (CVE GHSA-xq3m-2v4x-88gg, CVSS 9.8)

- **Where**: transitively required by `@solana/web3.js` and the Expo toolchain (`node_modules/protobufjs <7.5.5`).
- **What's wrong**: pre-7.5.5 versions allow arbitrary code execution when parsing untrusted protobuf input. The app does not parse arbitrary protobufs from the network, but `@solana/web3.js` uses it for some JSON-RPC paths. Exploitability is bounded by Solana RPC endpoint trust (we only call `mainnet.helius-rpc.com`).
- **Fix**: bump `@solana/web3.js` to a version that pulls `protobufjs >=7.5.5`, or pin via `package.json` `overrides` / `resolutions`. Re-run `npm audit` to confirm 0 critical.

### HIGH-1 — `undici` (multiple, including unbounded WebSocket decompression and request smuggling)

- **Where**: transitive dep, ranges `<6.24.0`. Used by Node fetch in any tooling that pulls it.
- **What's wrong**: WebSocket permessage-deflate unbounded memory consumption (CVSS 7.5), CRLF injection in `upgrade`, request smuggling. Mostly server-side risk; the app does not execute Node `undici` at runtime, so the attack surface is the dev/build toolchain. Bot (`Monke_Eliza`) uses `node-fetch`/`undici` directly — verify on bot side.
- **Fix**: add `"undici": ">=6.24.0"` to `overrides` in both `package.json` files; re-audit.

### HIGH-2 — Keystore password embedded in source code as a comment

- **Where**: `src/lib/security.ts:79-80, 114`
- **What's wrong**: the comment on line 79 reads `keytool -list -v -keystore android/app/onlymonkes-release.keystore -storepass <REDACTED-PASSWORD>` and the same `<REDACTED-PASSWORD>` is repeated in the runtime warning message on line 114. The release keystore itself is gitignored (correctly), but the password to it is committed in plaintext in a TS file that ships in OTA bundles. Anyone with the keystore file plus the public source can sign a malicious APK with the same cert hash, defeating Free-RASP `appIntegrity` / cert-pin.
- **Fix**: remove the literal password from both the docstring and the warning string. Move the rotation instructions to a private operator-runbook outside the repo. Optionally rotate the keystore password (file at `android/app/onlymonkes-release.keystore` plus `gradle.properties` credential storage).

### HIGH-3 — Tracked Firebase `google-services.json` with embedded API key

- **Where**: `android/app/google-services.json` (tracked in git, despite `.gitignore` listing `google-services.json` — the trailing-comment line `google-services.json# Firebase config` near the bottom of `.gitignore` does not actually re-ignore the file because it was added in an earlier commit before the rule existed).
- **What's wrong**: file is in the working tree and committed at `android/app/google-services.json` containing `api_key.current_key = "AIzaSyCONY64M4cW27TTAvaUtaJoo_sDTecTgzo"` (Firebase Android SDK key). Firebase Android SDK keys are scoped by SHA-1 of signing cert + package name, so direct key abuse is constrained, but the key still exposes the project to quota abuse and to any Firebase services that don't enforce App Check. Push notifications (FCM) in particular accept this key for sender-token validation only, but a leaked key plus a rooted device can sometimes spoof.
- **Fix**:
  1. Confirm App Check / SHA-1 restrictions are enforced in Firebase console for every API surface (FCM, Storage, Auth, Realtime DB).
  2. `git rm --cached android/app/google-services.json` and rely on the gitignore rule (the rule already exists at `.gitignore:42`).
  3. Optionally rotate the Firebase API key.

### HIGH-4 — Tracked `android/app/debug.keystore`

- **Where**: `android/app/debug.keystore` (committed, 2257 bytes, last modified 2026-04-19).
- **What's wrong**: debug keystores are non-sensitive by convention (Android-default password `android`), but committing one means every fork / clone has the same debug-signing identity, which is occasionally relevant for Free-RASP tuning. Low practical risk.
- **Fix**: optional `git rm --cached android/app/debug.keystore`. Acceptable to leave if intentional for CI reproducibility.

### HIGH-5 — `wrangler.toml` does not declare KV namespace bindings used at runtime

- **Where**: `worker-actions/wrangler.toml` only contains commented-out KV namespace examples; runtime code at `src/index.ts:57-58` requires `TIP_ESCROW: KVNamespace; FRAME_ALERTS: KVNamespace`. KV writes/reads at lines 810/821/826/847/853 will throw at runtime if not bound.
- **What's wrong**: not a vulnerability per se, but an availability risk — a fresh deploy from this `wrangler.toml` would fail. Likely the production deployment has bindings configured directly in the Cloudflare dashboard, but the file does not document them.
- **Fix**: add the KV namespace bindings to `wrangler.toml` so deploys are reproducible and reviewable in code:
  ```toml
  [[kv_namespaces]]
  binding = "TIP_ESCROW"
  id = "<actual-kv-id>"

  [[kv_namespaces]]
  binding = "FRAME_ALERTS"
  id = "<actual-kv-id>"
  ```

---

## Section 3 — Medium / Low issues

### MED-1 — `react-native-wagmi-charts` → `d3-color/d3-interpolate/d3-scale` ReDoS chain (CVSS — for the chart lib path)

- **Where**: chart rendering for `$TOKEN` mention modal (`ChartModal.tsx`).
- **What's wrong**: ReDoS in `d3-color <3.1.0`. Attacker would need to feed crafted color strings into the chart pipeline — the app feeds Birdeye/GeckoTerminal OHLCV which is numeric, so practical exploitability is low.
- **Fix**: pin `d3-color: ">=3.1.0"` via npm `overrides`.

### MED-2 — `bigint-buffer` buffer overflow via `toBigIntLE()` (CVSS 7.5)

- **Where**: transitive via `@solana/spl-token` → `@solana/buffer-layout-utils`.
- **What's wrong**: SPL-token deserialization could panic on malformed account data. Mainnet RPC responses are well-formed, but a malicious RPC endpoint (or an MITM with downgraded TLS) could trigger the bug.
- **Fix**: bump `@solana/spl-token` to a version that pulls a patched `bigint-buffer`, or `overrides` the dep directly. Verify `@solana/web3.js` continues to work.

### MED-3 — Bot `nftGate.ts` returns `false` (deny) when `HELIUS_API_KEY` is missing

- **Where**: `agents/monke-trader/src/lib/nft/nftGate.ts:65`
- **What's wrong**: defaults to deny on missing key — safe behavior. However, a transient Helius outage flips the gate to deny for 24h cache, then re-tries. Worth verifying that the user is never silently locked out of `/automonke`/`/buy`/`/sell` due to a Helius hiccup; the docstring mentions "lazy verification" but the cache TTL is 24h. Low severity, but UX-impacting.
- **Fix**: distinguish "Helius down" (don't cache the negative result) from "wallet truly does not hold a Saga Monke" (cache for 24h). Already partially handled — `walletHoldsMonke` returns `null` on error so check the `null` case in caller.

### MED-4 — `AVATAR_ROOM:` filtered list comment in `xmtp.ts` does not list `LIVE_PILL:`

- **Where**: `src/lib/xmtp.ts` (filter block at lines 346-372).
- **What's wrong**: `LIVE_PILL:` is a synthetic prefix generated client-side in `useXmtp.ts:1314,1339,1365`. It is correctly handled in `MessageBubble` and `ChatMessageList` as a special pill render type (`pill` item type) and never sent over XMTP, so there's nothing to filter — but `CLAUDE.md` lists `LIVE_PILL:` in the filter rule, which is actually inverted (we *want* to render it, not filter it). The comment in `CLAUDE.md` should be updated to clarify it's a synthetic-only prefix.
- **Fix**: documentation only; no code change needed.

### LOW-1 — Static SOL price-impact cap in worker

- **Where**: `worker-actions/src/index.ts:405-407` rejects swaps with `priceImpact > 15`. The hardcoded `15%` is reasonable but should arguably be lower (5-7%) for default size.
- **Fix**: optional UX tightening.

### LOW-2 — Bot `riskGateCheck` and drawdown halt thresholds may be drifted between modules

- **Where**: 
  - `lib/automonke/engine.ts:97` `DRAWDOWN_HALT_PCT = 20`
  - `lib/drift/engine.ts:111` `DRAWDOWN_HALT_USDC = 50`
  - `lib/monaco/engine.ts:112` `DRAWDOWN_HALT_USDT = 50`
- **What's wrong**: three separate drawdown halt constants; user-config in `riskManager.ts` only governs `drawdownHaltPct` for AutonoMonke. The Drift+Monaco halts are hardcoded $50. Consistent with the documented "$50 max" behavior from CLAUDE.md, but worth verifying that the user cannot bypass these values via `/risk` commands.
- **Fix**: confirm `/risk` UI does not expose Drift/Monaco drawdown overrides above $50. If it does, clamp server-side.

### LOW-3 — Logged FCM/push tokens in `__DEV__` only (informational)

- **Where**: `src/lib/notifications.ts:201,213`, `src/hooks/useXmtp.ts:186,1485`.
- **What's wrong**: FCM tokens are logged (sliced to first 30-40 chars) only when `__DEV__` is true. Acceptable per CLAUDE.md ("internal debug logs OK"). Not an issue, just noting it was checked.

---

## Section 4 — Verified-clean checklist

The following categories were actively scanned and either show no issues or are properly mitigated:

- [x] **No hardcoded API keys** in `/src`, `/app`, `/worker-actions/src`, or `/Monke_Eliza/agents/monke-trader/src` (greped for `gsk_`, `AIzaSy`, `sk_live`, `ghp_`, `github_pat`, plus generic `(apikey|secret|password)\s*[:=]\s*"[A-Za-z0-9]{20,}"` patterns). Only finding was a TextInput placeholder string `"ghp_..."` at `ChatScreen.tsx:1125`.
- [x] **No base58 Solana keypairs** committed to source — keys live in encrypted `.automonke_wallets.json` (gitignored) and `.xmtp_bot_key` (gitignored).
- [x] **No `.env` or `.p8` files committed** — `.env`, `.env.bak`, `infra/.env.lightrag`, `agents/monke-trader/.env` all gitignored. Only `.example` files tracked.
- [x] **No mnemonics / seed phrases** in source.
- [x] **No `eval()`, `new Function()`, `dangerouslySetInnerHTML`** in JS/TS app or bot source. (One false-positive in `SkiaPremiumAvatar.tsx:51` — a Skia shader call `pfp.eval(coord)` which is GPU shader sampling, not JS eval.)
- [x] **No `child_process` shell-injection paths** — all `execFileSync` calls use array args (no shell) and route user input through `sanitizeCliArg()` which strips null bytes, caps length at 4000, and prefixes a leading dash with a space to neutralize argument injection (`xmtpOnlyMonkes.ts:147-154`).
- [x] **AES-256-GCM crypto, not custom** — `walletVault.ts` and `botCostBasis.ts` use Node `crypto.createCipheriv("aes-256-gcm", ...)` with PBKDF2-SHA512 key derivation. Secret keys zeroed via `secretKey.fill(0)` after every signing operation.
- [x] **All Solana wallet/mint inputs validated** in worker via `new PublicKey(...)` try/catch (lines 377, 388, 473, 481, 641, 789, 841).
- [x] **Worker amount caps enforced**: swap ≤5 SOL (line 392), tip ≤10 SOL (line 484), prediction ≤`PREDICTION_MAX_USDC` (line 661), escrow ≤10 SOL (line 783).
- [x] **Worker rate limiting** — `/claim` has 10/min per-IP via KV counter (lines 821-826).
- [x] **Worker secret bearer auth** on `/escrow POST` via `BOT_HTTP_SECRET` (line 754).
- [x] **Worker AES-256-GCM** for escrow encryption (lines 717-742) using Web Crypto.
- [x] **Free-RASP gate `assertDeviceTrusted` wired** at every signing entry point: `BlinkCard.tsx:86`, `jupiterSwap.ts:336`, `solana.ts:101,158,244,345` (Purchase + 3 tip surfaces), `nftSwap.ts:216,375` (sell + buy), `cnftReceipts.ts:357`, `tipLink.ts:62`. No value-transfer path bypasses the gate.
- [x] **Production guard for missing RASP cert hash** — `security.ts:101-120` marks the device as `raspNotConfigured` (a HARD threat) if the cert hash is wrong format, blocking all signing.
- [x] **XMTP spoof guards in place** for `TRADE_OPENED:` (`useXmtp.ts:1638`) and `TRADE_CLOSED:` (`useXmtp.ts:1611`) — both verify `BOT_INBOX_IDS.includes(senderInboxId)` before parsing.
- [x] **All 22 system-prefix strings filtered** in `decodeMessage()` (`xmtp.ts:346-372`): REACT, STICKER_REACT, TYPING, PROFILE_UPDATE, EVENT, EDIT, PRESENCE, LIVE_ROOM, VIDEO_ROOM, AVATAR_ROOM, THREAD, PIN, UNPIN, NFT_LIST/BID/ACCEPT/DELIST/OFFER/SWAP/COMPLETE, AUTOMONKE_STATUS, TRADE_CLOSED, TRADE_OPENED. (LIVE_PILL is synthetic client-side — never received over XMTP.)
- [x] **AutonoMonke trade requires YES/NO confirmation** with 30s window (`userTrade.ts:483`). Bot enrollment requires explicit disclaimer acceptance (`dmFlow.ts:178`).
- [x] **MonkeBets / Monaco / Drift require `disclaimerAccepted && betsEnabled && active`** (`monaco/engine.ts:172`, `drift/engine.ts:228`).
- [x] **OpenClaw confidence gate not bypassed** for Monaco/Drift bets (`drift/engine.ts:260` enforces `confidence < minConf`). AutonoMonke now uses `multiPerspectiveConfidence` instead — confirmed at `automonke/engine.ts:349`.
- [x] **Drawdown halt enforced server-side** in all three engines (`automonke/engine.ts:250`, `drift/engine.ts:188`, `monaco/engine.ts:180`). Cannot be bypassed via DM.
- [x] **Position files contain no private keys** — verified `.automonke_positions.json` at `Monke_Eliza/agents/monke-trader/.automonke_positions.json`: only `id, inboxId, symbol, mint, entryPrice, tokenAmount, stop/target, openedAt, closedAt, pnlPct, taComposite` plus an HMAC integrity tag.
- [x] **NFT ownership gate** before bot DM commands access funds — `nftGate.ts` + `BOT_INBOX_IDS` registration. Cache TTL 24h.
- [x] **Insecure transport** — no plain `http://` non-localhost endpoints in app, bot, or worker source.
- [x] **SecureStore vs AsyncStorage** — push tokens, admin recovery PAT, and other secrets use `SecureStore` (`notifications.ts`, `remoteConfig.ts`). AsyncStorage usage is for non-sensitive UI state, profile cache, geocode cache, badges, threads, MOTW, etc.
- [x] **No sensitive data logged** — searched for `console.log` patterns including `secretKey/privateKey/mnemonic/seed/API_KEY/password` keywords; zero matches in app, bot, or worker. Token-token logging in `notifications.ts` is gated by `__DEV__` and slices to first 30 chars.

---

## Section 5 — Suggested next actions (priority order)

1. **(CRITICAL)** Remove keystore password literal `<REDACTED-PASSWORD>` from `src/lib/security.ts:79,114`. Move to a private runbook. Consider rotating the password.
2. **(CRITICAL)** Add `package.json` `overrides` to force `protobufjs >=7.5.5`, `undici >=6.24.0`, `bigint-buffer` patched, `d3-color >=3.1.0`, `picomatch >=2.3.2`, `minimatch >=3.1.4`, `@xmldom/xmldom >=0.8.13`. Re-run `npm audit` and confirm 0 critical / 0 high.
3. **(HIGH)** `git rm --cached android/app/google-services.json` and re-commit (file is in working tree but should be gitignored per `.gitignore:42`). Verify Firebase API key restrictions in console (SHA-1 + package name + App Check enforced).
4. **(HIGH)** Add KV namespace bindings to `worker-actions/wrangler.toml` so deploys are reproducible.
5. **(MED)** Consider lowering worker swap price-impact cap from 15% to 7% for blink default sizes.
6. **(MED)** Audit `nftGate.ts` to ensure transient Helius failures don't poison the 24h deny cache.
7. **(LOW)** Confirm `/risk` DM commands cannot raise Drift/Monaco drawdown halts above the documented $50 server-side floor.
8. **(LOW)** Optionally remove tracked `android/app/debug.keystore` (low-impact reproducibility tradeoff).
9. **(DOCS)** Update CLAUDE.md system-prefix filter list to clarify `LIVE_PILL:` is a synthetic client-side prefix that should be *rendered* (not filtered).

---

*Audit completed by Claude Opus 4.7 on 2026-05-02. Read-only — no code modifications. All findings are based on static analysis of source, gitignore + git ls-files inspection, and `npm audit` of `OnlyMonkes/`. Bot+worker source were greped for the same secret/dangerous-pattern signatures.*
