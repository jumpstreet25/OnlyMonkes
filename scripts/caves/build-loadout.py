#!/usr/bin/env python3
"""MonkeCaves loadout: every monke number -> its weapon look.

Reads the MonkeMeme trait table, catalog and Wave 2 descriptions (src/lib/monkeMeme)
and writes public/viewer/caves-loadout.js. Every weapon plays the same (damage,
fire rate, shot speed live in caves.js); this file only picks the look:
  Wave 1      fur -> weapon, eyes -> shot colour
  AutonoMonke eyes -> weapon, head -> finish
  Wave 2      a relic matched to each 1/1's art (keyword rules below)
Usage: python3 scripts/caves/build-loadout.py [review.csv]
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MM = ROOT / "src/lib/monkeMeme"
table = re.search(r'TRAIT_TABLE =\s*"([^"]+)"', (MM / "traitTable.ts").read_text()).group(1)
cat = (MM / "traitCatalog.ts").read_text()
def keys(section):
    blk = re.search(section + r': \{(.*?)\n  \},', cat, re.S).group(1)
    return [m.group(1) or m.group(2) for m in re.finditer(r'^\s+(?:"([^"]+)"|([A-Za-z_]+)):', blk, re.M)]
FURS, HEADS, EYES = keys("Fur"), keys("Head"), keys("Eyes")
WAVE2 = {int(n): d for n, d in re.findall(r'(\d{4}): "([^"]+)"', (MM / "wave2Descriptions.ts").read_text())}

# held: t = frame shape, body/accent colours. shot: shape + colour ("rainbow" cycles).
BASE = {
    "blaster":  ("Banana Blaster",    {"t": "pistol", "body": "#ffd23f", "accent": "#6b4a1a"}, "bolt",  "#ffd23f"),
    "cannon":   ("Coconut Cannon",    {"t": "cannon", "body": "#6b4423", "accent": "#2a221c"}, "ball",  "#d9b38c"),
    "repeater": ("Peel Repeater",     {"t": "rifle",  "body": "#7a2e1c", "accent": "#ffd23f"}, "peel",  "#ffd23f"),
    "petal":    ("Petal Blaster",     {"t": "pistol", "body": "#f6a3c4", "accent": "#ff7aa8"}, "petal", "#ff8fb8"),
    "rot":      ("Rot Spitter",       {"t": "cannon", "body": "#6f8f4e", "accent": "#7dff4f"}, "goo",   "#7dff4f"),
    "staff":    ("Idol Staff",        {"t": "staff",  "body": "#c9971f", "accent": "#ffe27a"}, "orb",   "#ffe27a"),
    "rail":     ("Validator Railgun", {"t": "rifle",  "body": "#9945ff", "accent": "#14f195"}, "rail",  "#14f195"),
    "smg":      ("Overclock SMG",     {"t": "pistol", "body": "#4b525b", "accent": "#a6ff3c"}, "bolt",  "#a6ff3c"),
    "beam":     ("Terminal Beam",     {"t": "tube",   "body": "#4b525b", "accent": "#c8b6ff"}, "rail",  "#c8b6ff"),
    "daemon":   ("Daemon Railgun",    {"t": "rifle",  "body": "#4b525b", "accent": "#ff2d4a"}, "rail",  "#ff2d4a"),
    "servo":    ("Servo Launcher",    {"t": "tube",   "body": "#4b525b", "accent": "#cfd6de"}, "ball",  "#cfd6de"),
}
FUR_WEAPON = {"Mocha": "blaster", "Dark": "cannon", "Mahogany_": "repeater", "Cherry Blossom": "petal",
              "Zombie": "rot", "Gold Idol": "staff", "Solana": "rail"}
FUR_HAND = {"Mocha": "#7a5034", "Dark": "#46484f", "Mahogany_": "#6e2d1e", "Cherry Blossom": "#f0aabe",
            "AutonoMonke": "#969ba5", "Zombie": "#788c64", "Gold Idol": "#e6b428", "Solana": "#8c5ae6"}
EYE_COLOUR = {"Demon": "#ff2d4a", "Saylor Lasers": "#ff8a1f", "SolShades": "#b06bff", "Drywall Missiles": "rainbow"}
AUTO_WEAPON = {"Overclocked": "smg", "Terminal": "beam", "Daemon Trader": "daemon", "Open": "servo"}
AUTO_FINISH = {"Augmint": ("#aab4bf", "chrome"), "ToxiHawk": ("#e8379a", "pink"), "None": ("#4b525b", "gunmetal")}

COLOURS = [("neon-green|lime|toxic green", "#a6ff3c"), ("neon magenta|magenta|hot-pink|hot pink", "#ff3fb4"),
           ("electric-cyan|cyan|teal|mint", "#5ff2e0"), ("icy|ice|pale-blue|light-blue", "#9fe6ff"),
           ("periwinkle|blue", "#6e9bff"), ("lavender|violet|purple", "#b06bff"), ("pink", "#ff8fb8"),
           ("red", "#ff2d4a"), ("orange", "#ff8a1f"), ("yellow|gold|blonde", "#ffd23f"),
           ("green|olive", "#4fdc6a"), ("brown|tan|mocha", "#c08a5a"), ("white|ivory|cream|bone|chalk", "#f2f2f5"),
           ("gray|grey|slate|stone|silver", "#b9c0c8"), ("black|dark|navy|shadow", "#8f86ff")]
def colour_of(desc, default="#ffd23f"):
    for words, hexc in COLOURS:
        if re.search(r"\b(" + words + r")", desc, re.I): return hexc
    return default
# Body and hand take the monke's own colour: the first colour word in the art
# description (its fur), in a muted tone so the shot colour stands out.
TONES = [("black|dark|navy|charcoal|shadow", "#2c3140"), ("gray|grey|slate|stone|silver", "#6b7280"),
         ("white|ivory|cream|bone|chalk|pale", "#c9cbd3"), ("brown|tan|mocha", "#7a5034"), ("orange", "#b8622a"),
         ("yellow|gold|blonde", "#c9a12a"), ("lime|green|olive|mint|mossy", "#4f7a3c"), ("teal|cyan|icy|blue|periwinkle", "#3d6f9e"),
         ("purple|violet|lavender|mauve", "#6a4b9a"), ("pink|magenta|bubblegum", "#c0628e"), ("red", "#a2343c")]
def body_of(desc):
    best = None
    for words, hexc in TONES:
        m = re.search(r"\b(" + words + r")", desc, re.I)
        if m and (best is None or m.start() < best[0]): best = (m.start(), hexc)
    return best[1] if best else "#4b525b"

# Wave 2: first matching rule wins. (pattern, name, held frame, shot shape, colour or None = from the art)
RELIC_RULES = [
    (r"cyborg|robot|metal face|face plate|android", "Cyborg Arm Cannon", "cannon", "rail", None),
    (r"pirate", "Flintlock", "rifle", "ball", "#3a3a40"),
    (r"chef", "Cleaver", "blade", "blade", "#dfe6ee"),
    (r"knight", "Lance", "staff", "rail", "#e6ebf0"),
    (r"dragon", "Dragon Breath", "cannon", "fire", "#ff5a1f"),
    (r"racing", "Tyre Launcher", "tube", "ball", "#2a2a30"),
    (r"clown|red nose", "Pie Thrower", "pistol", "pie", "#ffe9c2"),
    (r"hard hat|safety vest", "Rivet Gun", "pistol", "bolt", "#cfd6de"),
    (r"lab coat|goggles", "Flask Lobber", "pistol", "goo", "#5ff2e0"),
    (r"skull|bone-mask", "Bone Thrower", "blade", "bone", "#f2f2f5"),
    (r"sombrero", "Chili Popper", "pistol", "fire", "#ff2d4a"),
    (r"mushroom", "Spore Gun", "pistol", "petal", "#ff2d4a"),
    (r"astronaut|space helmet", "Space Blaster", "tube", "rail", "#5ff2e0"),
    (r"fire elemental|flames|flame halo", "Flamethrower", "cannon", "fire", "#ff8a1f"),
    (r"lava|molten|embers", "Magma Cannon", "cannon", "fire", "#ff5a1f"),
    (r"banana monkey", "Golden Banana", "pistol", "bolt", "#ffd23f"),
    (r"alien|antenna", "Ray Gun", "tube", "rail", None),
    (r"slime|goo", "Goo Gun", "cannon", "goo", "#7dff4f"),
    (r"galaxy|cosmic|stardust|nebula", "Star Caster", "staff", "star", "#b06bff"),
    (r"crystal|icy|\bice\b", "Ice Shard", "staff", "shard", "#9fe6ff"),
    (r"stone|statue|carved|marble", "Pebble Sling", "pistol", "ball", "#b9c0c8"),
    (r"glitch|rgb|pixel noise", "Glitch Blaster", "rifle", "glitch", "rainbow"),
    (r"chalk|blueprint|sketch|highlighter|drawn|outline|crayon|\bink\b|doodle|mondrian", "Doodle Pen", "staff", "doodle", None),
    (r"devil|horns|demon", "Hellfire", "cannon", "fire", "#ff2d4a"),
    (r"zombie", "Rot Spitter", "cannon", "goo", "#7dff4f"),
    (r"shadow|ghost|spectral", "Shadow Orb", "staff", "orb", "#8f86ff"),
    (r"hood|ninja|tactical|face mask|camo", "Shuriken", "blade", "shuriken", "#b9c0c8"),
    (r"frog", "Fly Spitter", "pistol", "goo", "#a6ff3c"),
    (r"cat-eared", "Cat Claw", "blade", "shard", "#b06bff"),
    (r"moss|leafy|vines|flower|blossom|petals|buds", "Bloom Blaster", "pistol", "petal", None),
    (r"energy monkey|whole body glows|aura|electric", "Energy Beam", "tube", "rail", None),
    (r"gold", "Idol Staff", "staff", "orb", "#ffe27a"),
    (r"crown|halo", "Royal Scepter", "staff", "orb", "#ffd23f"),
    (r"glowing [a-z -]*eyes", "Eye Beam", "tube", "rail", "@eyes"),
    (r"visor|shades|glasses", "Visor Laser", "rifle", "rail", "@visor|shades|glasses"),
]
def colour_near(desc, words):
    m = re.search(r"([a-z-]+(?: [a-z-]+)?) (?:" + words + r")", desc, re.I)
    return colour_of(m.group(1), colour_of(desc)) if m else colour_of(desc)

variants, index = [], {}
def variant(v):
    key = json.dumps(v, sort_keys=True)
    if key not in index: index[key] = len(variants); variants.append(v)
    return index[key]
def base(wkey, hand, colour=None, body=None):
    name, held, shape, col = BASE[wkey]
    held = dict(held, hand=hand, **({"body": body} if body else {}))
    return {"name": name, "held": held, "shot": {"shape": shape, "color": colour or col}}

review = []
codes = []
for i in range(0, len(table), 5):
    n = i // 5 + 1; ch = table[i:i + 5]
    if n in WAVE2:
        d = WAVE2[n]
        for pat, name, frame, shape, col in RELIC_RULES:
            if re.search(pat, d, re.I): break
        else:
            name, frame, shape, col = "Banana Blaster", "pistol", "bolt", None
        c = colour_near(d, col[1:]) if col and col.startswith("@") else (col or colour_of(d))
        v = {"name": name, "relic": True, "held": {"t": frame, "body": body_of(d), "accent": c if c != "rainbow" else "#ff3fb4", "hand": body_of(d)},
             "shot": {"shape": shape, "color": c}}
        review.append((n, name, shape, c, d))
        codes.append(variant(v))
    elif ch[0] == "-":
        codes.append(-1)
    else:
        fur, head, eyes = FURS[int(ch[0], 36)], HEADS[int(ch[1], 36)], EYES[int(ch[2], 36)]
        if fur == "AutonoMonke":
            body, _ = AUTO_FINISH.get(head, AUTO_FINISH["None"])
            codes.append(variant(base(AUTO_WEAPON.get(eyes, "servo"), FUR_HAND[fur], body=body)))
        else:
            codes.append(variant(base(FUR_WEAPON[fur], FUR_HAND[fur], EYE_COLOUR.get(eyes))))
# Wave 2 numbers past the table (table covers 1..10014, so this is a guard only)
default = variant(base("blaster", "#7a5034"))
packed = "".join("--" if c < 0 else (format(c // 36, "x") if False else "") + "0123456789abcdefghijklmnopqrstuvwxyz"[c // 36] + "0123456789abcdefghijklmnopqrstuvwxyz"[c % 36] for c in codes)
assert len(variants) < 36 * 36
out = ROOT / "public/viewer/caves-loadout.js"
out.write_text(
    "// GENERATED by scripts/caves/build-loadout.py from src/lib/monkeMeme — do not edit.\n"
    "// Weapon looks only: every weapon plays the same (caves.js).\n"
    f"export const WEAPONS = {json.dumps(variants, separators=(',', ':'))};\n"
    f"export const DEFAULT_WEAPON = {default};\n"
    "// 2 base-36 chars per monke number from 1; \"--\" = no entry.\n"
    f"export const LOADOUT = \"{packed}\";\n")
print(f"{len(codes)} monkes, {len(variants)} weapon looks, {out.stat().st_size} bytes")
if len(sys.argv) > 1:
    import csv
    with open(sys.argv[1], "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["monke", "weapon", "shot", "colour", "art"])
        for r in review: w.writerow([f"#{r[0]}", *r[1:]])
    from collections import Counter
    print(Counter(r[1] for r in review).most_common())
