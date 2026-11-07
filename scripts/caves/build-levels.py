#!/usr/bin/env python3
"""MonkeCaves level builder → public/viewer/caves-levels.js (+ a top-down PNG per cave).

Each cave is laid out as rooms (rectangles), halls (axis-aligned polylines) and things
placed by coordinate. The builder carves them into rock, then checks the cave plays:
  - the start reaches every badge it needs, in order, without walking through a door it
    can't open yet
  - the exit is reachable only after the last badge (so badge doors can't be skipped)
  - every enemy and pickup sits on open floor
Run: python3 scripts/caves/build-levels.py [--png DIR]

Map letters (caves.js): # rock  C chart wall  B crate  S secret wall  D exit  d door
  V vines  T carved monke head  Z bamboo  W waterfall   (jungle walls, caves-world.js)
  P start  b bananas  h/H health small/big  q/Q ammo battery/Seeker phone  I monke idol
  Y banana tree  F torch (both block)  M glowing mushroom
  1 2 3 blue/pink/gold badge  7 8 9 blue/pink/gold door
  J jeet  G rug goblin  X boss  c cookie  n notification bat  a pop-up ad  K gatekeeper  E algorithm eye
Jungle caves also carry `floor` rows (g grass, m mud, w water, s stone) and `ceil` rows
(o open sky) so clearings are sunlit and tunnels are dark.
Every cave layout here is our own.
"""
import json, math, random, struct, sys, zlib
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/viewer/caves-levels.js"
FLOORISH = set(".PbhHqQIMJGXcnaKE123")
THINGS = "bhHqQIMJGXcnaKE123"
DOOR_OF = {"7": "1", "8": "2", "9": "3"}


class Cave:
    def __init__(self, name, w, h, boss=None, theme=None, par=None, seed=1):
        self.name, self.w, self.h, self.boss, self.theme, self.par = name, w, h, boss, theme, par
        self.g = [["#"] * w for _ in range(h)]
        self.fl = [["."] * w for _ in range(h)]   # floor texture per cell ("." = level default)
        self.sky = [["."] * w for _ in range(h)]  # "o" = open sky
        self.rng = random.Random(seed)

    def _mark(self, i, j, floor, sky):
        self.g[j][i] = "."
        if floor: self.fl[j][i] = floor
        if sky: self.sky[j][i] = "o"

    def _ring(self, cells, wall):
        for i, j in cells:
            for dj in (-1, 0, 1):
                for di in (-1, 0, 1):
                    if 0 < i + di < self.w - 1 and 0 < j + dj < self.h - 1 and self.g[j + dj][i + di] == "#":
                        self.g[j + dj][i + di] = wall

    def blob(self, cx, cy, rx, ry, wall=None, floor=None, sky=False):
        """A natural cave or clearing: an ellipse with a wobbly edge."""
        k = [self.rng.uniform(-0.18, 0.18) for _ in range(6)]
        cells = []
        for j in range(max(1, int(cy - ry - 2)), min(self.h - 1, int(cy + ry + 3))):
            for i in range(max(1, int(cx - rx - 2)), min(self.w - 1, int(cx + rx + 3))):
                dx, dy = (i - cx) / rx, (j - cy) / ry
                a = math.atan2(dy, dx)
                edge = 1 + k[0] * math.sin(2 * a + k[1] * 9) + k[2] * math.sin(3 * a + k[3] * 9) + k[4] * math.sin(5 * a + k[5] * 9)
                if dx * dx + dy * dy < edge * edge:
                    self._mark(i, j, floor, sky); cells.append((i, j))
        if wall: self._ring(cells, wall)
        return self

    def room(self, x, y, w, h, wall=None, floor=None, sky=False):
        for j in range(y, y + h):
            for i in range(x, x + w):
                self._mark(i, j, floor, sky)
        if wall:  # retexture the rock ring around the room
            for j in range(y - 1, y + h + 1):
                for i in range(x - 1, x + w + 1):
                    if self.g[j][i] == "#":
                        self.g[j][i] = wall
        return self

    def hall(self, pts, width=2, floor=None, sky=False):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            assert x0 == x1 or y0 == y1, f"{self.name}: hall {pts} not axis-aligned"
            for j in range(min(y0, y1), max(y0, y1) + 1):
                for i in range(min(x0, x1), max(x0, x1) + 1):
                    for k in range(width):
                        if x0 == x1: self._mark(i + k, j, floor, sky)
                        else: self._mark(i, j + k, floor, sky)
        return self

    def put(self, ch, *cells):
        for x, y in cells:
            self.g[y][x] = ch
        return self

    def rows(self):
        for i in range(self.w):
            for j in (0, self.h - 1):
                if self.g[j][i] in FLOORISH: self.g[j][i] = "#"
        for j in range(self.h):
            for i in (0, self.w - 1):
                if self.g[j][i] in FLOORISH: self.g[j][i] = "#"
        return ["".join(r) for r in self.g]

    def check(self):
        rows = self.rows()
        find = lambda ch: [(i, j) for j, r in enumerate(rows) for i, c in enumerate(r) if c == ch]
        starts, exits = find("P"), find("D")
        assert len(starts) == 1 and len(exits) == 1, f"{self.name}: need one P and one D"
        badges = sorted({c for r in rows for c in r if c in "123"})
        for d, b in DOOR_OF.items():
            if find(d): assert b in badges, f"{self.name}: door {d} but no badge {b}"

        def reach(have):
            seen, q = {starts[0]}, deque([starts[0]])
            while q:
                x, y = q.popleft()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    c = rows[ny][nx]
                    ok = c in FLOORISH or c in "Sd" or (c in DOOR_OF and DOOR_OF[c] in have)
                    if c == "D": seen.add((nx, ny))
                    if ok and (nx, ny) not in seen:
                        seen.add((nx, ny)); q.append((nx, ny))
            return seen

        have = set()
        for b in badges:
            assert set(find(b)) & reach(have), f"{self.name}: badge {b} unreachable with {sorted(have)}"
            assert exits[0] not in reach(have), f"{self.name}: exit reachable before badge {b}"
            have.add(b)
        assert exits[0] in reach(have), f"{self.name}: exit unreachable with every badge"
        floor = reach(have)
        stray = [(i, j, rows[j][i]) for j, r in enumerate(rows) for i, c in enumerate(r)
                 if c in THINGS and (i, j) not in floor]
        assert not stray, f"{self.name}: things off the reachable floor {stray[:5]}"
        # Doors need a wall on both sides of the doorway, and nothing may block one.
        for x, y in find("d") + [p for d in DOOR_OF for p in find(d)]:
            wall = lambda c: c not in FLOORISH and c not in "dYF"
            assert (wall(rows[y][x - 1]) and wall(rows[y][x + 1])) or (wall(rows[y - 1][x]) and wall(rows[y + 1][x])), f"{self.name}: door at {(x, y)} has no frame"
        count = lambda s: sum(r.count(ch) for r in rows for ch in s)
        return {"enemies": count("JGXcnaKE"), "health": count("hH"), "ammo": count("q") * 10 + count("Q") * 40,
                "bananas": count("b"), "idols": count("I"), "secrets": count("S"), "floor": len(floor)}

    def level(self):
        lv = {"name": self.name}
        if self.boss: lv["boss"] = self.boss
        if self.theme: lv["theme"] = self.theme
        if self.par: lv["par"] = self.par
        if getattr(self, "face", None) is not None: lv["face"] = self.face
        lv["rows"] = self.rows()
        if self.theme:
            lv["floor"] = ["".join(r) for r in self.fl]
            lv["ceil"] = ["".join(r) for r in self.sky]
        return lv


def lost_temple():
    """Cave 1: the lost Monke temple. Learn the game; Big Tech is already digging in.

    Built to Romero's checklist: the first clearing is the prettiest place in the cave
    and offers two ways on; the hub courtyard shows the locked blue gate before you
    find the badge; you come back through the hub with it; sunlit clearings alternate
    with dark torch-lit tunnels; a few rooms have nobody in them; five secrets, each
    behind a wall with a small banana scratched into it."""
    c = Cave("LOST TEMPLE", 60, 60, theme="jungle", par=150, seed=7)
    c.face = 90  # start looking south at the waterfall

    # 1. Start clearing (sun, grass) with a waterfall pool. Two ways north.
    c.blob(10, 46, 7.5, 5, wall="V", floor="g", sky=True)
    c.room(5, 49, 11, 4, floor="w", sky=True)                             # the pool under the falls
    c.put("W", *[(x, 53) for x in range(5, 16) if x != 13])
    c.room(12, 54, 4, 3, floor="s").put("S", (13, 53))                     # secret 1: behind the falls
    c.hall([(6, 31), (6, 42)], floor="m")                                  # west: vine tunnel (dark)
    c.room(12, 33, 9, 7, wall="Z", floor="g", sky=True)                    # east: bamboo grove
    c.hall([(15, 40), (15, 45)], floor="g", sky=True).hall([(15, 31), (15, 32)], floor="g", sky=True)

    # 2. Hub: temple ruins courtyard. The blue gate is on its east side.
    c.room(4, 20, 21, 11, floor="s", sky=True)
    c.put("T", (9, 23), (9, 27), (19, 23), (19, 27))
    c.hall([(25, 25), (26, 25)], width=1).put("7", (25, 25))

    # 3. North: root cellar (dark, mud) and the shrine with the blue badge.
    c.hall([(14, 17), (14, 18)], width=1).put("d", (14, 19))
    c.blob(9, 10, 5.5, 6, floor="m")
    c.hall([(11, 14), (14, 14), (14, 17)], width=1)
    c.hall([(14, 10), (17, 10)], width=1).put("d", (16, 10))
    c.room(18, 4, 11, 9, wall="T", floor="s")
    c.room(30, 7, 3, 3, floor="s").put("S", (29, 8))                       # secret 2: shrine alcove

    # 4. Behind the blue gate: the great hall (torches), the flooded crypt, the sun well.
    c.room(27, 20, 15, 13, floor="s")
    c.put("T", (30, 23), (30, 29), (38, 23), (38, 29))
    c.room(32, 15, 5, 4, floor="s").put("S", (34, 19))                     # secret 3: above the hall
    c.hall([(34, 33), (34, 34)], width=1).put("d", (34, 33))
    c.room(28, 35, 15, 11, wall="V", floor="w")                            # flooded crypt
    c.room(24, 39, 3, 3, floor="m").put("S", (27, 40))                     # secret 4: crypt closet
    c.hall([(42, 26), (46, 26)], width=1).put("d", (42, 26))
    c.blob(50, 25, 6, 7, wall="V", floor="g", sky=True)                    # sun well
    c.hall([(43, 40), (49, 40), (49, 31)], floor="m")                      # crypt → sun well loop

    # 5. North-east: the Big Tech dig site and the way out.
    c.hall([(50, 14), (50, 19)], width=1).put("d", (50, 15))
    c.room(40, 4, 15, 10, floor="m")
    c.put("B", (43, 7), (44, 7), (43, 8), (51, 10), (52, 10), (47, 11))
    c.room(56, 7, 2, 3, floor="s").put("S", (55, 8))                       # secret 5: dig site stash
    c.put("D", (47, 3))

    # Start: two batteries, a banana, nobody in sight. Torches and trees.
    c.put("P", (10, 45)).put("q", (8, 43)).put("b", (12, 47))
    c.put("Y", (4, 43), (17, 47), (13, 34), (19, 38), (46, 21), (54, 29), (53, 21))
    c.put("F", (7, 33), (5, 24), (23, 24), (18, 5), (28, 5), (27, 21), (41, 21), (27, 31), (41, 31),
          (40, 5), (54, 5), (8, 6), (29, 36), (42, 44))
    c.put("M", (12, 9), (6, 13), (31, 43), (40, 37), (36, 44))
    # Secrets: idols, a Seeker phone or two, a big health.
    c.put("I", (14, 56)).put("Q", (12, 55))
    c.put("I", (31, 8)).put("H", (32, 9))
    c.put("I", (34, 16)).put("q", (33, 16), (35, 17))
    c.put("I", (25, 40)).put("H", (24, 41))
    c.put("I", (57, 8)).put("Q", (56, 9))

    # Grove: first fight, cookies. Vine tunnel: a quiet walk with one bat.
    c.put("c", (16, 35), (17, 36), (18, 35), (14, 36)).put("b", (19, 34)).put("q", (13, 38), (20, 36))
    c.put("n", (7, 35)).put("b", (6, 38))
    # Hub: jeets among the ruins; ammo and health on the way to the gate.
    c.put("J", (12, 22), (17, 28), (21, 21), (7, 28)).put("c", (11, 25), (12, 26), (16, 24))
    c.put("q", (5, 21), (23, 29), (13, 29)).put("h", (22, 22)).put("b", (14, 25), (20, 25))
    # Root cellar: dark, bats and cookies.
    c.put("n", (8, 7), (11, 13)).put("c", (6, 9), (7, 10), (10, 11), (12, 6), (13, 7)).put("J", (9, 14))
    c.put("q", (5, 12), (12, 12)).put("h", (4, 7)).put("b", (10, 5))
    # Shrine: the blue badge on the altar, guarded.
    c.put("1", (23, 6)).put("J", (20, 10), (27, 6)).put("G", (24, 11)).put("c", (21, 7), (25, 7))
    c.put("h", (19, 11)).put("q", (27, 11))
    # Great hall: the big fight.
    c.put("J", (31, 21), (36, 21), (40, 25), (37, 30)).put("G", (35, 24))
    c.put("c", (32, 30), (33, 31), (34, 31), (35, 30)).put("n", (34, 22)).put("h", (28, 31), (23, 27))
    c.put("q", (28, 21), (40, 31)).put("Q", (35, 28)).put("b", (34, 25))
    # Flooded crypt: bats over the water, a goblin.
    c.put("n", (38, 38), (35, 42), (41, 43)).put("J", (29, 44)).put("G", (36, 40))
    c.put("q", (30, 40), (41, 39)).put("h", (37, 45)).put("b", (33, 38), (39, 44))
    # Sun well: a breather, then jeets at the far side.
    c.put("J", (52, 19), (55, 25)).put("c", (48, 30), (49, 30), (50, 31))
    c.put("H", (47, 24)).put("q", (52, 27)).put("b", (50, 22), (54, 23))
    # Dig site: Big Tech's front line.
    c.put("J", (42, 5), (48, 6), (53, 7), (45, 12)).put("G", (49, 9))
    c.put("c", (41, 10), (42, 11), (53, 9)).put("n", (45, 5)).put("h", (51, 20))
    c.put("q", (41, 12)).put("b", (44, 10), (53, 12))
    return c


# Caves 2 and 3 are the old prototype maps until they're rebuilt full length.
OLD = json.loads((Path(__file__).with_name("old-levels.json")).read_text())


def png(rows, path, cs=8):
    col = {"#": (70, 62, 86), "V": (40, 110, 50), "T": (150, 140, 104), "Z": (130, 170, 60), "W": (80, 160, 220),
           "d": (150, 90, 40), "Y": (60, 160, 60), "F": (255, 150, 40), "M": (120, 230, 255), "I": (255, 240, 120),
           "q": (60, 220, 170), "Q": (30, 200, 150), "H": (255, 40, 60), "C": (130, 60, 90), "B": (150, 98, 50), "S": (90, 200, 120), "D": (233, 22, 113),
           "7": (60, 140, 255), "8": (233, 22, 113), "9": (255, 210, 63), ".": (24, 21, 30), "P": (255, 255, 255),
           "b": (255, 210, 63), "h": (240, 70, 80), "1": (60, 140, 255), "2": (233, 22, 113), "3": (255, 210, 63),
           "J": (46, 160, 80), "G": (150, 70, 210), "X": (255, 60, 60), "c": (206, 152, 84), "n": (255, 230, 120),
           "a": (90, 140, 255), "K": (150, 150, 170), "E": (190, 110, 255)}
    H, W = len(rows) * cs, len(rows[0]) * cs
    raw = bytearray()
    for j in range(H):
        raw.append(0)
        for i in range(W):
            ch = rows[j // cs][i // cs]
            r, g, b = col.get(ch, (0, 0, 0))
            if ch not in "#C.BS789DVTZWd" and ch in col:  # things: a dot on floor
                dx, dy = i % cs - cs / 2 + 0.5, j % cs - cs / 2 + 0.5
                if dx * dx + dy * dy > (cs / 2.4) ** 2: r, g, b = col["."]
            raw += bytes((r, g, b))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def main():
    caves = [lost_temple()]
    levels = []
    for c in caves:
        stats = c.check()
        print(f"{c.name}: {c.w}x{c.h} {stats}")
        levels.append(c.level())
    levels += OLD
    if "--png" in sys.argv:
        d = Path(sys.argv[sys.argv.index("--png") + 1])
        for k, lv in enumerate(levels[:len(caves)]):
            png(lv["rows"], d / f"cave{k + 1}.png")
    body = ",\n".join("  " + json.dumps(lv, separators=(", ", ": ")).replace('"rows": [', '"rows": [\n    ').replace('", "', '",\n    "') for lv in levels)
    OUT.write_text("// Generated by scripts/caves/build-levels.py: edit the builder, not this file.\n"
                   "// Change a level → bump CAVES_VERSION in caves.js and worker-actions/src/caves.ts.\n"
                   f"export const LEVELS = [\n{body},\n];\n")
    print("wrote", OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
