# XMTP web harness (SDK 8)

Drives the real `src/web/xmtpCompat.ts` in headless Chromium against an XMTP backend
(staging by default, from `src/lib/xmtpBackend.ts`): two throwaway wallets, create via the
brotli client wasm (served the way `site-router.ts` serves it), inbox lookup, DM, live
stream, group, reaction + reply, reopen after reload. Last run 2026-10-31: 8/8 on staging.

```
node scripts/web/build-xmtp.mjs                       # public/xmtp/
cd scripts/web/xmtp-harness && npm i --no-save playwright-core@1.49.1 esbuild@0.25.10
node build.mjs
XMTP_TEST_CREDENTIAL_FILE=/path/outside/repo CHROMIUM=<headless_shell> node run.mjs
```

The credential is a backend API key (staging `test-harness`, `XMTP_TEST_API_KEY` in the
VPS `~/xmtp-backend/.env`) in a mode-600 file outside the repo; it is injected into a page
served on 127.0.0.1 only. Never point this at production before the cutover — the first
client makes the `onlymonkes` identifier permanent. On WSL without system Chromium libs,
`apt-get download libnss3 libnspr4 libasound2t64`, unpack with `dpkg-deb -x`, and run with
`LD_LIBRARY_PATH` pointing at the unpacked `usr/lib/x86_64-linux-gnu`.
