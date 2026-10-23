/**
 * onlymonkes.app — public landing page, install page and deep-link bounce
 * pages (2026-10-22). The web app owns "/" on onlymonkes.app (owner, same
 * evening); its front door (scripts/web/site-router.ts on web-app) forwards
 * the site paths below to this worker, so the landing page is /welcome.
 *
 * Deep links (Phase 1, works on the published 3.4 binary): /open/<target>
 * fires an Android intent for the app's own `onlymonkes://` scheme, with a
 * fallback to /get when the app isn't installed. Verified https App Links
 * need a native intent filter and wait for the 3.1 APK.
 */

export const SITE_BASE = "https://onlymonkes.app";
export const WEB_APP_BASE = SITE_BASE;
export const ANDROID_PACKAGE = "com.onlymonkes.app";
const TENSOR_URL = "https://www.tensor.trade/trade/sagamonkes";
const CONTACT_EMAIL = "Jumpstreet25@icloud.com";

/** /open/<key> → the app route (3.4 already has every one of these) and the web app path. */
export const OPEN_TARGETS: Record<string, { label: string; app: string; web: string; tier: "genesis" | "monke" }> = {
  chat: { label: "Main Chat", app: "chat", web: "/chat", tier: "monke" },
  genesis: { label: "Genesis Chat", app: "genesis-chat", web: "/genesis-chat", tier: "genesis" },
  trades: { label: "MonkeTrades", app: "bot-channel?channelId=trades", web: "/bot-channel?channelId=trades", tier: "monke" },
  marketplace: { label: "Marketplace", app: "marketplace", web: "/marketplace", tier: "monke" },
  monkememe: { label: "MonkeMeme", app: "monkememe", web: "/monkememe", tier: "monke" },
  dms: { label: "Messages", app: "dms", web: "/dms", tier: "monke" },
  watchlist: { label: "Watchlist", app: "watchlist", web: "/watchlist", tier: "monke" },
  portfolio: { label: "Portfolio", app: "portfolio", web: "/portfolio", tier: "monke" },
  globe: { label: "MonkeGlobe", app: "globe", web: "/globe", tier: "monke" },
  treasury: { label: "Treasury", app: "treasury", web: "/treasury", tier: "monke" },
};

export interface SiteStats {
  holders: number;
  floorSol: number | null;
  volume24hSol: number | null;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function storeIntent(fallback: string): string {
  return `intent://details?id=${ANDROID_PACKAGE}#Intent;scheme=solanadappstore;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}

function appIntent(appPath: string, fallback: string): string {
  return `intent://${appPath}#Intent;scheme=onlymonkes;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}

function chromeIntent(url: string): string {
  const u = new URL(url);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;end`;
}

const BASE_CSS = `
:root{--bg:#050b1a;--bg2:#0b1730;--card:#0f1f3d;--line:#1d3361;--fg:#f4f8ff;--mut:#9db3d6;--blue:#6cb4ee;--sky:#8fd9fb;--ok:#14f195}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--sky);text-decoration:none}
a:hover{text-decoration:underline}
h1,h2,h3{font-family:"Fredoka",system-ui,sans-serif;font-weight:700;line-height:1.15;text-wrap:balance}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
header.top{position:sticky;top:0;z-index:5;background:rgba(5,11,26,.86);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;height:64px}
header.top img{height:34px;width:auto;display:block}
header.top nav{display:flex;gap:18px;align-items:center;font-size:15px}
header.top nav a.hide-sm{color:var(--mut)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:999px;padding:12px 22px;font-weight:700;font-size:16px;border:1.5px solid transparent;text-decoration:none!important;white-space:nowrap}
.btn.sm{padding:8px 16px;font-size:14px}
.btn.primary{background:var(--blue);color:#04101f}
.btn.primary:hover{background:var(--sky)}
.btn.ghost{border-color:var(--blue);color:var(--sky)}
.btn.ghost:hover{background:rgba(108,180,238,.12)}
footer{border-top:1px solid var(--line);margin-top:72px;padding:28px 0 40px;color:var(--mut);font-size:14px}
footer .wrap{display:flex;flex-wrap:wrap;gap:12px 22px;justify-content:space-between}
footer nav{display:flex;flex-wrap:wrap;gap:8px 18px}
@media (max-width:640px){header.top nav a.hide-sm{display:none}}
`;

function head(title: string, description: string, path: string, extraCss = ""): string {
  const url = SITE_BASE + path;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" type="image/png" href="/site/favicon.png">
<link rel="apple-touch-icon" href="/site/apple-touch-icon.png">
<meta name="theme-color" content="#050b1a">
<meta property="og:type" content="website">
<meta property="og:site_name" content="OnlyMonkes">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE_BASE}/site/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE_BASE}/site/og.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@600;700&display=swap" rel="stylesheet">
<style>${BASE_CSS}${extraCss}</style>
</head>
<body>
<header class="top"><div class="wrap">
  <a href="/welcome" aria-label="OnlyMonkes home"><img src="/site/logo.png" alt="OnlyMonkes" width="146" height="34"></a>
  <nav>
    <a class="hide-sm" href="/welcome#access">Access</a>
    <a class="hide-sm" href="/welcome#features">Features</a>
    <a class="hide-sm" href="/welcome#faq">FAQ</a>
    <a class="btn sm ghost" href="${WEB_APP_BASE}">Web app</a>
    <a class="btn sm primary" href="/get">Get the app</a>
  </nav>
</div></header>`;
}

function foot(): string {
  return `<footer><div class="wrap">
  <span>© ${new Date().getUTCFullYear()} OnlyMonkes · a community app for Saga Monkes holders</span>
  <nav>
    <a href="/legal">Legal</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/copyright">Copyright</a>
    <a href="mailto:${CONTACT_EMAIL}">Contact</a>
  </nav>
</div></footer>
</body></html>`;
}

function html(body: string, status = 200, cache = "public, max-age=300"): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

const LANDING_CSS = `
.hero{padding:72px 0 40px;background:radial-gradient(ellipse 80% 70% at 50% 0%,#17407a 0%,transparent 70%)}
.hero .wrap{display:grid;grid-template-columns:1.2fr .8fr;gap:40px;align-items:center}
.hero h1{font-size:clamp(36px,6vw,60px)}
.hero h1 span{color:var(--sky)}
.hero p.lead{font-size:clamp(17px,2.2vw,20px);color:var(--mut);margin:18px 0 28px;max-width:560px}
.hero .ctas{display:flex;flex-wrap:wrap;gap:12px}
.hero .note{margin-top:14px;font-size:14px;color:var(--mut)}
.hero img.mascot{width:100%;max-width:340px;justify-self:center;filter:drop-shadow(0 20px 60px rgba(108,180,238,.35))}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin-top:32px}
.stat{background:rgba(15,31,61,.7);border:1px solid var(--line);border-radius:14px;padding:10px 16px}
.stat b{display:block;font-size:20px;font-family:"Fredoka",sans-serif}
.stat span{font-size:13px;color:var(--mut)}
section{padding:56px 0 0}
section h2{font-size:clamp(28px,4vw,38px);margin-bottom:10px}
section p.sub{color:var(--mut);max-width:640px;margin-bottom:28px}
.tiers{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.tier{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:26px;display:flex;flex-direction:column;gap:12px}
.tier.premium{border-color:var(--blue);background:linear-gradient(180deg,#123063 0%,var(--card) 60%)}
.tier .badge{align-self:flex-start;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:4px 10px;background:rgba(108,180,238,.15);color:var(--sky)}
.tier h3{font-size:26px}
.tier .need{color:var(--mut);font-size:15px}
.tier ul{list-style:none;display:flex;flex-direction:column;gap:8px;margin:4px 0 8px}
.tier li{padding-left:26px;position:relative}
.tier li::before{content:"🍌";position:absolute;left:0;font-size:15px}
.tier .btn{align-self:flex-start;margin-top:auto}
.dual{margin-top:14px;color:var(--mut);font-size:15px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px}
.card .ic{font-size:28px}
.card h3{font-size:20px;margin:8px 0 6px}
.card p{color:var(--mut);font-size:15px}
.risk{margin-top:18px;font-size:14px;color:var(--mut)}
.risk a{color:inherit}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;counter-reset:s}
.step{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px;counter-increment:s}
.step::before{content:counter(s);display:inline-grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--blue);color:#04101f;font-weight:800;margin-bottom:10px}
.step h3{font-size:19px;margin-bottom:6px}
.step p{color:var(--mut);font-size:15px}
.desk{margin-top:16px;color:var(--mut);font-size:15px}
.chips{display:flex;flex-wrap:wrap;gap:10px}
.chip{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:10px 16px;color:var(--fg);font-weight:600}
.chip:hover{border-color:var(--blue);text-decoration:none}
details{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 20px;margin-bottom:10px}
summary{cursor:pointer;font-weight:700;font-size:17px}
details p{color:var(--mut);margin-top:10px}
@media (max-width:860px){.hero .wrap{grid-template-columns:1fr}.hero img.mascot{max-width:220px;order:-1}.tiers{grid-template-columns:1fr}.grid,.steps{grid-template-columns:1fr 1fr}}
@media (max-width:560px){.grid,.steps{grid-template-columns:1fr}.hero{padding-top:40px}}
`;

export function renderLanding(stats: SiteStats | null): Response {
  const statChips = stats
    ? [
        `<div class="stat"><b>${stats.holders.toLocaleString("en-US")}</b><span>Saga Monkes holders</span></div>`,
        stats.floorSol ? `<div class="stat"><b>${stats.floorSol.toFixed(2)} SOL</b><span>floor</span></div>` : "",
        stats.volume24hSol ? `<div class="stat"><b>${stats.volume24hSol.toFixed(1)} SOL</b><span>24h volume</span></div>` : "",
      ].join("")
    : "";
  const chips = Object.entries(OPEN_TARGETS)
    .filter(([k]) => ["chat", "genesis", "trades", "marketplace", "monkememe"].includes(k))
    .map(([k, t]) => `<a class="chip" href="/open/${k}">${esc(t.label)} →</a>`)
    .join("");

  const body = `${head(
    "OnlyMonkes — the home of Saga Monkes on Solana Mobile",
    "Encrypted holder chat, a trading bot in your DMs, a marketplace and memes — for Saga Monkes and Genesis Token holders on Seeker and Saga.",
    "/welcome",
    LANDING_CSS,
  )}
<main>
<div class="hero"><div class="wrap">
  <div>
    <h1>The home of <span>Saga Monkes</span> on Solana Mobile.</h1>
    <p class="lead">Encrypted holder chat, a trading bot that lives in your DMs, a marketplace and memes. Your wallet is your ticket in.</p>
    <div class="ctas">
      <a class="btn primary" href="/get">Get the app</a>
      <a class="btn ghost" href="${WEB_APP_BASE}">Open the web app</a>
    </div>
    <p class="note">For Seeker and Saga, on the Solana dApp Store.</p>
    <div class="stats">${statChips}</div>
  </div>
  <img class="mascot" src="/site/icon-512.png" alt="" width="340" height="340">
</div></div>

<section id="access"><div class="wrap">
  <h2>Two ways in</h2>
  <p class="sub">OnlyMonkes reads what's in your wallet and opens the right chat. Nothing to sign up for.</p>
  <div class="tiers">
    <div class="tier">
      <span class="badge">Genesis</span>
      <h3>Genesis Chat</h3>
      <p class="need">Hold a <b>Saga Genesis Token</b> or a <b>Seeker Genesis Token</b>.</p>
      <ul>
        <li>Genesis Chat — the members' room for Solana Mobile owners</li>
        <li>Banana Shop — worlds, themes, badges and frames for your profile</li>
        <li>Leaderboard</li>
      </ul>
      <a class="btn ghost" href="/open/genesis">Open Genesis Chat</a>
    </div>
    <div class="tier premium">
      <span class="badge">Premium</span>
      <h3>Main Chat</h3>
      <p class="need">Hold a <b>Saga Monke</b>.</p>
      <ul>
        <li>Everything in Genesis, plus Main Chat with every holder</li>
        <li>MonkeTrades — live trade alerts from MonkeBrain</li>
        <li>Monke, the bot in your DMs: portfolio, limit orders, sell ladders</li>
        <li>AutonoMonke — opt-in automated trading from your own hot wallet</li>
        <li>Saga Monkes marketplace, MonkeMeme, Avatar Rooms</li>
        <li>Private DMs and group chats</li>
      </ul>
      <a class="btn primary" href="${TENSOR_URL}" target="_blank" rel="noopener">Get a Saga Monke on Tensor</a>
    </div>
  </div>
  <p class="dual">Hold both? You get both, and switch between them with one tap.</p>
</div></section>

<section id="features"><div class="wrap">
  <h2>What's inside</h2>
  <p class="sub">Built for the people who hold the monkes.</p>
  <div class="grid">
    <div class="card"><div class="ic">🔒</div><h3>Encrypted chat</h3><p>End-to-end encrypted on XMTP. Your inbox follows your wallet to any phone.</p></div>
    <div class="card"><div class="ic">🐒</div><h3>Monke, the bot</h3><p>Ask about any token, check your bags, set targets and ladders, all by DM. Nothing trades without your YES.</p></div>
    <div class="card"><div class="ic">📈</div><h3>MonkeTrades</h3><p>Alerts with entry, targets and stop, plus a one-tap buy you sign in your own wallet.</p></div>
    <div class="card"><div class="ic">🛒</div><h3>Marketplace</h3><p>List, bid and swap Saga Monkes holder to holder, settled on-chain.</p></div>
    <div class="card"><div class="ic">🎨</div><h3>MonkeMeme</h3><p>Turn any Saga Monke into a cartoon meme from its own traits, then share it to X.</p></div>
    <div class="card"><div class="ic">🎙️</div><h3>Avatar Rooms</h3><p>Voice rooms where your monke PFP talks when you do.</p></div>
  </div>
  <p class="risk">MonkeTrades alerts and AutonoMonke are not financial advice. Crypto trading is risky and can lose money; past results don't predict future ones. See the <a href="/terms">terms</a>.</p>
</div></section>

<section id="start"><div class="wrap">
  <h2>Getting started</h2>
  <p class="sub">About a minute on a Seeker or Saga.</p>
  <div class="steps">
    <div class="step"><h3>Install</h3><p>Get OnlyMonkes from the Solana dApp Store, or download the APK.</p></div>
    <div class="step"><h3>Connect your wallet</h3><p>Sign one message with your Seed Vault wallet. That proves what you hold. We never see your keys or seed phrase.</p></div>
    <div class="step"><h3>You're in</h3><p>Genesis or Main Chat opens, depending on what's in your wallet.</p></div>
  </div>
  <p class="desk">On a computer? Open the <a href="${WEB_APP_BASE}">web app</a> and scan the QR code with your Seeker to log in.</p>
</div></section>

<section id="open"><div class="wrap">
  <h2>Jump straight in</h2>
  <p class="sub">Each link opens that screen in the app if it's installed, or the web app if it isn't. Share them anywhere.</p>
  <div class="chips">${chips}</div>
</div></section>

<section id="faq"><div class="wrap">
  <h2>Questions</h2>
  <details><summary>Do I need a Saga Monke?</summary><p>No. A Saga or Seeker Genesis Token gets you into Genesis Chat, the Banana Shop and the leaderboard. Main Chat and the trading tools need a Saga Monke.</p></details>
  <details><summary>Is my wallet safe?</summary><p>OnlyMonkes never asks for your seed phrase or private key. You sign a message to prove ownership, and every purchase or swap you make in the app is signed by you in your own wallet.</p></details>
  <details><summary>What is AutonoMonke?</summary><p>An opt-in bot that trades MonkeBrain's signals from a separate hot wallet you fund. Crypto trading is risky: it can and does lose money, past results don't predict future ones, and nothing here is financial advice. Read the <a href="/terms">terms</a> before you turn it on.</p></details>
  <details><summary>What does it cost?</summary><p>The app is free to install. OnlyMonkes takes 5% of AutonoMonke profits, 3% of profit on bot sells you place (half that when paid in SKR) and 2% of marketplace sales, inside the same transaction. There's no profit fee on a losing trade.</p></details>
  <details><summary>Does it work on iPhone?</summary><p>The app is for Android Solana Mobile phones (Seeker and Saga). On any computer you can use the web app, logging in with your Seeker.</p></details>
</div></section>
</main>
${foot()}`;
  return html(body);
}

const PAGE_CSS = `
.page{max-width:560px;margin:0 auto;padding:56px 20px 0;text-align:center}
.page img.mascot{width:120px;height:120px;margin-bottom:18px}
.page h1{font-size:clamp(28px,5vw,38px);margin-bottom:10px}
.page p{color:var(--mut);margin-bottom:22px}
.page .stack{display:flex;flex-direction:column;gap:12px;align-items:stretch;max-width:360px;margin:0 auto}
.page .tip{margin-top:22px;font-size:14px;color:var(--mut);background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;text-align:left}
.page .tip[hidden]{display:none}
`;

/** In-app browsers (X, Instagram, Facebook, LINE…) usually block intents. */
const IN_APP_UA = /(Twitter|FBAN|FBAV|Instagram|Line\/|TikTok|Snapchat|Discord)/i;

export function renderGet(): Response {
  const apk = `${SITE_BASE}/download/apk`;
  const body = `${head("Get OnlyMonkes", "Install OnlyMonkes from the Solana dApp Store on Seeker or Saga.", "/get", PAGE_CSS)}
<main class="page">
  <img class="mascot" src="/site/icon-512.png" alt="">
  <h1>Get OnlyMonkes</h1>
  <p>OnlyMonkes is on the Solana dApp Store for Seeker and Saga.</p>
  <div class="stack">
    <a class="btn primary" id="store" href="${esc(storeIntent(apk))}">Open in the dApp Store</a>
    <a class="btn ghost" href="/download/apk">Download the APK</a>
    <a class="btn ghost" href="${WEB_APP_BASE}">Use the web app instead</a>
  </div>
  <p class="tip" id="notandroid" hidden>You're not on an Android phone. Open this page on your Seeker or Saga to install, or use the web app on this computer and log in with your Seeker.</p>
  <p class="tip" id="inapp" hidden>This in-app browser may block the store. Tap ⋯ and choose <b>Open in browser</b>, or <a id="chrome" href="#">open this page in Chrome</a>.</p>
</main>
<script>
(function(){var ua=navigator.userAgent;
if(!/Android/i.test(ua)){document.getElementById('notandroid').hidden=false;document.getElementById('store').style.display='none';}
else if(${IN_APP_UA}.test(ua)){document.getElementById('inapp').hidden=false;document.getElementById('chrome').href=${JSON.stringify(chromeIntent(`${SITE_BASE}/get`))};}
})();
</script>
${foot()}`;
  return html(body);
}

export function renderOpen(key: string): Response | null {
  const t = OPEN_TARGETS[key];
  if (!t) return null;
  const self = `${SITE_BASE}/open/${key}`;
  const intent = appIntent(t.app, `${SITE_BASE}/get`);
  const web = WEB_APP_BASE + t.web;
  const need = t.tier === "genesis" ? "a Saga or Seeker Genesis Token (or a Saga Monke)" : "a Saga Monke";
  const body = `${head(`${t.label} — OnlyMonkes`, `Open ${t.label} in OnlyMonkes. Needs ${need} in your wallet.`, `/open/${key}`, PAGE_CSS)}
<main class="page">
  <img class="mascot" src="/site/icon-512.png" alt="">
  <h1>Opening ${esc(t.label)}…</h1>
  <p>${esc(t.label)} needs ${esc(need)} in your wallet.</p>
  <div class="stack">
    <a class="btn primary" id="app" href="${esc(intent)}">Open in OnlyMonkes</a>
    <a class="btn ghost" href="${esc(web)}">Open in the web app</a>
    <a class="btn ghost" href="/get">Don't have the app? Get it</a>
  </div>
  <p class="tip" id="inapp" hidden>This in-app browser can't open other apps. Tap ⋯ and choose <b>Open in browser</b>, or <a id="chrome" href="#">open this link in Chrome</a>.</p>
</main>
<script>
(function(){var ua=navigator.userAgent;
if(!/Android/i.test(ua)){document.getElementById('app').style.display='none';return;}
if(${IN_APP_UA}.test(ua)){document.getElementById('inapp').hidden=false;document.getElementById('chrome').href=${JSON.stringify(chromeIntent(self))};return;}
location.href=${JSON.stringify(intent)};
})();
</script>
${foot()}`;
  return html(body);
}

export const LEGAL_PATHS = /^\/(legal|terms|privacy|copyright)(\/|\.html)?$/;

// ─── /bot — what the bot does (owner, 2026-10-22) ────────────────────────────
// Public commands only, from an allowlist. Nothing from MonkeBrain / the TA
// scanner / AutonoMonke (no scores, alerts, reports or win rates): that code
// is private and its signals are a holder perk.

export type BotCommand = { cmd: string; args?: string; group?: string; admin?: boolean; desc?: { en?: string } };

const BOT_PAGE_GROUPS: { title: string; cmds: string[] }[] = [
  { title: "Prices & charts", cmds: ["/price", "/chart"] },
  { title: "Watchlist", cmds: ["/watchlist", "/watch", "/unwatch", "/mywatchlist"] },
  { title: "Trade from your own wallet", cmds: ["/buy", "/sell", "/swap", "/limit", "/positions", "/claim-rent", "/stake", "/unstake"] },
  { title: "Tips", cmds: ["/tip", "/tiplink", "/donate"] },
  { title: "Your account", cmds: ["/reclaim", "/myid", "/help"] },
];

const BOT_CSS = `
.bot{max-width:760px;margin:0 auto;padding:56px 20px 0}
.bot .intro{text-align:center;margin-bottom:34px}
.bot .intro img{width:104px;height:104px;margin-bottom:14px}
.bot h1{font-size:clamp(28px,5vw,40px);margin-bottom:8px}
.bot .intro p{color:var(--mut);max-width:560px;margin:0 auto 18px}
.bot .row{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
.bot h2{font-size:20px;margin:30px 0 10px}
.bot ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.bot li{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline}
.bot code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;color:var(--text);white-space:nowrap}
.bot code .a{color:var(--mut)}
.bot li span{color:var(--mut);font-size:14px;flex:1 1 220px}
.bot .note{margin-top:26px;font-size:14px;color:var(--mut);background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
`;

export function renderBot(commands: BotCommand[]): Response {
  const byCmd = new Map<string, BotCommand>();
  for (const c of commands) if (c?.cmd && !c.admin && !byCmd.has(c.cmd)) byCmd.set(c.cmd, c);
  const sections = BOT_PAGE_GROUPS.map((g) => {
    const items = g.cmds.map((k) => byCmd.get(k)).filter((c): c is BotCommand => !!c);
    if (!items.length) return "";
    const rows = items.map((c) => {
      const desc = (c.desc?.en ?? "").split(" — ")[0].slice(0, 120);
      return `<li><code>${esc(c.cmd)}${c.args ? ` <span class="a">${esc(c.args)}</span>` : ""}</code><span>${esc(desc)}</span></li>`;
    }).join("");
    return `<h2>${esc(g.title)}</h2><ul>${rows}</ul>`;
  }).join("");
  const body = `${head("Meet Monke — the OnlyMonkes bot", "Monke (AI Agent #9385) lives in OnlyMonkes chat: prices, charts, wallet trades, tips and more for Saga Monkes holders.", "/bot", BOT_CSS)}
<main class="bot">
  <div class="intro">
    <img src="/site/icon-512.png" alt="">
    <h1>Meet Monke</h1>
    <p>Monke (AI Agent #9385) lives in the OnlyMonkes chat. Ask it things in Main Chat or send it a DM: prices, charts, trades from your own wallet, tips and more. It's for Saga Monkes holders.</p>
    <div class="row">
      <a class="btn primary" href="/open/dms">Message Monke</a>
      <a class="btn ghost" href="/open/chat">Open Main Chat</a>
    </div>
  </div>
  ${sections}
  <p class="note">Trades always come from your own wallet and wait for you to reply YES before anything happens. Crypto is risky: you can lose money, and nothing Monke says is financial advice. See the <a href="/terms">terms</a>. Type <code>/help</code> in a DM for the full list.</p>
</main>
${foot()}`;
  return html(body);
}
