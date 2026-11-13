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

/** Public community tools, each on its own friendly address. */
const GLOBE_URL = "https://globe.onlymonkes.app";
const LEDGER_URL = "https://monkeledger.onlymonkes.app";

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
@media (max-width:420px){header.top .wrap{gap:8px}header.top img{height:28px}header.top nav{gap:8px}header.top .btn.sm{padding:7px 12px;font-size:13px}}
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
    <a class="hide-sm" href="/welcome#explore">Explore</a>
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
    <a href="${GLOBE_URL}">MonkeGlobe</a><a href="${LEDGER_URL}">MonkeLedger</a>
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
.explore{display:grid;grid-template-columns:1fr 1fr;gap:18px}
a.tool{display:flex;flex-direction:column;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:24px;color:var(--fg)}
a.tool:hover{border-color:var(--blue);text-decoration:none;background:linear-gradient(180deg,#123063 0%,var(--card) 70%)}
a.tool .ic{font-size:30px}
a.tool h3{font-size:22px}
a.tool p{color:var(--mut);font-size:15px}
a.tool .num{font-family:"Fredoka",sans-serif;font-size:18px;color:var(--ok)}
a.tool .go{margin-top:auto;color:var(--sky);font-weight:700}
details{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 20px;margin-bottom:10px}
summary{cursor:pointer;font-weight:700;font-size:17px}
details p{color:var(--mut);margin-top:10px}
.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.shots figure{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:10px;margin:0}
.shots img{display:block;width:100%;height:auto;aspect-ratio:720/1138;object-fit:cover;border-radius:14px;background:#0a0b12}
.shots figcaption{padding:12px 6px 4px}
.shots figcaption b{display:block;font-family:"Fredoka",sans-serif;font-size:18px}
.shots figcaption span{color:var(--mut);font-size:14px}
@media (max-width:860px){.hero .wrap{grid-template-columns:1fr}.hero img.mascot{max-width:220px;order:-1}.tiers,.explore{grid-template-columns:1fr}.shots{grid-template-columns:1fr 1fr}.grid,.steps{grid-template-columns:1fr 1fr}}
@media (max-width:560px){.grid,.steps{grid-template-columns:1fr}.shots{grid-template-columns:1fr;max-width:340px;margin:0 auto}.hero{padding-top:40px}}
`;

export function renderLanding(stats: SiteStats | null, globePins: number | null = null): Response {
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
        <li>Saga Monkes marketplace, Avatar Rooms, MonkeCaves</li>
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
    <div class="card"><div class="ic">🕹️</div><h3>MonkeCaves</h3><p>A retro cave shooter starring your own monke, plus Jungle Royale online. Earn bananas every day.</p></div>
    <div class="card"><div class="ic">🎙️</div><h3>Avatar Rooms</h3><p>Voice rooms where your monke PFP talks when you do.</p></div>
  </div>
  <p class="risk">MonkeTrades alerts and AutonoMonke are not financial advice. Crypto trading is risky and can lose money; past results don't predict future ones. See the <a href="/terms">terms</a>.</p>
</div></section>

<section id="screens"><div class="wrap">
  <h2>See it</h2>
  <p class="sub">Every Saga Monke comes to life in 3D, from its own traits.</p>
  <div class="shots">
    <figure><img src="/site/screen-caves.jpg" alt="MonkeCaves: a first-person cave with a waterfall wall and a glowing blue floor" width="720" height="1138" loading="lazy"><figcaption><b>MonkeCaves</b><span>Clear the caves, beat the clock.</span></figcaption></figure>
    <figure><img src="/site/screen-room.jpg" alt="Avatar Room 3D stage with four Saga Monkes, two of them talking" width="720" height="1138" loading="lazy"><figcaption><b>Avatar Rooms</b><span>Your monke talks when you do.</span></figcaption></figure>
    <figure><img src="/site/screen-monke3d.jpg" alt="A Saga Monke rebuilt as a 3D block model" width="720" height="1138" loading="lazy"><figcaption><b>Monke 3D</b><span>Any monke by number, face-tracked by your camera.</span></figcaption></figure>
  </div>
</div></section>

<section id="explore"><div class="wrap">
  <h2>Explore the community</h2>
  <p class="sub">Open to everyone, no wallet needed. Share them anywhere.</p>
  <div class="explore">
    <a class="tool" href="${GLOBE_URL}">
      <div class="ic">🌍</div>
      <h3>MonkeGlobe</h3>
      <p>Where Saga Monkes holders are around the world, and the community's upcoming events. Holders add themselves at city level.</p>
      ${globePins ? `<span class="num">${globePins.toLocaleString("en-US")} holders pinned</span>` : ""}
      <span class="go">globe.onlymonkes.app →</span>
    </a>
    <a class="tool" href="${LEDGER_URL}">
      <div class="ic">📒</div>
      <h3>MonkeLedger</h3>
      <p>Free Saga Monkes lookups: who holds which monke, ownership checks and proofs, checked against the chain. For holders and builders.</p>
      <span class="num">9,999 Monkes indexed${stats ? ` · ${stats.holders.toLocaleString("en-US")} holders` : ""}</span>
      <span class="go">monkeledger.onlymonkes.app →</span>
    </a>
  </div>
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

// ── /live: the next live Avatar Room hangout (owner 2026-11-13). Change LIVE_EVENT for the next one. ──
export const LIVE_EVENT = {
  start: Date.UTC(2026, 10, 14, 22, 0), // Sat Nov 14 2026, 5:00 PM EST
  hours: 3,
  title: "Monke Live: Avatar Room hangout",
};
const LIVE_ZONES: [string, string][] = [
  ["Los Angeles (PT)", "America/Los_Angeles"], ["Denver (MT)", "America/Denver"], ["Chicago (CT)", "America/Chicago"],
  ["New York (ET)", "America/New_York"], ["São Paulo", "America/Sao_Paulo"], ["London", "Europe/London"],
  ["Paris · Berlin · Lagos", "Europe/Paris"], ["Dubai", "Asia/Dubai"], ["India", "Asia/Kolkata"],
  ["Singapore · Manila", "Asia/Singapore"], ["Tokyo · Seoul", "Asia/Tokyo"], ["Sydney", "Australia/Sydney"],
];
export function liveZoneTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}
const icsStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function renderLive(now = Date.now()): Response {
  const e = LIVE_EVENT, end = e.start + e.hours * 3_600_000;
  const et = liveZoneTime(e.start, "America/New_York");
  const desc = `Live Avatar Room hangout for Saga Monke holders on OnlyMonkes, ${et} ET onward. Your 3D monke talks when you do.`;
  const self = `${SITE_BASE}/live`;
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${icsStamp(e.start)}/${icsStamp(end)}&details=${encodeURIComponent(`Open Main Chat in OnlyMonkes and tap the LIVE pill. ${self}`)}&location=${encodeURIComponent(self)}`;
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OnlyMonkes//Live//EN", "BEGIN:VEVENT", `UID:live-${e.start}@onlymonkes.app`, `DTSTAMP:${icsStamp(e.start)}`,
    `DTSTART:${icsStamp(e.start)}`, `DTEND:${icsStamp(end)}`, `SUMMARY:${e.title}`, `DESCRIPTION:Open Main Chat in OnlyMonkes and tap the LIVE pill. ${self}`, `URL:${self}`,
    "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", "DESCRIPTION:Monke Live starts in 15 minutes", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const tweet = `🎙️ ${e.title} — ${et} ET (${liveZoneTime(e.start, "UTC")} UTC). Bring your Saga Monke, your 3D monke talks when you do 🐒🍌\n\n${self}\n\n@xOnlyMonkes #SagaMonkes #SolanaMobile`;
  const rows = LIVE_ZONES.map(([label, tz]) => `<tr data-tz="${tz}"><td>${esc(label)}</td><td>${esc(liveZoneTime(e.start, tz))}</td></tr>`).join("");
  const phase = now >= end ? "ended" : now >= e.start ? "live" : "soon";
  const body = `${head(`${e.title} · ${et} ET`, desc, "/live", PAGE_CSS + LIVE_CSS)}
<main class="page live">
  <img class="mascot" src="/site/icon-512.png" alt="">
  <div class="pill ${phase}" id="phase">${phase === "live" ? "● LIVE NOW" : phase === "ended" ? "This hangout has ended" : "LIVE AVATAR ROOM"}</div>
  <h1>${esc(e.title)}</h1>
  <p class="when"><b>${esc(et)} ET</b> onward · come and go any time</p>
  <div class="local" id="local" hidden></div>
  <div class="count" id="count" hidden></div>
  <div class="stack">
    <a class="btn primary" href="/open/chat">Open Main Chat (holders)</a>
    <a class="btn ghost" href="/get">New here? Get OnlyMonkes</a>
  </div>
  <div class="cal"><a href="${esc(gcal)}" target="_blank" rel="noopener">Add to Google Calendar</a> · <a href="data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}" download="monke-live.ics">Add to phone calendar (.ics)</a></div>

  <h2>Start time around the world</h2>
  <table class="zones">${rows}</table>

  <h2>What happens</h2>
  <ul class="list">
    <li>Every holder shows up as their own 3D Saga Monke on one stage.</li>
    <li>Your monke's mouth and head follow yours (face tracking on your phone), or move with your voice.</li>
    <li>Call the bot in by voice: tap 🤖 and say "Hey Monke".</li>
    <li>On a computer with no mic? Tap 📱 and use your phone as mic and camera.</li>
  </ul>

  <h2>How to join</h2>
  <ol class="list">
    <li><b>Hold a Saga Monke.</b> Rooms are for holders. <a href="${TENSOR_URL}" target="_blank" rel="noopener">Get one on Tensor</a><span id="floor"></span>.</li>
    <li><b>Get OnlyMonkes</b> from the Solana dApp Store on Seeker or Saga, or use the <a href="${WEB_APP_BASE}">web app</a> on a computer.</li>
    <li><b>Log in with your wallet.</b> Main Chat opens.</li>
    <li><b>At ${esc(et.replace(/^\w+ /, ""))} ET</b>, tap the LIVE pill in Main Chat to join.</li>
  </ol>
  <div class="stack">
    <a class="btn ghost" target="_blank" rel="noopener" href="https://x.com/intent/tweet?text=${encodeURIComponent(tweet)}">Share on X</a>
  </div>
  <p class="tip">Holders: invite a friend from Menu → Invite. New holders who join through your link count for the November referral season (250 bananas each).</p>
</main>
<script>
(function(){var S=${e.start},E=${end};
try{var tz=Intl.DateTimeFormat().resolvedOptions().timeZone;var t=new Intl.DateTimeFormat(undefined,{weekday:'long',hour:'numeric',minute:'2-digit'}).format(new Date(S));
var l=document.getElementById('local');l.textContent='Your time: '+t+(tz?' ('+tz.replace(/_/g,' ')+')':'');l.hidden=false;
var r=document.querySelector('tr[data-tz="'+tz+'"]');if(r)r.className='me';}catch(_){}
var c=document.getElementById('count'),p=document.getElementById('phase');
function tick(){var n=Date.now();if(n>=E){c.hidden=true;p.textContent='This hangout has ended';p.className='pill ended';return;}
if(n>=S){c.hidden=false;c.textContent='We are live, come in';p.textContent='● LIVE NOW';p.className='pill live';return;}
var d=Math.floor((S-n)/1000),h=Math.floor(d/3600),m=Math.floor(d%3600/60),s=d%60;c.hidden=false;c.textContent='Starts in '+h+'h '+String(m).padStart(2,'0')+'m '+String(s).padStart(2,'0')+'s';}
tick();setInterval(tick,1000);
fetch('/api/floor').then(function(r){return r.ok?r.json():null}).then(function(f){if(f&&f.floorSol)document.getElementById('floor').textContent=' (floor ~'+(Math.round(f.floorSol*100)/100)+' SOL)';}).catch(function(){});
})();
</script>
${foot()}`;
  return html(body, 200, "public, max-age=60");
}

const LIVE_CSS = `
.live img.mascot{display:block;margin:0 auto 14px}
.live .pill{display:table;margin-left:auto;margin-right:auto;font-size:13px;font-weight:700;letter-spacing:1px;padding:4px 12px;border-radius:999px;border:1px solid var(--line);color:var(--sky);margin-bottom:12px}
.live .pill.live{background:#e91671;border-color:#e91671;color:#fff}
.live .pill.ended{color:var(--mut)}
.live .when{font-size:18px;color:var(--fg);margin-bottom:6px}
.live .local{font-size:17px;color:var(--ok);font-weight:600;margin-bottom:4px}
.live .count{font-variant-numeric:tabular-nums;color:var(--mut);margin-bottom:20px}
.live .cal{margin:16px 0 8px;font-size:14px}
.live h2{font-size:22px;margin:36px 0 12px}
.live table.zones{width:100%;max-width:420px;margin:0 auto;border-collapse:collapse;font-size:15px}
.live table.zones td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left}
.live table.zones td+td{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.live table.zones tr.me td{color:var(--ok);font-weight:700}
.live .list{text-align:left;max-width:460px;margin:0 auto;padding-left:22px;color:var(--mut)}
.live .list li{margin-bottom:8px}
.live .list b{color:var(--fg)}
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
