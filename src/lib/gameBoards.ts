/** Helpers for the Leaderboard's Games tab (GamesBoardView): row cleanup + time formats matching each game. */
export type BoardRow = { name: string; n: number | null; t: number };

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

/** Monke RC race day: the player's local date turning over at 3am, same as racer-sim.js todayId
 *  (First Snow "2026-11-15" held until Monday Nov 16 3am). */
export function raceDay(d = new Date()): string {
  const t = new Date(d.getTime() - 3 * 3_600_000), p = (v: number) => String(v).padStart(2, "0");
  const id = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
  return id < "2026-11-15" ? "2026-11-15" : id;
}

/** Monke RC: m:ss.cc (as racer.js shows it). */
export const fmtRace = (ms: number) => {
  const s = Math.max(0, ms) / 1000, m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
};

/** MonkeCaves: m:ss.d (as caves.js fmtRun shows it). */
export const fmtCave = (ms: number) => {
  const v = Math.max(0, ms), s = Math.floor(v / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${Math.floor((v % 1000) / 100)}`;
};

/** Board rows from the worker, kept to a safe shape (names are holder-chosen text). */
export function cleanRows(v: unknown, max: number): BoardRow[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((r) => r && typeof r === "object" && Number.isFinite((r as BoardRow).t))
    .slice(0, max)
    .map((r: any) => ({ name: String(r.name ?? "Monke").slice(0, 24), n: Number.isInteger(r.n) ? r.n : null, t: r.t }));
}
