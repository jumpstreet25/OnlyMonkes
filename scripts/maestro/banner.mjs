// dApp Store banner (1200x600): logo + tagline + three phones from the Maestro shots.
// Run from the repo root: SHARP_FROM=<dir with node_modules/sharp>/ FONTCONFIG_FILE=<conf adding assets/fonts> node scripts/maestro/banner.mjs out.png
import { createRequire } from "module";
const require = createRequire(process.env.SHARP_FROM || process.cwd() + "/");
const sharp = require("sharp");
const R3 = process.cwd(), SHOTS = R3 + "/scripts/maestro/out/com.onlymonkes.app";
const [, , out] = process.argv;
const W = 1200, H = 600;

const logo = await sharp(R3 + "/assets/Header-transparent.png").trim().resize({ width: 500 }).png().toBuffer();
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
const pw = 168;
const pL = await phone("03-monkekart", pw, -9), pC = await phone("01-main-chat", pw + 20, 0), pR = await phone("02-monkecaves", pw, 9);
const meta = async (b) => sharp(b).metadata();
const [mL, mC, mR] = await Promise.all([meta(pL), meta(pC), meta(pR)]);

const bg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14345C"/><stop offset="0.55" stop-color="#0B1426"/><stop offset="1" stop-color="#2A1450"/></linearGradient>
    <radialGradient id="glow" cx="0.78" cy="0.5" r="0.5"><stop offset="0" stop-color="#6CB4EE" stop-opacity="0.38"/><stop offset="1" stop-color="#6CB4EE" stop-opacity="0"/></radialGradient>
    <radialGradient id="glow2" cx="0.2" cy="0.35" r="0.4"><stop offset="0" stop-color="#7C3AED" stop-opacity="0.25"/><stop offset="1" stop-color="#7C3AED" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#glow)"/><rect width="${W}" height="${H}" fill="url(#glow2)"/>
  <text x="64" y="${130 + lm.height + 72}" font-family="Fredoka" font-weight="700" font-size="42" fill="#FFFFFF">Chat, play &amp; trade</text>
  <text x="64" y="${130 + lm.height + 124}" font-family="Fredoka" font-weight="700" font-size="42" fill="#FFD23F">with Saga Monkes holders</text>
  <text x="66" y="${130 + lm.height + 178}" font-family="Fredoka" font-weight="700" font-size="20" fill="#9CC8F0" letter-spacing="1.5">MONKECAVES · MONKEKART · AVATAR ROOMS · AI AGENT</text>
</svg>`);
const cx = 938, top = 92;
await sharp(bg).composite([
  { input: logo, left: 56, top: 130 },
  { input: pL, left: Math.round(cx - 132 - mL.width / 2), top: top + 34 },
  { input: pR, left: Math.round(cx + 132 - mR.width / 2), top: top + 34 },
  { input: pC, left: Math.round(cx - mC.width / 2), top: top },
]).png({ compressionLevel: 9 }).toFile(out);
console.log("ok", lm.width, lm.height, mC.height);
