// MonkeCaves Big Tech enemies: sprites (16×16 character maps, two frames each)
// and their numbers. caves.js does the moving, shooting and drawing.
//   Tracking Cookie  c  tiny, fast, comes in swarms, dies in one hit
//   Notification Bat n  a winged bell; pings when it spots you, then zigzags in
//   Pop-up Ad        a  floats at range and fires X's; up close it covers your screen
//   Gatekeeper       K  padlock shield in front — shots from the front bounce; flank it (6 hits break the padlock)
//   Algorithm Eye    E  never moves, tracks you and fires slow beams

export const FOE_PAL = {
  k: [16, 14, 20], w: [245, 245, 250], r: [225, 50, 60], R: [150, 24, 34],
  t: [206, 152, 84], T: [150, 98, 48], c: [62, 36, 22],
  y: [255, 210, 63], Y: [190, 140, 28], p: [150, 70, 210], P: [90, 36, 140],
  B: [44, 96, 210], g: [60, 190, 90], S: [62, 66, 84], o: [255, 140, 40],
};

const COOKIE = (legs) => [
  "................", ".....kkkkkk.....", "...kkttttttkk...", "..kttcttttcttk..", "..kttttttttTtk..", ".kttwwwttwwwttk.",
  ".ktwwkwttwkwwtk.", ".kttwwwttwwwtck.", ".kcttttttttttTk.", ".kTttkkkkkkttTk.", "..kTtkrrrrktTk..", "..kTTtkkkktTTk..",
  "...kkTTcTTTkk...", ".....kkkkkk.....",
  legs ? ".....kk..kk....." : "....kk....kk....", legs ? ".....kk..kk....." : "...kk......kk...",
];

const BAT_UP = [
  "................", "...........kkk..", "Pk....kk..krwrk.", "pPk..kyyk.krrrk.", "ppPkkyyyyk.kkk..", ".ppkyyyyyyk.kPp.",
  "..kyywyyyyyk.kpp", "..kyyyyyyyyykPp.", ".kyyyyyyyyyyyk..", ".kYYYYYYYYYYYk..", "..kkkkkkkkkkk...", ".....kYYYk......",
  "......kkk.......", "................", "................", "................",
];
const BAT_DOWN = [
  "................", "...........kkk..", "......kk..krwrk.", ".....kyyk.krrrk.", "....kyyyyk.kkk..", "...kyyyyyyk.....",
  "pPkyywyyyyykPp..", "ppkyyyyyyyyykpp.", "pkyyyyyyyyyyykp.", ".kYYYYYYYYYYYk..", "..kkkkkkkkkkk...", ".....kYYYk......",
  "......kkk.......", "................", "................", "................",
];

const AD = [
  "kkkkkkkkkkkkkkkk", "kBBBBBBBBBBkrwrk", "kBBBBBBBBBBkwrwk", "kBBBBBBBBBBkrwrk", "kkkkkkkkkkkkkkkk", "kwwwwwwwwwwwwwwk",
  "kwyyyyyyyyyyyywk", "kwyRyRyRRyRRyywk", "kwyyyyyyyyyyyywk", "kwwwwwwwwwwwwwwk", "kwwgggggggggwwwk", "kwwgwwgwgwggwwwk",
  "kwwgggggggggwwwk", "kwwwwwwwwwwwwwwk", "kkkkkkkkkkkkkkkk", "................",
];

const KEEPER = (legs, back) => [
  ".....kkkkkk.....", "....kSSSSSSk....", back ? "....kSSSSSSk...." : "....kSrrrrSk....", "....kSSSSSSk....", "...kkkSSSSkkk...",
  "..kSSSSSSSSSSk..",
  ...(back
    ? [".kSSSSSSSSSSSSk.", ".kSSSSSSSSSSSSk.", ".kSSSSSSSSSSSSk.", ".kSSSSSSSSSSSSk.", ".kSSSSSSSSSSSSk.", ".kSSSSSSSSSSSSk.", "..kSSSSSSSSSSk.."]
    : [".kSSkkkkkkkkSSk.", ".kSkyyyyyyyykSk.", ".kSkyykkkkyykSk.", ".kSkyykYYkyykSk.", ".kSkyyyyyyyykSk.", ".kSkyyykkyyykSk.", "..kkyyyyyyyykk.."]),
  "...kkkkkkkkkk...",
  legs ? "...kSSk...kSSk.." : "....kSSk.kSSk...", legs ? "...kkkk...kkkk.." : "....kkkk.kkkk...",
];

const EYE = (veins) => [
  "................", ".....kkkkkk.....", "...kkwwwwwwkk...", veins ? "..kwrwwwwwwrwk.." : "..kwwwwwwwwwwk..", ".kwwwwppppwwwwk.",
  ".kwwwppPPppwwwk.", "kwwwppPkkPppwwwk", "kwwwppPkkPppwwwk", ".kwwwppPPppwwwk.", ".kwwwwppppwwwwk.",
  veins ? "..kwrwwwwwwrwk.." : "..kwwwwwwwwwwk..", "...kkwwwwwwkk...", ".....kkkkkk.....", "......kSSk......", ".....kSSSSk.....", "....kkkkkkkk....",
];

export const XSHOT = [
  "................", "................", "................", "....kk....kk....", "...krrk..krrk...", "....krrkkrrk....",
  ".....krrrrk.....", ".....krrrrk.....", "....krrkkrrk....", "...krrk..krrk...", "....kk....kk....", "................",
  "................", "................", "................", "................",
];
export const BEAM = [
  "................", "................", "................", "................", "......kkkk......", ".....kppppk.....",
  "....kpPwwPpk....", "....kpwwwwpk....", "....kpPwwPpk....", ".....kppppk.....", "......kkkk......", "................",
  "................", "................", "................", "................",
];

// rows: two frames. back: Gatekeeper seen from behind (no shield). adPal: the ad's banner flashes orange.
export const FOE_ROWS = {
  cookie: [COOKIE(0), COOKIE(1)],
  bat: [BAT_UP, BAT_DOWN],
  ad: [AD, AD],
  keeper: [KEEPER(0, false), KEEPER(1, false)],
  keeperBack: [KEEPER(0, true), KEEPER(1, true)],
  eye: [EYE(false), EYE(true)],
};
export const AD_PAL2 = { ...FOE_PAL, y: [255, 140, 40] };

// One difficulty for everyone. hp = hits (every weapon does 1), speed in tiles/s,
// hit = damage per bite/shot before the cave multiplier (caves.js), r = hit radius.
export const FOES = {
  cookie: { hp: 1, speed: 2.9, hit: 5, cool: 0.55, r: 0.32, scale: 0.34 },
  bat: { hp: 2, speed: 2.2, hit: 7, cool: 0.8, r: 0.4, scale: 0.42, lift: 0.32 },
  ad: { hp: 3, speed: 1.3, hit: 7, cool: 1.6, r: 0.45, scale: 0.46, lift: 0.22, range: 9 },
  keeper: { hp: 5, speed: 1.1, hit: 12, cool: 1.4, r: 0.5, scale: 0.7, turn: 1.0 },
  eye: { hp: 5, speed: 0, hit: 8, cool: 2.6, r: 0.45, scale: 0.6, range: 12 },
};
export const FOE_LETTERS = { c: "cookie", n: "bat", a: "ad", K: "keeper", E: "eye" };
