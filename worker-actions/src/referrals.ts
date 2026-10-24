/**
 * Referrals (owner, 2026-10-24): bananas to both (250 to the referrer, 100 to
 * the new holder), Recruiter badges at 1 / 5 / 25, monthly seasons (top
 * recruiter gets ~$10 SKR, paid by hand). The season is OFF until the KV key
 * `season` is set:
 *   wrangler kv key put --binding REFERRALS --remote season '{"id":"2026-11","start":<ms>,"end":<ms>}'
 *
 * Who counts: the new person holds a Saga Monke (tier "monke"), their wallet is
 * new to the bot (POST <bot>/referral-check: never seen, or first seen in the
 * last 14 days), one credit per wallet, never your own code.
 *
 * Identity without a wallet prompt: the phone sends the Device Integrity
 * hardware-key proof (walletFromDeviceProof), the web its holder sign-in token.
 * Wallets are stored only as hashes and never shown.
 *
 *   POST /api/referral/me        { proof, name?, pfp? } → your code, link, card, counts, badges, season
 *   POST /api/referral/collect   { proof }              → { bananas } (credits not yet collected, once)
 *   POST /api/referral/claim     { proof, code }        → { ok, bananas, name } | { error, reason }
 *   GET  /api/referral/code/<C>                          → { name, pfp } (invite screen)
 *   GET  /api/referral/leaderboard                       → { season, top }
 *   GET  /r/<C> · /r/<C>/card.png · /referrals           pages
 *
 * KV (REFERRALS): code:<C> { o, n, p, t, c, k } · owner:<id> → C · by:<id> { c, t }
 *                 season { id, start, end } · s:<season>:<C> → count
 */
import type { Env } from "./index";
import { create as qrCreate } from "qrcode/lib/core/qrcode";
import { holderClaimsFromToken } from "./webAuth";
import { walletFromDeviceProof } from "./livekitAuth";
import { sha256Hex } from "./cryptoVerify";
import { ACCENT, BG, Canvas, MUTED, TEXT, W, encodePng, esc, monkeImageForNumber, readArt, textWidth } from "./shareCard";

const SITE = "https://onlymonkes.app";
export const REFERRER_BANANAS = 250;
export const NEW_HOLDER_BANANAS = 100;
export const BADGES = [1, 5, 25];
const NEW_WINDOW_MS = 14 * 86400_000;
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE = /^[2-9A-HJ-NP-Z]{6}$/;
const ANDROID_PACKAGE = "com.onlymonkes.app";

type CodeRec = { o: string; n: string; p: number | null; t: number; c: number; k: number };
type Season = { id: string; start: number; end: number };

export function referralProofMessage(action: string, nonce: string): string {
  return `OnlyMonkes Referral\naction:${action}\nnonce:${nonce}`;
}

export function isReferralPath(path: string): boolean {
  return path.startsWith("/api/referral/") || /^\/r\/[^/]+(\/card\.png)?\/?$/.test(path) || path === "/referrals" || path === "/referrals/";
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
}

const enc = new TextEncoder();
const idFor = async (wallet: string) => (await sha256Hex(enc.encode(`om-ref:${wallet}`))).slice(0, 40);
export const cleanName = (s: unknown) => String(s ?? "").replace(/[^A-Za-z0-9 ._-]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
const cleanPfp = (p: unknown) => {
  const n = typeof p === "number" ? p : parseInt(String(p ?? ""), 10);
  return monkeImageForNumber(n) ? n : null;
};
const displayName = (r: CodeRec) => r.n || (r.p ? `Monke #${r.p}` : "A Saga Monke holder");
const cardVersion = async (r: CodeRec) => (await sha256Hex(enc.encode(`${r.n}|${r.p}`))).slice(0, 10);

async function who(env: Env, proof: any, action: string): Promise<{ wallet: string; tier: string } | { error: string; status: number }> {
  if (proof?.kind === "holder") {
    const c = await holderClaimsFromToken(env as any, typeof proof.token === "string" ? proof.token : "");
    return c ? { wallet: c.wallet, tier: c.tier ?? "" } : { error: "sign in again", status: 401 };
  }
  if (proof?.kind === "device") {
    // Device Integrity says "sagaMonke" where the web token says "monke".
    const r = await walletFromDeviceProof(env, proof, (nonce) => referralProofMessage(action, nonce));
    return "error" in r ? r : { wallet: r.wallet, tier: r.tier === "sagaMonke" ? "monke" : r.tier };
  }
  return { error: "proof required", status: 401 };
}

async function getRec(env: Env, code: string): Promise<CodeRec | null> {
  const raw = await env.REFERRALS!.get(`code:${code}`);
  return raw ? (JSON.parse(raw) as CodeRec) : null;
}
const putRec = (env: Env, code: string, r: CodeRec) => env.REFERRALS!.put(`code:${code}`, JSON.stringify(r));

async function activeSeason(env: Env): Promise<Season | null> {
  try {
    const s = JSON.parse((await env.REFERRALS!.get("season")) ?? "null") as Season | null;
    return s && typeof s.id === "string" && Date.now() >= s.start && Date.now() < s.end ? s : null;
  } catch {
    return null;
  }
}

async function ownCode(env: Env, ownerId: string): Promise<string> {
  const have = await env.REFERRALS!.get(`owner:${ownerId}`);
  if (have) return have;
  for (let i = 0; i < 8; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const code = Array.from(bytes, (b) => ALPHABET[b % 32]).join("");
    if (await env.REFERRALS!.get(`code:${code}`)) continue;
    await putRec(env, code, { o: ownerId, n: "", p: null, t: Date.now(), c: 0, k: 0 });
    await env.REFERRALS!.put(`owner:${ownerId}`, code);
    return code;
  }
  throw new Error("no free code");
}

/** Bot's view of the wallet: null = never seen, 0 = already known when tracking began, else ms. */
async function botFirstSeen(env: Env, wallet: string): Promise<number | null | "unreachable"> {
  const base = (env.BOT_PROFILE_URL ?? "").replace(/\/$/, "");
  if (!base || !env.BOT_HTTP_SECRET) return "unreachable";
  try {
    const res = await fetch(`${base}/referral-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.BOT_HTTP_SECRET}` },
      body: JSON.stringify({ wallet }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return "unreachable";
    const d = (await res.json()) as { firstSeen?: number | null };
    return typeof d.firstSeen === "number" ? d.firstSeen : null;
  } catch {
    return "unreachable";
  }
}

async function readBody(request: Request): Promise<any> {
  try { return await request.json(); } catch { return null; }
}

async function me(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request);
  const id = await who(env, body?.proof, "me");
  if ("error" in id) return json({ error: id.error }, id.status);
  if (id.tier !== "monke") return json({ error: "Referrals are for Saga Monke holders", reason: "not_holder" }, 403);
  const ownerId = await idFor(id.wallet);
  const code = await ownCode(env, ownerId);
  const rec = (await getRec(env, code))!;
  const name = body?.name !== undefined ? cleanName(body.name) : rec.n;
  const pfp = body?.pfp !== undefined ? cleanPfp(body.pfp) : rec.p;
  if (name !== rec.n || pfp !== rec.p) { rec.n = name; rec.p = pfp; await putRec(env, code, rec); }
  const season = await activeSeason(env);
  const seasonCount = season ? parseInt((await env.REFERRALS!.get(`s:${season.id}:${code}`)) ?? "0", 10) || 0 : 0;
  return json({
    code,
    url: `${SITE}/r/${code}`,
    card: `${SITE}/r/${code}/card.png?v=${await cardVersion(rec)}`,
    name: displayName(rec),
    referred: rec.c,
    pending: Math.max(0, rec.c - rec.k) * REFERRER_BANANAS,
    badges: BADGES.filter((b) => rec.c >= b),
    nextBadge: BADGES.find((b) => rec.c < b) ?? null,
    rewards: { referrer: REFERRER_BANANAS, newHolder: NEW_HOLDER_BANANAS },
    season: season ? { id: season.id, end: season.end, count: seasonCount } : null,
  });
}

async function collect(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request);
  const id = await who(env, body?.proof, "collect");
  if ("error" in id) return json({ error: id.error }, id.status);
  const code = await env.REFERRALS!.get(`owner:${await idFor(id.wallet)}`);
  const rec = code ? await getRec(env, code) : null;
  if (!code || !rec || rec.c <= rec.k) return json({ bananas: 0 });
  const n = rec.c - rec.k;
  rec.k = rec.c; // mark first: a lost reply costs bananas, a retry never doubles them
  await putRec(env, code, rec);
  return json({ bananas: n * REFERRER_BANANAS, referrals: n });
}

async function claim(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (env.WEB_RPC_LIMITER && !(await env.WEB_RPC_LIMITER.limit({ key: `ref:${ip}` })).success) return json({ error: "Too many tries — wait a minute", reason: "rate" }, 429);
  const body = await readBody(request);
  const code = String(body?.code ?? "").toUpperCase().trim();
  if (!CODE.test(code)) return json({ error: "That invite code isn't valid", reason: "unknown_code" }, 400);
  const id = await who(env, body?.proof, `claim:${code}`);
  if ("error" in id) return json({ error: id.error }, id.status);
  if (id.tier !== "monke") return json({ error: "Invites count for Saga Monke holders", reason: "not_holder" }, 403);
  const rec = await getRec(env, code);
  if (!rec) return json({ error: "That invite code isn't valid", reason: "unknown_code" }, 404);
  const refereeId = await idFor(id.wallet);
  if (rec.o === refereeId) return json({ error: "That's your own invite", reason: "own_code" }, 409);
  const prior = await env.REFERRALS!.get(`by:${refereeId}`);
  if (prior) {
    const p = JSON.parse(prior) as { c: string };
    return p.c === code ? json({ ok: true, already: true, bananas: 0, name: displayName(rec) }) : json({ error: "You were already invited by someone else", reason: "already_referred" }, 409);
  }
  const seen = await botFirstSeen(env, id.wallet);
  if (seen === "unreachable") return json({ error: "Couldn't check right now — try again in a minute", reason: "try_later" }, 503);
  if (seen === 0 || (seen !== null && Date.now() - seen > NEW_WINDOW_MS)) return json({ error: "Invites are for new members — you were already here", reason: "not_new" }, 409);

  await env.REFERRALS!.put(`by:${refereeId}`, JSON.stringify({ c: code, t: Date.now() }));
  rec.c += 1;
  await putRec(env, code, rec);
  const season = await activeSeason(env);
  if (season) {
    const k = `s:${season.id}:${code}`;
    await env.REFERRALS!.put(k, String((parseInt((await env.REFERRALS!.get(k)) ?? "0", 10) || 0) + 1));
  }
  return json({ ok: true, bananas: NEW_HOLDER_BANANAS, name: displayName(rec) });
}

async function leaderboard(env: Env): Promise<{ season: Season | null; top: { name: string; pfp: number | null; count: number }[] }> {
  const season = await activeSeason(env);
  if (!season) return { season: null, top: [] };
  const counts: { code: string; count: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.REFERRALS!.list({ prefix: `s:${season.id}:`, cursor });
    for (const k of page.keys) counts.push({ code: k.name.split(":")[2], count: parseInt((await env.REFERRALS!.get(k.name)) ?? "0", 10) || 0 });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  counts.sort((a, b) => b.count - a.count);
  const top = [];
  for (const c of counts.slice(0, 10)) {
    const r = await getRec(env, c.code);
    if (r) top.push({ name: displayName(r), pfp: r.p, count: c.count });
  }
  return { season, top };
}

// ── Card + pages ──

async function inviteCard(code: string, rec: CodeRec): Promise<{ png: Uint8Array; complete: boolean }> {
  const c = new Canvas(BG);
  const cell = 33, ax = 51, ay = 51;
  c.rect(ax - 6, ay - 6, 16 * cell + 12, 16 * cell + 12, ACCENT);
  const art = rec.p ? await readArt(monkeImageForNumber(rec.p)!) : null;
  if (art) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.rect(ax + x * cell, ay + y * cell, cell, cell, art[y][x]);
  else { c.rect(ax, ay, 16 * cell, 16 * cell, [30, 30, 40]); c.text("?", ax + 8 * cell - 45, ay + 8 * cell - 63, 18, MUTED); }

  const tx = 648, maxW = W - tx - 40;
  const name = displayName(rec).toUpperCase();
  const ns = Math.max(3, Math.min(8, Math.floor((maxW + 8) / (name.length * 6))));
  c.text(name, tx, 70, ns, TEXT);
  c.text("INVITES YOU TO", tx, 70 + 7 * ns + 26, 4, MUTED);
  c.text("ONLYMONKES", tx, 70 + 7 * ns + 70, 8, ACCENT);

  const url = `${SITE}/r/${code}`;
  const qr = qrCreate(url, { errorCorrectionLevel: "M" }).modules;
  const q = 6, quiet = 4, size = (qr.size + quiet * 2) * q, qy = 300;
  c.rect(tx, qy, size, size, TEXT);
  for (let r = 0; r < qr.size; r++) for (let k = 0; k < qr.size; k++) if (qr.get(r, k)) c.rect(tx + (k + quiet) * q, qy + (r + quiet) * q, q, q, BG);
  c.text("SCAN", tx + size + 30, qy + 40, 5, TEXT);
  c.text("TO JOIN", tx + size + 30, qy + 90, 5, TEXT);
  const short = `ONLYMONKES.APP/R/${code}`;
  c.text(short, tx, qy + size + 24, Math.min(3, Math.floor((maxW + 3) / (short.length * 6))), MUTED);
  return { png: await encodePng(c.px), complete: !rec.p || !!art };
}

function page(title: string, desc: string, path: string, image: string, inner: string): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${SITE}${path}"><meta property="og:type" content="website"><meta property="og:site_name" content="OnlyMonkes">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(image)}">
<style>
:root{--bg:#0A0A0F;--text:#EDEDF3;--muted:#9A9AB0;--accent:#e91671;--line:rgba(255,255,255,.12);--card:rgba(255,255,255,.04)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:24px 16px 48px;text-align:center}
img.card{width:100%;height:auto;border-radius:16px;image-rendering:pixelated;display:block}
h1{font-size:26px;margin:20px 0 6px}p{color:var(--muted);margin:0 0 20px}
.b{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
a.btn{display:inline-block;padding:12px 18px;border-radius:12px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
a.ghost{background:transparent;border:1px solid var(--line);color:var(--text)}
ol{list-style:none;padding:0;margin:0;display:grid;gap:8px;text-align:left}
li{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 14px}
li img{width:40px;height:40px;border-radius:8px;image-rendering:pixelated}li b{flex:1}li span{color:var(--muted)}
</style></head><body><main>${inner}</main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120" } });
}

async function invitePage(code: string, rec: CodeRec): Promise<Response> {
  const name = displayName(rec);
  const card = `${SITE}/r/${code}/card.png?v=${await cardVersion(rec)}`;
  const intent = `intent://invite/${code}#Intent;scheme=onlymonkes;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(`${SITE}/get`)};end`;
  const title = `${name} invites you to OnlyMonkes`;
  const desc = "The app for Saga Monkes holders: encrypted chat, trade alerts, the marketplace and more. Join with this invite and you both get bananas.";
  return page(title, desc, `/r/${code}`, card, `
<img class="card" src="${esc(card)}" width="1200" height="630" alt="${esc(name)}'s invite to OnlyMonkes">
<h1>${esc(name)} invites you</h1>
<p>Join OnlyMonkes with a Saga Monke and you both get bananas. Code <b>${code}</b>.</p>
<div class="b">
<a class="btn" id="app" href="${esc(intent)}">Open in OnlyMonkes</a>
<a class="btn ghost" href="${SITE}/get">Get the app</a>
<a class="btn ghost" href="${SITE}/?ref=${code}">Use the web app</a>
</div>
<p style="margin-top:18px;font-size:14px">New to the app? Install it, then open this link again or enter code <b>${code}</b> in the app.</p>
<script>if(!/Android/i.test(navigator.userAgent))document.getElementById('app').style.display='none';</script>`);
}

async function leaderboardPage(env: Env): Promise<Response> {
  const { season, top } = await leaderboard(env);
  const inner = season
    ? `<h1>Top recruiters · ${esc(season.id)}</h1><p>Invite new Saga Monke holders. The season ends ${new Date(season.end).toUTCString().slice(5, 16)}.</p>
<ol>${top.map((t, i) => `<li>${t.pfp ? `<img src="${esc(monkeImageForNumber(t.pfp)!)}" alt="">` : ""}<b>${i + 1}. ${esc(t.name)}</b><span>${t.count}</span></li>`).join("") || "<p>No invites yet this season.</p>"}</ol>`
    : `<h1>Referral seasons</h1><p>Invite new Saga Monke holders to OnlyMonkes: you get ${REFERRER_BANANAS} bananas and they get ${NEW_HOLDER_BANANAS}. Monthly seasons with a prize for the top recruiter start soon.</p>`;
  return page("OnlyMonkes referrals", "Invite new Saga Monke holders to OnlyMonkes and earn bananas.", "/referrals", `${SITE}/site/og.png`, inner + `<div class="b" style="margin-top:20px"><a class="btn" href="${SITE}/get">Get OnlyMonkes</a></div>`);
}

export async function handleReferral(path: string, request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
  if (!env.REFERRALS) return json({ error: "referrals unavailable" }, 503);
  const m = request.method;
  if (path === "/api/referral/me" && m === "POST") return me(request, env);
  if (path === "/api/referral/collect" && m === "POST") return collect(request, env);
  if (path === "/api/referral/claim" && m === "POST") return claim(request, env);
  if (m !== "GET" && m !== "HEAD") return json({ error: "method not allowed" }, 405);
  const head = (r: Response) => (m === "HEAD" ? new Response(null, { status: r.status, headers: r.headers }) : r);

  const cm = path.match(/^\/api\/referral\/code\/([^/]+)$/);
  if (cm) {
    const code = cm[1].toUpperCase();
    const rec = CODE.test(code) ? await getRec(env, code) : null;
    return head(rec ? json({ code, name: displayName(rec), pfp: rec.p }) : json({ error: "That invite code isn't valid" }, 404));
  }
  if (path === "/api/referral/leaderboard") return head(json(await leaderboard(env)));
  if (path === "/referrals" || path === "/referrals/") return head(await leaderboardPage(env));

  const pm = path.match(/^\/r\/([^/]+?)(\/card\.png)?\/?$/);
  if (!pm) return json({ error: "not found" }, 404);
  const code = pm[1].toUpperCase();
  const rec = CODE.test(code) ? await getRec(env, code) : null;
  if (!rec) return head(new Response("This invite doesn't exist", { status: 404, headers: { "Content-Type": "text/plain" } }));
  if (!pm[2]) return head(await invitePage(code, rec));

  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`${SITE}/r/${code}/card.png?v=${await cardVersion(rec)}`, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return head(hit);
  // A card whose PFP art didn't load (Arweave hiccup) is only cached briefly.
  const card = await inviteCard(code, rec);
  const res = new Response(card.png, { headers: { "Content-Type": "image/png", "Cache-Control": card.complete ? "public, max-age=86400" : "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
  if (card.complete) ctx.waitUntil(cache.put(key, res.clone()).catch(() => {}));
  return head(res);
}
