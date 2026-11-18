import { cleanRows, fmtCave, fmtRace, raceDay, utcDay } from "@/lib/gameBoards";

describe("game boards", () => {
  test("times read like each game shows them", () => {
    expect(fmtRace(66083)).toBe("1:06.08");
    expect(fmtRace(9500)).toBe("0:09.50");
    expect(fmtCave(83456)).toBe("1:23.4");
    expect(fmtCave(5000)).toBe("0:05.0");
  });
  test("rows are cleaned and capped", () => {
    const rows = cleanRows([{ name: "x".repeat(40), n: 2431, t: 69250 }, { name: "bad" }, null, { n: "7", t: 70000 }, { name: "a", n: 1, t: 1 }], 2);
    expect(rows).toEqual([{ name: "x".repeat(24), n: 2431, t: 69250 }, { name: "Monke", n: null, t: 70000 }]);
    expect(cleanRows("nope", 5)).toEqual([]);
  });
  test("race day: local date from 3am, held on 2026-11-15 until then", () => {
    expect(raceDay(new Date(2026, 10, 14, 20))).toBe("2026-11-15");
    expect(raceDay(new Date(2026, 10, 16, 2, 59))).toBe("2026-11-15");
    expect(raceDay(new Date(2026, 10, 16, 3, 1))).toBe("2026-11-16");
    expect(raceDay(new Date(2026, 11, 25, 12))).toBe("2026-12-25");
  });
  test("UTC day", () => expect(utcDay(new Date("2026-11-13T23:30:00-05:00"))).toBe("2026-11-14"));
});
