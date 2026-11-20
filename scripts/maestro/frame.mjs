// Frames Maestro shots for the dApp Store: caption + rounded phone on the brand gradient.
// SHARP_FROM=<dir with node_modules/sharp>/ FONTCONFIG_FILE=<conf that adds assets/fonts (Fredoka)> \
//   node scripts/maestro/frame.mjs scripts/maestro/out/com.onlymonkes.app dapp-store/assets/screenshots
import { createRequire } from "module";
const require = createRequire(process.env.SHARP_FROM || process.cwd() + "/");
const sharp = require("sharp");
const [, , inDir, outDir] = process.argv;
const W = 1200, H = 2600, SW = 960, R = 56, TOP = 430;
const shots = [
  ["01-main-chat", "Chat with every", "Saga Monke holder"],
  ["02-monkecaves", "Blast through", "MonkeCaves"],
  ["03-monkekart", "A new MonkeKart", "track every day"],
  ["05-globe", "Holders & events", "around the globe"],
  ["06-trades", "AI Agent #9385", "calls the trades"],
  ["08-genesis", "Genesis Chat for", "Genesis holders"],
  ["04-monke3d", "Your monke", "in 3D"],
];
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
let i = 0;
for (const [name, l1, l2] of shots) {
  i++;
  const img = sharp(`${inDir}/${name}.png`);
  const meta = await img.metadata();
  const SH = Math.round(meta.height * SW / meta.width);
  const mask = Buffer.from(`<svg width="${SW}" height="${SH}"><rect width="${SW}" height="${SH}" rx="${R}" ry="${R}"/></svg>`);
  const phone = await img.resize(SW, SH).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const x = (W - SW) / 2;
  const bg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stop-color="#14345C"/><stop offset="0.55" stop-color="#0B1426"/><stop offset="1" stop-color="#2A1450"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.12" r="0.6"><stop offset="0" stop-color="#6CB4EE" stop-opacity="0.35"/><stop offset="1" stop-color="#6CB4EE" stop-opacity="0"/></radialGradient>
      <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="28"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>
    <text x="${W / 2}" y="190" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="96" fill="#FFFFFF">${esc(l1)}</text>
    <text x="${W / 2}" y="310" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="96" fill="#FFD23F">${esc(l2)}</text>
    <rect x="${x}" y="${TOP + 24}" width="${SW}" height="${SH}" rx="${R}" fill="#000" opacity="0.55" filter="url(#sh)"/>
    <rect x="${x - 6}" y="${TOP - 6}" width="${SW + 12}" height="${SH + 12}" rx="${R + 6}" fill="none" stroke="#6CB4EE" stroke-opacity="0.45" stroke-width="4"/>
  </svg>`);
  const out = `${outDir}/screenshot_${i}.png`;
  await sharp(bg).composite([{ input: phone, left: x, top: TOP }]).png({ compressionLevel: 9 }).toFile(out);
  console.log(out, SH);
}
