// dApp Store feature graphic (1200x1200): same look as banner.mjs, logo + tagline over five phones.
// Run from the repo root: SHARP_FROM=<dir with node_modules/sharp>/ FONTCONFIG_FILE=<conf adding assets/fonts> node scripts/maestro/graphic.mjs out.png
import { createRequire } from "module";
const require = createRequire(process.env.SHARP_FROM || process.cwd() + "/");
const sharp = require("sharp");
const R3 = process.cwd(), SHOTS = R3 + "/scripts/maestro/out/com.onlymonkes.app";
const [, , out] = process.argv;
const W = 1200, H = 1200;

const logo = await sharp(R3 + "/assets/Header-transparent.png").trim().resize({ width: 620 }).png().toBuffer();
const lm = await sharp(logo).metadata();

async function phone(name, w, angle) {
  const m = await sharp(`${SHOTS}/${name}.png`).metadata();
  const h = Math.round(m.height * w / m.width), r = Math.round(w * 0.075), b = 7;
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}"/></svg>`);
  const screen = await sharp(`${SHOTS}/${name}.png`).resize(w, h).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const body = Buffer.from(`<svg width="${w + 2 * b}" height="${h + 2 * b}"><rect width="${w + 2 * b}" height="${h + 2 * b}" rx="${r + b}" fill="#0A0F1C" stroke="#6CB4EE" stroke-opacity="0.55" stroke-width="3"/></svg>`);
  const framed = await sharp(body).composite([{ input: screen, left: b, top: b }]).png().toBuffer();
  return sharp(framed).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}
const pw = 196;
const shots = [["02-monkecaves", -12, 140], ["03-monkekart", -7, 60], ["01-main-chat", 0, 0], ["05-globe", 7, 60], ["06-trades", 12, 140]];
const phones = await Promise.all(shots.map(([n, a], i) => phone(n, i === 2 ? pw + 28 : pw, a)));
const metas = await Promise.all(phones.map((p) => sharp(p).metadata()));

const bg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14345C"/><stop offset="0.55" stop-color="#0B1426"/><stop offset="1" stop-color="#2A1450"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.78" r="0.55"><stop offset="0" stop-color="#6CB4EE" stop-opacity="0.38"/><stop offset="1" stop-color="#6CB4EE" stop-opacity="0"/></radialGradient>
    <radialGradient id="glow2" cx="0.5" cy="0.15" r="0.45"><stop offset="0" stop-color="#7C3AED" stop-opacity="0.25"/><stop offset="1" stop-color="#7C3AED" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#glow)"/><rect width="${W}" height="${H}" fill="url(#glow2)"/>
  <text x="600" y="${70 + lm.height + 78}" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="54" fill="#FFFFFF">Chat, play &amp; trade</text>
  <text x="600" y="${70 + lm.height + 144}" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="54" fill="#FFD23F">with Saga Monkes holders</text>
  <text x="600" y="${70 + lm.height + 200}" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="22" fill="#9CC8F0" letter-spacing="1.5">MONKECAVES · MONKEKART · AVATAR ROOMS · AI AGENT</text>
</svg>`);
const top = 70 + lm.height + 250, xs = [175, 388, 600, 812, 1025], order = [0, 4, 1, 3, 2];
await sharp(bg).composite([
  { input: logo, left: Math.round(600 - lm.width / 2), top: 70 },
  ...order.map((i) => ({ input: phones[i], left: Math.round(xs[i] - metas[i].width / 2), top: top + shots[i][2] })),
]).png({ compressionLevel: 9 }).toFile(out);
console.log("ok", lm.width, lm.height, metas[2].height, top + metas[2].height);
