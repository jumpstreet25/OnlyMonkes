/** Helpers for the Leaderboard's Games tab (GamesBoardView): row cleanup + time formats matching each game. */
export type BoardRow = { name: string; n: number | null; t: number };

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

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
