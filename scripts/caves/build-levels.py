#!/usr/bin/env python3
"""MonkeCaves level builder → public/viewer/caves-levels.js (+ a top-down PNG per cave).

Each cave is laid out as rooms (rectangles), halls (axis-aligned polylines) and things
placed by coordinate. The builder carves them into rock, then checks the cave plays:
  - the start reaches every badge it needs, in order, without walking through a door it
    can't open yet
  - the exit is reachable only after the last badge (so badge doors can't be skipped)
  - every enemy and pickup sits on open floor
Run: python3 scripts/caves/build-levels.py [--png DIR]

Map letters (caves.js): # rock  C chart wall  B crate  S secret wall  D exit
  P start  b bananas  h health  1 2 3 blue/pink/gold badge  7 8 9 blue/pink/gold door
  J jeet  G rug goblin  X boss  c cookie  n notification bat  a pop-up ad  K gatekeeper  E algorithm eye
Every cave layout here is our own.
"""
import json, struct, sys, zlib
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/viewer/caves-levels.js"
FLOORISH = set(".PbhJGXcnaKE123")
DOOR_OF = {"7": "1", "8": "2", "9": "3"}


class Cave:
    def __init__(self, name, w, h, boss=None):
        self.name, self.w, self.h, self.boss = name, w, h, boss
        self.g = [["#"] * w for _ in range(h)]

    def room(self, x, y, w, h, wall=None):
        for j in range(y, y + h):
            for i in range(x, x + w):
                self.g[j][i] = "."
        if wall:  # retexture the rock ring around the room
            for j in range(y - 1, y + h + 1):
                for i in range(x - 1, x + w + 1):
                    if self.g[j][i] == "#":
                        self.g[j][i] = wall
        return self

    def hall(self, pts, width=2):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            assert x0 == x1 or y0 == y1, f"{self.name}: hall {pts} not axis-aligned"
            for j in range(min(y0, y1), max(y0, y1) + 1):
                for i in range(min(x0, x1), max(x0, x1) + 1):
                    for k in range(width):
                        if x0 == x1: self.g[j][i + k] = "."
                        else: self.g[j + k][i] = "."
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
                    ok = c in FLOORISH or c == "S" or (c in DOOR_OF and DOOR_OF[c] in have)
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
                 if c in "bhJGXcnaKE123" and (i, j) not in floor]
        assert not stray, f"{self.name}: things off the reachable floor {stray[:5]}"
        count = lambda s: sum(r.count(ch) for r in rows for ch in s)
        return {"enemies": count("JGXcnaKE"), "health": count("h"), "bananas": count("b"),
                "secrets": count("S"), "floor": len(floor)}


def the_dip():
    """Cave 1: learn the game. A crashed trading floor: jeets, cookies, one blue badge."""
    c = Cave("THE DIP", 50, 50)
    c.room(2, 2, 10, 8)                                   # lobby (start)
    c.room(16, 3, 22, 6, wall="C").hall([(12, 5), (16, 5)])  # candle hall
    c.put("C", (20, 4), (20, 7), (25, 4), (25, 7), (30, 4), (30, 7))
    c.room(41, 2, 7, 16).hall([(38, 5), (41, 5)])        # the pit
    c.put("B", (43, 6), (44, 6), (43, 11), (46, 11))
    c.room(16, 12, 18, 10).hall([(22, 9), (22, 12)])     # order book maze
    c.put("B", *[(x, 15) for x in range(17, 31) if x not in (27, 28)], *[(x, 18) for x in range(19, 34) if x not in (21, 22)])
    c.room(2, 14, 10, 12).hall([(6, 10), (6, 14)])       # liquidation vault (blue badge)
    c.hall([(12, 20), (16, 20)], width=1)                # vault ↔ maze
    c.room(2, 27, 5, 4).put("S", (4, 26))                # secret stash under the vault
    c.room(39, 24, 9, 14)                                # server shaft (east, behind blue)
    c.room(14, 27, 24, 9, wall="C")                      # red candles (behind blue)
    c.hall([(25, 22), (25, 26)], width=1).put("7", (25, 23))  # blue door: maze → red candles
    c.hall([(38, 30), (39, 30)], width=2)                # red candles → shaft
    c.put("C", (18, 30), (18, 32), (24, 29), (24, 33), (30, 30), (30, 32))
    c.room(12, 40, 26, 8).hall([(44, 38), (44, 44), (38, 44)])  # shaft → exit hall
    c.room(28, 37, 5, 2).put("S", (30, 39))              # secret stash above the exit hall
    c.put("D", (11, 44))

    c.put("P", (4, 5)).put("b", (9, 3)).put("c", (9, 8), (10, 8))
    c.put("J", (23, 5), (28, 6), (34, 4)).put("b", (36, 7))
    c.put("c", (44, 9), (45, 9), (46, 9), (44, 14), (45, 14)).put("h", (46, 3)).put("b", (42, 16))
    c.put("J", (20, 13), (30, 17), (18, 20)).put("G", (31, 20)).put("b", (25, 16), (32, 13)).put("c", (25, 20), (26, 20), (27, 20), (28, 20), (29, 19), (24, 19))
    c.put("1", (6, 23)).put("J", (4, 18), (9, 20), (7, 24)).put("c", (3, 22), (4, 23), (9, 23), (10, 22))
    c.put("h", (3, 28)).put("b", (5, 29), (3, 30))
    c.put("J", (41, 27), (45, 32), (42, 36)).put("G", (40, 35)).put("h", (46, 36)).put("b", (46, 26)).put("c", (44, 29), (45, 29), (46, 29))
    c.put("J", (20, 28), (27, 31), (33, 34), (35, 28), (16, 31), (22, 30)).put("c", (22, 34), (23, 34), (24, 34), (25, 34), (26, 34)).put("n", (31, 28), (16, 34))
    c.put("b", (15, 28), (28, 35))
    c.put("J", (16, 44), (24, 42), (30, 46), (34, 43), (14, 41)).put("G", (28, 41)).put("c", (32, 45), (33, 46), (34, 46), (20, 46), (21, 46)).put("n", (18, 42))
    c.put("h", (29, 37)).put("b", (31, 38))
    return c


# Caves 2 and 3 are the old prototype maps until they're rebuilt full length.
OLD = json.loads((Path(__file__).with_name("old-levels.json")).read_text())


def png(rows, path, cs=8):
    col = {"#": (70, 62, 86), "C": (130, 60, 90), "B": (150, 98, 50), "S": (90, 200, 120), "D": (233, 22, 113),
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
            if ch not in "#C.BS7 89D" and ch in col:  # things: a dot on floor
                dx, dy = i % cs - cs / 2 + 0.5, j % cs - cs / 2 + 0.5
                if dx * dx + dy * dy > (cs / 2.4) ** 2: r, g, b = col["."]
            raw += bytes((r, g, b))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def main():
    caves = [the_dip()]
    levels = []
    for c in caves:
        stats = c.check()
        print(f"{c.name}: {c.w}x{c.h} {stats}")
        levels.append({"name": c.name, **({"boss": c.boss} if c.boss else {}), "rows": c.rows()})
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
