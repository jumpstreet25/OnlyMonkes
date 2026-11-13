import { cleanRows, fmtCave, fmtRace, utcDay } from "@/lib/gameBoards";

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
  test("UTC day", () => expect(utcDay(new Date("2026-11-13T23:30:00-05:00"))).toBe("2026-11-14"));
});
