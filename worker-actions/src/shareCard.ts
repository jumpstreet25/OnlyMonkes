/**
 * "Share your Monke" cards (2026-10-24).
 *
 *   GET /monke/<number>            share page (OG/Twitter tags point at the card)
 *   GET /monke/<number>/card.png   1200×630 card: the monke's real on-chain
 *                                  16×16 art, every pixel kept square, plus a
 *                                  pixel-font caption
 *
 * Numbers only; /monke/<mint> keeps its old page. The art never changes, so a
 * card is built once and then served from the edge cache for a year. The PNG
 * encoder below uses the runtime's native deflate, so a card costs a few
 * milliseconds of CPU (rows are built once per art row and copied).
 */
import { PhotonImage } from "@cf-wasm/photon/workerd";

const SITE = "https://onlymonkes.app";
const BASE_A = "https://arweave.net/8bJFg1KcX8M_ahz3wJplqdG4-8we_Ts1pTSi5wephHE";
const BASE_B = "https://arweave.net/2x92sGwXGIDCumAN1vawXd6CitHeqyjuZ1fUWOVmfsY";
const GIFS = new Set([8986, 8987, 8988]);
const BURNED = new Set([411, 2976, 3109, 3140, 3850, 3970, 4747, 4979, 5203, 5363, 5462, 5952, 6692, 6797, 7894]);

/** Same table as src/lib/monkeMeme/monkeNumbers.ts. */
export function monkeImageForNumber(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 10014 || BURNED.has(n)) return null;
  return `${n >= 8989 ? BASE_B : BASE_A}/${n}.${GIFS.has(n) ? "gif" : "png"}`;
}

const CARD_PATH = /^\/monke\/(\d{1,5})\/card\.png$/;
const PAGE_PATH = /^\/monke\/(\d{1,5})\/?$/;
export function isShareCardPath(path: string): boolean {
  return CARD_PATH.test(path) || PAGE_PATH.test(path);
}

// ── Pixel font (5×7) ──
const GLYPHS: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  _: ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

export type RGB = [number, number, number];
export const W = 1200, H = 630;
export const BG: RGB = [10, 10, 15];
export const ACCENT: RGB = [233, 22, 113];
export const TEXT: RGB = [237, 237, 243];
export const MUTED: RGB = [154, 154, 176];

/** Pixel-font capable 1200×630 RGB canvas (text is drawn upper-case; unknown characters are blanks). */
export class Canvas {
  px = new Uint8Array(W * H * 3);
  constructor(bg: RGB) { for (let i = 0; i < W * H; i++) this.px.set(bg, i * 3); }
  rect(x: number, y: number, w: number, h: number, c: RGB) {
    const x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
    if (x >= x1) return;
    const row = new Uint8Array((x1 - x) * 3);
    for (let i = 0; i < x1 - x; i++) row.set(c, i * 3);
    for (let yy = Math.max(0, y); yy < y1; yy++) this.px.set(row, (yy * W + x) * 3);
  }
  text(s: string, x: number, y: number, scale: number, c: RGB) {
    for (const ch of s) {
      const g = GLYPHS[ch.toUpperCase()] ?? GLYPHS[" "];
      for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) if (g[r][k] === "1") this.rect(x + k * scale, y + r * scale, scale, scale, c);
      x += 6 * scale;
    }
  }
}
export const textWidth = (s: string, scale: number) => s.length * 6 * scale - scale;

// ── PNG (truecolour, native deflate) ──
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
export async function encodePng(px: Uint8Array): Promise<Uint8Array> {
  const raw = new Uint8Array(H * (1 + W * 3));
  for (let y = 0; y < H; y++) raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1); // filter 0
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, W); v.setUint32(4, H);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** The 16×16 art: centre sample of each cell of the on-chain image. */
export async function readArt(url: string): Promise<RGB[][] | null> {
  // Arweave's gateway answers 403 to requests without a User-Agent.
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "OnlyMonkes-ShareCard/1.0 (+https://onlymonkes.app)" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  let img: PhotonImage | undefined;
  try {
    img = PhotonImage.new_from_byteslice(new Uint8Array(await res.arrayBuffer()));
    const w = img.get_width(), h = img.get_height();
    const raw = img.get_raw_pixels(); // RGBA
    const grid: RGB[][] = [];
    for (let y = 0; y < 16; y++) {
      const row: RGB[] = [];
      for (let x = 0; x < 16; x++) {
        const i = (Math.floor((y + 0.5) * (h / 16)) * w + Math.floor((x + 0.5) * (w / 16))) * 4;
        row.push([raw[i], raw[i + 1], raw[i + 2]]);
      }
      grid.push(row);
    }
    return grid;
  } catch {
    return null;
  } finally {
    img?.free();
  }
}

async function buildCard(n: number, art: RGB[][] | null): Promise<Uint8Array> {
  const c = new Canvas(BG);
  // Art panel: 16 × 33 px = 528, square pixels, on the left.
  const cell = 33, ax = 51, ay = 51;
  c.rect(ax - 6, ay - 6, 16 * cell + 12, 16 * cell + 12, ACCENT);
  if (art) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.rect(ax + x * cell, ay + y * cell, cell, cell, art[y][x]);
  else c.rect(ax, ay, 16 * cell, 16 * cell, [30, 30, 40]);
  // Caption, right column, in the same pixel style.
  const tx = 648;
  c.text("SAGA MONKE", tx, 150, 8, TEXT);
  const num = `#${n}`;
  c.text(num, tx, 245, 16, ACCENT);
  c.rect(tx, 400, Math.min(textWidth("ONLYMONKES.APP", 6), W - tx - 40), 6, ACCENT);
  c.text("ONLYMONKES.APP", tx, 430, 6, MUTED);
  return encodePng(c.px);
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

function sharePage(n: number): Response {
  const title = `Saga Monke #${n} on OnlyMonkes`;
  const desc = "Saga Monkes holders chat, trade and hang out on OnlyMonkes, the Solana Mobile dApp.";
  const page = `${SITE}/monke/${n}`;
  const card = `${SITE}/monke/${n}/card.png`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${card}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${page}"><meta property="og:type" content="website"><meta property="og:site_name" content="OnlyMonkes">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${card}">
<link rel="canonical" href="${page}">
<style>
:root{--bg:#0A0A0F;--text:#EDEDF3;--muted:#9A9AB0;--accent:#e91671;--line:rgba(255,255,255,.12)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:24px 16px 48px;text-align:center}
img{width:100%;height:auto;border-radius:16px;image-rendering:pixelated;display:block}
h1{font-size:26px;margin:20px 0 6px}p{color:var(--muted);margin:0 0 24px}
.b{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
a.btn{display:inline-block;padding:12px 18px;border-radius:12px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
a.ghost{background:transparent;border:1px solid var(--line);color:var(--text)}
</style></head><body><main>
<img src="${card}" width="1200" height="630" alt="Saga Monke #${n}, pixel art">
<h1>Saga Monke #${n}</h1>
<p>${esc(desc)}</p>
<div class="b">
<a class="btn" href="${SITE}/get">Get OnlyMonkes</a>
<a class="btn ghost" href="${SITE}/">Open the web app</a>
<a class="btn ghost" href="${SITE}/viewer/monke3d?n=${n}">See it in 3D</a>
</div>
</main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

export async function handleShareCard(path: string, request: Request, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const m = path.match(CARD_PATH) ?? path.match(PAGE_PATH)!;
  const n = parseInt(m[1], 10);
  const url = monkeImageForNumber(n);
  if (!url) return new Response("Not a live Saga Monke", { status: 404, headers: { "Content-Type": "text/plain" } });
  const head = (r: Response) => (request.method === "HEAD" ? new Response(null, { status: r.status, headers: r.headers }) : r);
  if (!CARD_PATH.test(path)) return head(sharePage(n));

  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`${SITE}/monke/${n}/card.png`, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return head(hit);
  const art = await readArt(url);
  const png = await buildCard(n, art);
  // Without the art (Arweave hiccup, or one of the 3 animated 1/1s) the card
  // is a placeholder: cache it briefly so the real one replaces it.
  const res = new Response(png, {
    headers: { "Content-Type": "image/png", "Cache-Control": art ? "public, max-age=31536000, immutable" : "public, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
  if (art) ctx.waitUntil(cache.put(key, res.clone()).catch(() => {}));
  return head(res);
}
