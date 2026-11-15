// MonkeKart — the look of each day's track, picked from the date: seasons, and holidays on
// their days (owner 2026-11-14: "Daily tracks should be season related, holiday related").
// Looks only: the track shape and physics come from racer-sim.js and don't change with it.
// The race day is the player's local calendar date (3am→3am).

const JUNGLE = {
  key: "jungle", name: "JUNGLE",
  sky: ["#5fb2ff", "#bfe4ff", "#fff4d6"], fog: 0xcfe9f2, hemi: [0xdff1ff, 0x3a5a2a], sun: 0xfff1d0,
  hills: ["#7fae9a", "#3f7a4e"], grass: ["#3f8a3a", "#4a9a42", "#367a32", "#5aa94c"], dirt: ["#8a7148", "#7a6340", "#9a8156"],
  bamboo: ["#c9b45a", "#d8c66a", "#8f7b2c"], trunk: 0x7a5530, leaves: [0x2f7d2f], gateLeaf: 0x2f8a35,
  banana: 0xffd23f, banner: { text: "MONKE CAMP", bg: "#2f6a2c", fg: "#ffd23f" }, snow: 0, dust: 0,
};

const theme = (over) => ({ ...JUNGLE, ...over, banner: { ...JUNGLE.banner, ...(over.banner || {}) } });

const AUTUMN = theme({
  key: "autumn", name: "AUTUMN",
  sky: ["#7fa8d8", "#d6e2ee", "#ffe2b8"], fog: 0xe6dccb, hemi: [0xf2e6d6, 0x5a4a2a], sun: 0xffd9a0,
  hills: ["#b08a5a", "#8a4a26"], grass: ["#7a7a34", "#8a6a2c", "#6a6a2a", "#a07a30"],
  leaves: [0xd9541e, 0xe8a020, 0xb8301e, 0xc9781e], gateLeaf: 0xd9541e,
  banner: { text: "MONKE HARVEST", bg: "#8a3a1a", fg: "#ffd23f" },
});
const FIRST_SNOW = theme({
  key: "firstsnow", name: "FIRST SNOW",
  sky: ["#8aa6c8", "#d4dde8", "#eef0f2"], fog: 0xdfe6ee, hemi: [0xeef2f8, 0x6a6050], sun: 0xfff0dc,
  hills: ["#c8ccd4", "#8a6a4a"], grass: ["#7a7a44", "#e8eef4", "#6a6234", "#f4f6f8"], dirt: ["#8a7a64", "#e0e4ea", "#9a8a70"],
  leaves: [0xc9541e, 0xe09a2a, 0xa83a22, 0xf0f2f6], gateLeaf: 0xc9541e,
  banner: { text: "FIRST SNOW", bg: "#7a3a1e", fg: "#ffffff" }, snow: 900, dust: 0.25,
});
const WINTER = theme({
  key: "winter", name: "WINTER",
  sky: ["#7f9cc0", "#cfdbe8", "#f4f6f8"], fog: 0xe8eef4, hemi: [0xf4f8ff, 0x8a96a8], sun: 0xf4f6ff,
  hills: ["#e8eef4", "#b8c4d2"], grass: ["#eef2f6", "#ffffff", "#dde4ec", "#f6f8fa"], dirt: ["#c8d0da", "#b8c0ca", "#dde2e8"],
  bamboo: ["#b8c4d2", "#d4dce6", "#7a8698"], trunk: 0x5a4632, leaves: [0x2a5a3a, 0xeef2f6], gateLeaf: 0x2a5a3a,
  banner: { text: "MONKE SNOW DAY", bg: "#2a4a6a", fg: "#ffffff" }, snow: 1400, dust: 0,
});
const HOLIDAYS = theme({
  ...WINTER, key: "holidays", name: "HAPPY HOLIDAYS",
  leaves: [0x1e6a34, 0xeef2f6, 0x1e6a34], gateLeaf: 0x1e6a34, bamboo: ["#e0312b", "#f4f4f0", "#a0201a"],
  banner: { text: "HAPPY HOLIDAYS", bg: "#b0201a", fg: "#ffffff" }, snow: 1400,
});
const NEW_YEAR = theme({
  ...WINTER, key: "newyear", name: "NEW YEAR",
  sky: ["#0a0e2a", "#2a2a5a", "#5a4a7a"], fog: 0x2a2a4a, hemi: [0x8a8ac8, 0x2a2a3a], sun: 0xc8c8ff,
  banner: { text: "HAPPY NEW YEAR", bg: "#151530", fg: "#ffd23f" }, snow: 600,
});
const VALENTINE = theme({
  key: "valentine", name: "VALENTINE'S",
  sky: ["#ff9ac8", "#ffd4e6", "#fff0f6"], fog: 0xffe0ee, leaves: [0xff4f8a, 0xffa0c8, 0xe0306a], gateLeaf: 0xff4f8a,
  bamboo: ["#ff8ab8", "#ffc0d8", "#c0306a"], banana: 0xff4f8a, banner: { text: "MONKE LOVE", bg: "#c0306a", fg: "#ffffff" },
});
const ST_PATRICK = theme({
  key: "stpatrick", name: "ST. PATRICK'S",
  grass: ["#2a9a3a", "#3aba4a", "#1e7a2e", "#5aca5a"], leaves: [0x1eaa3a, 0x5ad05a], gateLeaf: 0x1eaa3a,
  bamboo: ["#ffd23f", "#2a9a3a", "#1e6a2a"], banner: { text: "LUCKY MONKE", bg: "#1e7a2e", fg: "#ffd23f" },
});
const SPRING = theme({
  key: "spring", name: "SPRING",
  sky: ["#6ab8ff", "#cfe8ff", "#fff8f0"], grass: ["#4aaa44", "#6aca5a", "#3a8a3a", "#8ad86a"],
  leaves: [0xffb0d0, 0xffd0e4, 0x4aaa44], gateLeaf: 0xff9ac8, banner: { text: "MONKE BLOOM", bg: "#3a8a3a", fg: "#ffd0e4" },
});
const JULY_4 = theme({
  key: "july4", name: "INDEPENDENCE DAY",
  bamboo: ["#e0312b", "#f4f4f0", "#1e3a8a"], leaves: [0x2f7d2f, 0x1e3a8a, 0xe0312b], banner: { text: "MONKE FREEDOM", bg: "#1e3a8a", fg: "#ffffff" },
});
const HALLOWEEN = theme({
  key: "halloween", name: "HALLOWEEN",
  sky: ["#1a0f2e", "#4a2a5a", "#e07a2a"], fog: 0x3a2a3a, hemi: [0xb08ac8, 0x2a1a1a], sun: 0xffa060,
  hills: ["#3a2a4a", "#1a1a1a"], grass: ["#3a3a24", "#4a3a20", "#2a2a1a", "#5a4a24"],
  leaves: [0xe07a1a, 0x5a2a6a, 0x1a1a1a], gateLeaf: 0xe07a1a, trunk: 0x2a1e14, banana: 0xff7a1a,
  bamboo: ["#4a3a2a", "#5a4a32", "#1a140e"], banner: { text: "MONKE SCREAM", bg: "#1a0f2e", fg: "#ff7a1a" },
});
const THANKSGIVING = theme({
  ...AUTUMN, key: "thanksgiving", name: "THANKSGIVING", banner: { text: "MONKE FEAST", bg: "#8a3a1a", fg: "#ffd23f" },
});

/** Fourth Thursday of November. */
const thanksgiving = (y) => { const d = new Date(Date.UTC(y, 10, 1)).getUTCDay(); return 1 + ((4 - d + 7) % 7) + 21; };

/** The theme for a race day id ("YYYY-MM-DD"). */
export function themeFor(id) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(id || "");
  if (!m) return JUNGLE;
  const y = +m[1], mo = +m[2], d = +m[3], md = mo * 100 + d;
  if (md === 1231 || md === 101) return NEW_YEAR;
  if (md >= 1218 && md <= 1226) return HOLIDAYS;
  if (md === 213 || md === 214) return VALENTINE;
  if (md === 316 || md === 317) return ST_PATRICK;
  if (md === 703 || md === 704) return JULY_4;
  if (md >= 1024 && md <= 1031) return HALLOWEEN;
  if (mo === 11 && Math.abs(d - thanksgiving(y)) <= 1) return THANKSGIVING;
  if (mo === 12 || mo <= 2) return WINTER;
  if (mo <= 5) return SPRING;
  if (md >= 922 && md <= 1109) return AUTUMN;
  if (md >= 1110) return FIRST_SNOW;
  return JUNGLE;
}
