#!/usr/bin/env python3
"""MonkeCaves level builder → public/viewer/caves-levels.js and caves-arenas.js (Jungle Royale)
(+ a top-down PNG per cave / arena).

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
  R Jungle Royale spawn point (arenas only)
Jungle caves also carry `floor` rows (g grass, m mud, w water, s stone) and `ceil` rows
(o open sky) so clearings are sunlit and tunnels are dark.
Every cave layout here is our own.
"""
import json, math, random, struct, sys, zlib
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/viewer/caves-levels.js"
OUT_ARENAS = ROOT / "public/viewer/caves-arenas.js"
FLOORISH = set(".PRbhHqQIMJGXcnaKE123")
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
        for x, y in find("S"):
            open_n = [(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if rows[y + dy][x + dx] in FLOORISH or rows[y + dy][x + dx] in "YFM"]
            assert len(open_n) >= 2, f"{self.name}: secret at {(x, y)} doesn't join floor to a closet"
        for x, y in find("Y") + find("F") + find("M"):
            assert any(rows[y + dy][x + dx] in FLOORISH for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))), f"{self.name}: decor at {(x, y)} is buried in rock"
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


def paper_hands_alley():
    """Cave 2: the buried trading post where paper hands panic-sold. Harder than the temple:
    more enemies per room, less health, pop-up ads that shoot from range, two badges.

    Flow: a dark drop into the cave → the sunlit market square (hub, crates and chart
    walls for cover) shows both locked gates → the order-book vault (east) holds the blue
    badge → the blue gate opens the exchange hall → its west tunnel drops into the
    bagholder cellars and the rug pit, where the pink badge sits on an island → back
    through the hall, the pink gate opens the bear market canyon (ads on the ridges) →
    the bear's den, where the bear holds the exit. Six secrets, each behind a wall with
    a banana scratched into it; two rooms are quiet on purpose (the cellar stairs, the
    canyon spring)."""
    c = Cave("PAPER HANDS ALLEY", 60, 60, theme="jungle", boss="bear", par=210, seed=23)
    c.face = 0  # start looking east down the tunnel

    # 1. The drop: a dark landing under the hole from cave 1. One way on.
    c.blob(7, 7, 4.5, 4, floor="m")
    c.room(7, 12, 3, 2, floor="m").put("S", (8, 11))                         # secret 1: under the rope
    c.hall([(11, 6), (17, 6)], floor="m")

    # 2. Hub: the market square, open sky. Crates and chart walls make cover.
    c.room(18, 3, 22, 13, floor="s", sky=True)
    c.put("C", (23, 7), (24, 7), (33, 7), (34, 7), (23, 12), (24, 12), (33, 12), (34, 12))
    c.put("B", (20, 13), (21, 13), (20, 14), (37, 4), (38, 4), (38, 5), (29, 10))
    c.hall([(28, 16), (28, 19)], width=1).put("7", (28, 17))                 # blue gate, south

    # 3. East: the ticker tunnel and the order-book vault (blue badge).
    c.hall([(40, 9), (43, 9)], width=1).put("d", (41, 9))
    c.room(44, 3, 12, 12, wall="C", floor="s")
    c.put("B", (46, 5), (47, 5), (46, 12), (53, 12), (54, 12))
    c.room(57, 5, 1, 4, floor="s").put("S", (56, 7))                         # secret 2: vault closet

    # 4. Behind the blue gate: the exchange hall (torches, pillars).
    c.room(18, 20, 22, 12, floor="s")
    c.put("T", (22, 23), (22, 28), (35, 23), (35, 28))
    c.room(14, 23, 3, 3, floor="s").put("S", (17, 24))                       # secret 3: trading desk stash
    c.hall([(40, 25), (45, 25)], width=1).put("8", (41, 25))                 # pink gate, east

    # 5. West of the hall: cellar stairs (quiet), the bagholder cellars, the rug pit.
    c.hall([(12, 30), (17, 30)], width=1).put("d", (17, 30))
    c.hall([(12, 30), (12, 35)], width=2, floor="m")
    c.blob(13, 41, 7, 5, floor="m")
    c.room(4, 47, 12, 7, wall="V", floor="w")                                # the rug pit, flooded
    c.room(8, 49, 3, 3, floor="s")                                           # the island
    c.hall([(10, 45), (10, 47)], width=2, floor="m")
    c.room(22, 38, 3, 3, floor="m").put("S", (21, 39))                       # secret 4: dumped bags

    # 6. Behind the pink gate: the bear market canyon (sun, ads on the ridges).
    c.blob(49, 31, 6.5, 9, wall="V", floor="g", sky=True)
    c.room(54, 36, 3, 4, floor="w", sky=True)                                # the spring
    c.room(58, 28, 1, 3, floor="g").put("S", (57, 29))                       # secret 5: ridge cache
    c.hall([(49, 36), (49, 44)], width=1).put("d", (49, 42))

    # 7. The bear's den. The bear holds the exit.
    c.room(30, 45, 26, 11, wall="T", floor="m")
    c.put("B", (40, 47), (41, 47), (40, 48), (46, 52), (47, 52), (34, 49))
    c.room(26, 50, 3, 3, floor="m").put("S", (29, 51))                       # secret 6: den bones
    c.put("D", (31, 56))

    # Start: a battery and a banana, nobody in sight.
    c.put("P", (6, 7)).put("q", (8, 9)).put("b", (5, 5))
    # Light: torches in the tunnels, trees and mushrooms in the open.
    c.put("F", (3, 6), (10, 9), (18, 3), (39, 3), (44, 3), (55, 3), (18, 20), (39, 20), (18, 31), (39, 31),
          (30, 45), (55, 45), (30, 55), (55, 55), (11, 37), (18, 43))
    c.put("Y", (19, 9), (38, 14), (46, 30), (53, 26), (47, 38))
    c.put("M", (9, 10), (13, 33), (10, 42), (17, 40), (45, 50), (52, 54))
    # Secrets: idols, Seeker phones, a big health.
    c.put("I", (8, 13)).put("q", (7, 12))
    c.put("I", (57, 6)).put("Q", (57, 8))
    c.put("I", (15, 24)).put("H", (14, 25))
    c.put("I", (23, 39)).put("Q", (24, 40))
    c.put("I", (58, 28)).put("H", (58, 30))
    c.put("I", (27, 51)).put("Q", (26, 52))

    # Market square: the first real fight, jeets behind the stalls, cookies in the open.
    c.put("J", (22, 5), (31, 4), (36, 9), (26, 14), (35, 14)).put("G", (29, 8))
    c.put("c", (25, 9), (26, 10), (31, 11), (32, 10)).put("n", (28, 4))
    c.put("q", (19, 4), (38, 13)).put("h", (21, 10)).put("b", (27, 6), (30, 13))
    # Vault: the blue badge behind the order book, ads on guard.
    c.put("1", (53, 8)).put("a", (49, 4), (54, 10)).put("J", (47, 8), (51, 12), (45, 13)).put("G", (52, 6))
    c.put("c", (48, 10), (49, 11)).put("q", (45, 4)).put("h", (54, 4)).put("b", (50, 8))
    # Exchange hall: the big fight.
    c.put("J", (20, 22), (27, 21), (32, 22), (38, 26), (24, 30), (33, 30)).put("G", (29, 25), (36, 30))
    c.put("a", (37, 21)).put("n", (25, 25), (31, 28)).put("c", (21, 26), (22, 26), (34, 25), (35, 26))
    c.put("q", (19, 21), (38, 30)).put("Q", (28, 28)).put("h", (19, 30)).put("b", (28, 22))
    # Cellar stairs: quiet. Cellars: bats in the dark, goblins stealing bananas.
    c.put("q", (13, 32)).put("b", (12, 34))
    c.put("n", (9, 39), (16, 38), (12, 44)).put("G", (8, 41), (18, 42)).put("J", (14, 40), (11, 43))
    c.put("c", (15, 43), (16, 43), (10, 38)).put("q", (7, 40), (19, 40)).put("h", (13, 38)).put("b", (17, 44))
    # Rug pit: the pink badge on the island, goblins and bats over the water.
    c.put("2", (9, 50)).put("G", (5, 48), (14, 52)).put("n", (6, 52), (13, 48)).put("J", (12, 50))
    c.put("h", (5, 53)).put("q", (14, 48)).put("b", (7, 49))
    # Bear market canyon: ads on the ridges, jeets in the grass.
    c.put("a", (44, 27), (54, 29), (46, 35)).put("J", (47, 24), (52, 33), (45, 31), (50, 37))
    c.put("c", (49, 28), (50, 28), (48, 33)).put("n", (51, 24))
    c.put("H", (55, 37)).put("q", (48, 26), (53, 35)).put("b", (50, 30))
    # Den: the bear and its jeets. Health and phones round the edge.
    c.put("X", (37, 51)).put("J", (33, 47), (50, 47), (44, 54)).put("c", (52, 49), (53, 50))
    c.put("h", (54, 46), (31, 54)).put("Q", (54, 54)).put("q", (32, 46), (48, 50))
    return c


def data_center():
    """Cave 3: Big Tech's data center, dug in under the jungle: rows of servers holding
    everything they track about you. Harder than the alley: three badges, the first
    Gatekeepers (shield in front: flank them) and Algorithm Eyes (turrets that never
    move), cookie swarms in the server aisles, and less health per fight.

    Flow: the loading dock (dark, quiet) → the security lobby (lit hub: a Gatekeeper on
    the turnstiles, both coloured gates in view) → south, server hall A (rack aisles, Eyes
    at the aisle ends) and the tracking room off its west side with the blue badge → back
    up, the blue gate opens the cooling plant (coolant falls, fans, bats over the pool),
    pink badge on the catwalk → the pink gate drops into the cable vault (dark, goblins and
    Gatekeepers in the cable runs) → the ad auction room (lit, full of pop-up ads), gold
    badge → the gold gate opens the core, where four Eyes guard the exit lift to Big Tech
    HQ. Seven secrets, each a wall panel with a banana sticker on it."""
    c = Cave("DATA CENTER", 60, 60, theme="tech", par=270, seed=31)
    c.face = 0  # start looking east, down the dock to the lobby door

    # 1. Loading dock: dark, crates, nobody here. One way on.
    c.room(3, 3, 9, 7, floor="x")
    c.put("B", (8, 3), (9, 3), (9, 4), (3, 8), (4, 8), (11, 9))
    c.room(3, 11, 3, 2, floor="x").put("S", (4, 10))                        # secret 1: pallet stash
    c.hall([(12, 6), (17, 6)], width=1, floor="x").put("d", (14, 6))

    # 2. Security lobby (hub, light panels): turnstiles and a desk for cover.
    c.room(18, 2, 22, 14, floor="r", sky=True)
    c.put("C", (26, 6), (27, 6), (32, 6), (33, 6))                          # status screens
    c.put("B", (21, 11), (22, 11), (36, 11), (37, 11), (29, 9), (30, 9))
    c.room(14, 12, 3, 3, floor="r").put("S", (17, 13))                      # secret 2: lost & found
    c.hall([(40, 8), (45, 8)], width=1, floor="x").put("7", (41, 8))         # blue gate, east

    # 3. South: server hall A, rack rows make aisles; cold aisles between.
    c.hall([(24, 16), (24, 19)], width=1, floor="x").put("d", (24, 17))
    c.room(14, 20, 18, 14, floor="k")
    for y in (23, 27, 31):
        c.put("T", *[(x, y) for x in range(16, 22)], *[(x, y) for x in range(25, 30)])
    c.room(14, 35, 3, 2, floor="r").put("S", (15, 34))                      # secret 3: spare drives
    # The tracking room (west), the blue badge on the big screen.
    c.hall([(10, 27), (13, 27)], width=1, floor="x").put("d", (12, 27))
    c.room(3, 23, 7, 9, wall="C", floor="r", sky=True)

    # 4. Behind the blue gate: the cooling plant. Coolant falls, fans, a catwalk.
    c.room(46, 3, 12, 15, floor="x", sky=True)
    c.room(48, 7, 8, 8, floor="c", sky=True)                                # the coolant pool
    c.room(51, 9, 2, 4, floor="x", sky=True)                                # the catwalk island
    c.put("W", (48, 2), (49, 2), (54, 2), (55, 2)).put("V", (58, 5), (58, 9), (58, 13), (45, 15))
    c.room(54, 19, 3, 2, floor="x").put("S", (55, 18))                      # secret 4: valve room
    c.hall([(47, 18), (47, 24)], width=1, floor="x").put("8", (47, 20))      # pink gate, south

    # 5. Behind the pink gate: the cable vault. Dark, cable runs, goblins.
    c.room(43, 25, 14, 13, wall="Z", floor="x")
    c.put("Z", *[(x, 29) for x in range(45, 52)], *[(x, 33) for x in range(48, 55)], (45, 30), (54, 32))
    c.room(58, 30, 1, 3, floor="x").put("S", (57, 31))                      # secret 5: cable spool cache
    # The ad auction room (west of the vault, lit): gold badge on the auction block.
    c.hall([(42, 31), (42, 31)], width=1, floor="r").put("d", (42, 31))
    c.room(34, 26, 8, 9, wall="C", floor="r", sky=True)
    c.room(37, 23, 3, 2, floor="r").put("S", (38, 25))                      # secret 6: unsold ad slots
    c.hall([(38, 35), (38, 41)], width=1, floor="x").put("9", (38, 37))      # gold gate, south

    # 6. The core: the server core in the middle, Eyes on every side, the exit lift.
    c.room(18, 42, 30, 14, floor="k")
    c.put("T", *[(x, y) for x in range(30, 37) for y in (47, 51)], *[(x, y) for x in (30, 36) for y in range(48, 51)])
    c.room(13, 47, 3, 3, floor="r").put("S", (17, 48))                      # secret 7: backup tapes
    c.room(16, 48, 1, 1, floor="r")
    c.put("D", (33, 56))

    # Start: a battery, a banana, quiet.
    c.put("P", (5, 6)).put("q", (7, 8)).put("b", (10, 5))
    # Light: pylons in the dark rooms, cabinets and terminals for clutter.
    c.put("F", (12, 7), (18, 16), (14, 20), (31, 20), (14, 33), (31, 33), (43, 25), (56, 25), (43, 37), (56, 37),
          (18, 42), (47, 42), (18, 55), (47, 55), (25, 42), (41, 55))
    c.put("Y", (20, 2), (38, 2), (46, 17), (57, 3), (34, 34), (41, 26))
    c.put("M", (6, 4), (24, 4), (35, 14), (8, 30), (50, 4), (44, 27), (55, 35), (20, 44), (45, 53))
    # Secrets: idols in display cases, Seeker phones, big health.
    c.put("I", (4, 11)).put("q", (5, 12))
    c.put("I", (15, 13)).put("H", (14, 14))
    c.put("I", (15, 35)).put("Q", (16, 36))
    c.put("I", (55, 19)).put("H", (56, 20))
    c.put("I", (58, 30)).put("Q", (58, 32))
    c.put("I", (38, 23)).put("H", (37, 24))
    c.put("I", (14, 48)).put("Q", (13, 49))

    # Lobby: the first Gatekeeper on the turnstiles, an Eye over the desk, cookies.
    c.put("K", (29, 11)).put("J", (20, 4), (37, 4)).put("c", (25, 8), (26, 9)).put("n", (29, 5))
    c.put("q", (19, 14), (38, 14), (35, 13), (22, 6)).put("h", (38, 3), (24, 13)).put("b", (29, 14))
    # Server hall A: cookie swarms in the aisles, Eyes at the aisle ends, jeets.
    c.put("E", (31, 25)).put("c", (18, 21), (19, 21), (27, 25), (28, 25), (29, 26), (18, 29))
    c.put("J", (23, 22), (31, 21), (23, 29), (31, 30)).put("n", (24, 25), (20, 33)).put("G", (27, 32))
    c.put("q", (14, 21), (30, 29), (17, 33), (31, 22)).put("Q", (23, 32)).put("h", (14, 26), (16, 25)).put("b", (22, 25))
    # Tracking room: the blue badge, an Eye watching it, ads.
    c.put("1", (4, 27)).put("E", (6, 23)).put("a", (8, 25)).put("J", (5, 30)).put("h", (3, 31)).put("q", (9, 23), (3, 24))
    # Cooling plant: bats over the pool, jeets on the walkway, ads high up.
    c.put("2", (51, 10)).put("n", (49, 8), (54, 8), (50, 13)).put("a", (47, 4)).put("Q", (56, 16)).put("h", (57, 7))
    c.put("J", (46, 10), (52, 16)).put("h", (47, 16)).put("c", (53, 4), (54, 5))
    c.put("H", (57, 17)).put("q", (46, 4), (57, 11), (46, 14)).put("b", (52, 12))
    # Cable vault: goblins in the runs, Gatekeepers at the turns, bats in the dark.
    c.put("G", (46, 27), (53, 31), (47, 35)).put("K", (50, 31)).put("n", (52, 26), (44, 32)).put("h", (45, 36))
    c.put("J", (49, 27), (52, 35)).put("q", (56, 30)).put("c", (46, 31), (47, 31), (53, 34))
    c.put("q", (56, 26), (43, 34), (50, 36)).put("Q", (44, 26)).put("h", (49, 36)).put("b", (54, 30))
    # Ad auction: the gold badge, pop-up ads everywhere, an Eye on the block.
    c.put("3", (38, 30)).put("a", (35, 27), (40, 27), (40, 33)).put("q", (37, 28)).put("E", (38, 33))
    c.put("J", (36, 30)).put("q", (41, 34), (34, 26), (34, 30)).put("h", (41, 29)).put("b", (37, 32))
    # The core: four Eyes round the server core, Gatekeepers, cookies, jeets.
    c.put("E", (29, 46), (37, 46), (29, 52), (37, 52)).put("K", (24, 48), (42, 49)).put("q", (33, 54), (41, 53))
    c.put("c", (20, 45), (21, 46), (45, 45), (44, 46)).put("J", (26, 44), (40, 44), (25, 53))
    c.put("n", (33, 44)).put("H", (20, 50)).put("G", (46, 50))
    c.put("H", (19, 43)).put("h", (46, 54)).put("q", (19, 54), (46, 43), (19, 47), (46, 47)).put("Q", (33, 45)).put("b", (27, 50))
    return c


def walled_garden():
    """Cave 4: the Walled Garden, Big Tech's spotless fenced-in paradise. Everything is free,
    except leaving. Harder than the data center: more Gatekeepers (it's their garden), Eyes
    covering long sightlines, ads in the mall, and the last fight is at the gate itself.

    Flow: the onboarding tunnel (quiet) → the Welcome Plaza (hub under the fake sky, a
    fountain in the middle, all three gates in view) → west, the hedge maze, blue badge in
    its heart → the blue gate opens the App Store mall (icon walls, kiosks, ads), pink badge
    in the Featured room → the pink gate opens the Terms & Conditions archive, one long
    winding corridor of fine print with Eyes at the turns, gold badge in the vault at the end
    → back through the plaza, the gold gate opens The Gate: a fenced courtyard, Gatekeepers
    in the gaps, the exit beyond. Seven secrets, each a white panel with a banana sticker."""
    c = Cave("WALLED GARDEN", 60, 60, theme="garden", par=300, seed=41)
    c.face = 270  # start looking north, up the tunnel to the plaza

    # 1. Onboarding tunnel: you squeeze in through a gap in the wall.
    c.room(27, 52, 6, 5, floor="p")
    c.room(24, 53, 2, 2, floor="p").put("S", (26, 54))                      # secret 1: the gap you came through
    c.hall([(30, 46), (30, 51)], width=1, floor="p").put("d", (30, 49))

    # 2. Welcome Plaza (hub, fake sky): fountain, lawns, lamp posts.
    c.room(20, 30, 20, 16, floor="p", sky=True)
    c.room(22, 32, 5, 4, floor="l", sky=True).room(33, 32, 5, 4, floor="l", sky=True)
    c.room(22, 40, 5, 4, floor="l", sky=True).room(33, 40, 5, 4, floor="l", sky=True)
    c.room(27, 36, 6, 4, floor="f", sky=True).put("W", (29, 37), (30, 37))   # the fountain
    c.room(41, 32, 2, 3, floor="p").put("S", (40, 33))                      # secret 2: lost-and-found

    # 3. West: the hedge maze, blue badge in its heart.
    c.room(3, 26, 14, 22, floor="l", sky=True)
    c.hall([(17, 38), (19, 38)], width=1, floor="l", sky=True)
    ring = lambda x0, y0, x1, y1: [(x, y) for x in range(x0, x1 + 1) for y in (y0, y1)] + [(x, y) for y in range(y0, y1 + 1) for x in (x0, x1)]
    c.put("V", *[q for q in ring(5, 28, 14, 45) if q not in ((5, 30), (5, 31), (14, 38))])
    c.put("V", *[q for q in ring(7, 31, 12, 42) if q not in ((12, 40), (12, 41))])
    c.put("V", (9, 35), (10, 35), (9, 38), (10, 38))
    c.room(6, 49, 3, 2, floor="l").put("S", (7, 48))                        # secret 3: the gardener's shed

    # 4. Behind the blue gate: the App Store mall. Icon walls, kiosks.
    c.hall([(30, 23), (30, 29)], width=1, floor="p").put("7", (30, 27))
    c.room(14, 10, 32, 13, floor="p")
    c.put("T", (18, 13), (18, 14), (18, 18), (18, 19), (24, 13), (24, 14), (24, 18), (24, 19),
          (36, 13), (36, 14), (36, 18), (36, 19), (42, 13), (42, 14), (42, 18), (42, 19))
    c.put("C", (30, 15), (30, 16), (31, 15), (31, 16))                      # the top-charts kiosk
    c.room(47, 11, 2, 2, floor="p").put("S", (46, 11))                      # secret 4: refunds desk
    # The Featured room (north), pink badge on the stage.
    c.hall([(25, 8), (25, 9)], width=1, floor="p").put("d", (25, 8))
    c.room(20, 3, 10, 5, wall="T", floor="e", sky=True)
    c.room(31, 4, 2, 2, floor="p").put("S", (30, 5))                        # secret 5: last year's apps

    # 5. Behind the pink gate: the Terms & Conditions archive. One long corridor of fine print.
    c.hall([(46, 16), (49, 16)], width=1, floor="p").put("8", (47, 16))
    c.hall([(50, 16), (50, 4), (56, 4), (56, 12), (53, 12), (53, 20), (57, 20), (57, 28), (51, 28), (51, 36), (56, 36)], width=2, floor="p")
    c.room(47, 31, 3, 3, floor="p").put("S", (50, 32))                      # secret 6: the clause nobody read
    # The vault of small print: the gold badge.
    c.hall([(55, 38), (55, 39)], width=1, floor="p").put("d", (55, 38))
    c.room(50, 40, 8, 6, wall="T", floor="p")

    # 6. Behind the gold gate: The Gate. A fenced courtyard, the exit beyond.
    c.hall([(40, 43), (44, 43), (44, 47)], width=1, floor="p").put("9", (44, 45))
    c.room(42, 48, 15, 9, floor="l", sky=True)
    c.put("Z", *[(x, 52) for x in range(42, 57) if x not in (46, 52)])
    c.room(38, 52, 3, 3, floor="l").put("S", (41, 53))                      # secret 7: the hole in the fence
    c.put("D", (49, 57))

    # Start: a battery, a banana, quiet.
    c.put("P", (29, 55)).put("q", (31, 53)).put("b", (28, 53))
    # Lamp posts (light), topiaries, flower beds.
    c.put("F", (20, 30), (39, 30), (20, 45), (39, 45), (14, 10), (45, 10), (14, 22), (45, 22), (50, 40), (57, 45), (42, 48), (56, 48))
    c.put("Y", (26, 31), (33, 31), (26, 44), (33, 44), (4, 27), (16, 47), (29, 21), (42, 56), (56, 56))
    c.put("M", (22, 35), (37, 35), (22, 43), (37, 43), (8, 33), (21, 4), (28, 4), (44, 50), (54, 50))
    # Secrets: idols, Seeker phones, big health.
    c.put("I", (24, 53)).put("Q", (25, 54))
    c.put("I", (41, 32)).put("H", (42, 34))
    c.put("I", (6, 49)).put("Q", (8, 50))
    c.put("I", (47, 11)).put("H", (48, 12))
    c.put("I", (31, 4)).put("Q", (32, 5))
    c.put("I", (47, 31)).put("H", (49, 33))
    c.put("I", (38, 52)).put("Q", (40, 54))

    # Plaza: a Gatekeeper by the fountain, an Eye watching the lawns, ads, cookies.
    c.put("K", (30, 41)).put("E", (30, 31)).put("a", (23, 38), (37, 38)).put("c", (24, 34), (25, 34), (35, 42), (36, 42))
    c.put("J", (21, 44), (38, 31)).put("n", (34, 37))
    c.put("q", (21, 31), (38, 44), (27, 41), (32, 44)).put("Q", (21, 41)).put("h", (21, 38), (38, 38)).put("b", (30, 34))
    # Hedge maze: cookies and bats in the paths, goblins at the dead ends.
    c.put("1", (9, 36)).put("c", (15, 30), (15, 31), (6, 44), (7, 44), (13, 43), (8, 32)).put("n", (4, 40), (11, 29), (10, 41))
    c.put("G", (4, 46), (13, 32)).put("J", (6, 37), (15, 46), (10, 39))
    c.put("q", (16, 27), (4, 29), (11, 36), (16, 33), (4, 35)).put("h", (15, 44), (8, 40)).put("b", (6, 30))
    # Mall: ads at the shelves, jeets, a Gatekeeper at the kiosk, an Eye at the far end.
    c.put("a", (21, 12), (39, 20)).put("h", (27, 20), (33, 12)).put("J", (16, 16), (28, 13), (40, 16)).put("K", (30, 19))
    c.put("E", (45, 16)).put("c", (20, 16), (21, 17), (34, 16), (35, 17)).put("G", (44, 21)).put("n", (26, 16), (38, 12))
    c.put("q", (15, 11), (44, 11), (15, 21), (33, 21), (21, 15), (39, 15)).put("Q", (30, 12)).put("h", (22, 21), (39, 11)).put("b", (27, 16))
    # Featured room: the pink badge, a Gatekeeper on stage, ads.
    c.put("2", (25, 4)).put("J", (25, 6)).put("a", (29, 3)).put("h", (21, 3)).put("q", (22, 7), (27, 3)).put("h", (28, 7))
    # T&C archive: Eyes at the turns, bats and cookies in the corridor.
    c.put("E", (57, 11), (58, 27)).put("h", (51, 5), (53, 19), (52, 35)).put("n", (50, 10), (54, 13), (57, 24))
    c.put("c", (55, 4), (54, 5), (56, 20), (55, 21), (54, 28), (53, 29)).put("J", (51, 14), (57, 6), (51, 31))
    c.put("q", (51, 8), (54, 16), (58, 22), (52, 33), (56, 10), (52, 29)).put("h", (57, 8), (55, 29)).put("Q", (53, 37)).put("b", (54, 20))
    # Vault of small print: the gold badge, two Gatekeepers, an ad.
    c.put("3", (54, 43)).put("K", (52, 42)).put("J", (56, 44)).put("a", (51, 44)).put("H", (57, 41)).put("q", (50, 45))
    # The Gate: Gatekeepers in the fence gaps, Eyes behind, cookies and jeets.
    c.put("K", (46, 51), (52, 51)).put("E", (44, 55), (55, 55)).put("c", (45, 49), (46, 49), (53, 49), (54, 49))
    c.put("J", (43, 50), (55, 50), (49, 54)).put("n", (49, 50)).put("G", (50, 55))
    c.put("H", (43, 49)).put("q", (56, 49), (47, 49)).put("h", (50, 49)).put("Q", (43, 54))
    return c


class Arena(Cave):
    """A Jungle Royale versus map: no doors, badges, enemies or exit; spawn points (R)
    and pickups only. Doors stay out so the match server only has to know walls."""

    def check(self):
        rows = self.rows()
        find = lambda ch: [(i, j) for j, r in enumerate(rows) for i, c in enumerate(r) if c == ch]
        spawns = find("R")
        assert len(spawns) >= 6, f"{self.name}: need 6+ spawn points"
        assert not any(c in r for r in rows for c in "PDdS789123JGXcnaKE"), f"{self.name}: arenas have no doors, secrets, badges or enemies"
        seen, q = {spawns[0]}, deque([spawns[0]])
        while q:
            x, y = q.popleft()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (x + dx, y + dy)
                if rows[n[1]][n[0]] in FLOORISH and n not in seen:
                    seen.add(n); q.append(n)
        stray = [(i, j, c) for j, r in enumerate(rows) for i, c in enumerate(r) if c in FLOORISH and (i, j) not in seen]
        assert not stray, f"{self.name}: floor cut off from the spawns {stray[:5]}"
        # Spawns spread out: no two closer than 6 tiles.
        for a in spawns:
            for b in spawns:
                assert a == b or math.dist(a, b) >= 6, f"{self.name}: spawns {a} and {b} too close"
        count = lambda s: sum(r.count(ch) for r in rows for ch in s)
        return {"spawns": len(spawns), "health": count("hH"), "ammo": count("q") * 10 + count("Q") * 40, "floor": len(seen)}


def temple_ring():
    """Jungle Royale arena 1: a sunlit temple courtyard (the big health sits in the
    middle, in the open) inside a ring of dark root tunnels joining four jungle
    clearings. Every spawn has two ways out; the courtyard pillars break sightlines."""
    a = Arena("TEMPLE RING", 34, 34, theme="jungle", seed=11)
    a.face = 0
    for cx, cy, wall in ((6, 6, "V"), (27, 6, "Z"), (6, 27, "Z"), (27, 27, "V")):
        a.blob(cx, cy, 4.5, 4.2, wall=wall, floor="g", sky=True)
    a.room(3, 24, 5, 3, floor="w", sky=True)                                   # SW pool
    for pts in (((6, 6), (27, 6)), ((27, 6), (27, 27)), ((6, 27), (27, 27)), ((6, 6), (6, 27))):
        a.hall(list(pts), floor="m")                                           # the ring (dark)
    a.room(12, 12, 10, 10, floor="s", sky=True)                                # courtyard
    for pts in (((16, 7), (16, 12)), ((16, 21), (16, 27)), ((7, 16), (12, 16)), ((21, 16), (27, 16))):
        a.hall(list(pts), floor="s")                                           # four spokes in
    a.put("T", (14, 14), (19, 14), (14, 19), (19, 19))                          # pillars
    a.put("F", (12, 12), (21, 12), (12, 21), (21, 21))                          # torches in the corners
    a.put("M", (10, 6), (23, 6), (10, 28), (23, 28), (6, 11), (28, 22))
    a.put("R", (5, 5), (28, 5), (5, 28), (28, 28), (16, 9), (16, 25), (9, 16), (25, 16))
    a.put("H", (16, 16)).put("h", (8, 8), (25, 25)).put("Q", (25, 8), (8, 25))
    a.put("q", (17, 6), (17, 28), (6, 17), (28, 17))
    return a


ARENAS = [temple_ring]


# Cave 5 is the old Big Tech HQ prototype (the Banana Phone) until it's rebuilt full length.
OLD = json.loads((Path(__file__).with_name("old-levels.json")).read_text())


def png(rows, path, cs=8):
    col = {"#": (70, 62, 86), "V": (40, 110, 50), "T": (150, 140, 104), "Z": (130, 170, 60), "W": (80, 160, 220),
           "d": (150, 90, 40), "Y": (60, 160, 60), "F": (255, 150, 40), "M": (120, 230, 255), "I": (255, 240, 120),
           "q": (60, 220, 170), "Q": (30, 200, 150), "H": (255, 40, 60), "C": (130, 60, 90), "B": (150, 98, 50), "S": (90, 200, 120), "D": (233, 22, 113),
           "7": (60, 140, 255), "8": (233, 22, 113), "9": (255, 210, 63), ".": (24, 21, 30), "P": (255, 255, 255),
           "b": (255, 210, 63), "h": (240, 70, 80), "1": (60, 140, 255), "2": (233, 22, 113), "3": (255, 210, 63),
           "J": (46, 160, 80), "G": (150, 70, 210), "X": (255, 60, 60), "c": (206, 152, 84), "n": (255, 230, 120),
           "a": (90, 140, 255), "K": (150, 150, 170), "E": (190, 110, 255), "R": (120, 255, 255)}
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
    caves = [lost_temple(), paper_hands_alley(), data_center(), walled_garden()]
    levels = []
    for c in caves:
        stats = c.check()
        print(f"{c.name}: {c.w}x{c.h} {stats}")
        levels.append(c.level())
    levels += [lv for lv in OLD if lv["name"] == "BIG TECH HQ"]
    if "--png" in sys.argv:
        d = Path(sys.argv[sys.argv.index("--png") + 1])
        for k, lv in enumerate(levels[:len(caves)]):
            png(lv["rows"], d / f"cave{k + 1}.png")
    body = ",\n".join("  " + json.dumps(lv, separators=(", ", ": ")).replace('"rows": [', '"rows": [\n    ').replace('", "', '",\n    "') for lv in levels)
    OUT.write_text("// Generated by scripts/caves/build-levels.py: edit the builder, not this file.\n"
                   "// Change a level → bump CAVES_VERSION in caves.js and worker-actions/src/caves.ts.\n"
                   f"export const LEVELS = [\n{body},\n];\n")
    print("wrote", OUT.relative_to(ROOT))
    arenas = []
    for build in ARENAS:
        a = build()
        print(f"arena {a.name}: {a.w}x{a.h} {a.check()}")
        arenas.append(a.level())
        if "--png" in sys.argv:
            png(arenas[-1]["rows"], Path(sys.argv[sys.argv.index("--png") + 1]) / f"arena{len(arenas)}.png")
    body = ",\n".join("  " + json.dumps(lv, separators=(", ", ": ")).replace('"rows": [', '"rows": [\n    ').replace('", "', '",\n    "') for lv in arenas)
    OUT_ARENAS.write_text("// Generated by scripts/caves/build-levels.py: edit the builder, not this file.\n"
                          "// Jungle Royale versus arenas (caves-royale.js).\n"
                          f"export const ARENAS = [\n{body},\n];\n")
    print("wrote", OUT_ARENAS.relative_to(ROOT))


if __name__ == "__main__":
    main()
