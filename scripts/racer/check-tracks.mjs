// Builds many daily tracks and drives each with the sim's autopilot: every track must be
// finishable (3 laps, no stuck car) in a sane time. node --no-warnings scripts/racer/check-tracks.mjs [days]
import { buildTrack, createRun, step, autopilot, DT, LAPS } from "../../public/viewer/racer-sim.js";
const days = Number(process.argv[2] || 60), ids = ["demo"];
for (let d = 0; d < days; d++) ids.push(new Date(Date.UTC(2026, 10, 10) + d * 86_400_000).toISOString().slice(0, 10));
let bad = 0; const laps = [], lens = [], walls = []; let tBuild = 0;
for (const id of ids) {
  const t0 = performance.now(); let T;
  try { T = buildTrack(id); } catch (e) { bad++; console.log(id, "NO TRACK"); continue; }
  tBuild += performance.now() - t0;
  const r = createRun(T); let w = 0, steps = 0;
  while (!r.done && steps < 600 / DT) { for (const e of step(r, autopilot(r))) if (e.type === "wall") w++; steps++; }
  if (!r.done) { bad++; console.log(id, "NOT FINISHED lap", r.lap, "idx", r.idx, "/", T.N); continue; }
  laps.push(r.laps[1] / 1000); lens.push(T.length); walls.push(w);
}
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1], mn = (a) => Math.min(...a), mx = (a) => Math.max(...a);
console.log(`${ids.length} tracks · bad ${bad} · length ${mn(lens)}/${med(lens)}/${mx(lens)} · lap s ${mn(laps).toFixed(1)}/${med(laps).toFixed(1)}/${mx(laps).toFixed(1)} · walls med ${med(walls)} · build avg ${(tBuild / ids.length).toFixed(1)} ms`);
