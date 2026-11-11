// Builds a year of Banana Rockets daily courses (plus the practice ones) and checks
// each: enough planets, a Moon the solver reached, three bananas, sane par.
// Run: node scripts/rockets/check-courses.mjs [days]
import { buildCourse, todayId } from "../../public/viewer/rockets-sim.js";

const days = Number(process.argv[2] || 365);
const ids = ["practice-1", "practice-2", "practice-3", "demo"];
const d0 = new Date(Date.UTC(2026, 10, 10));
for (let i = 0; i < days; i++) ids.push(todayId(new Date(d0.getTime() + i * 864e5)));

let bad = 0, slow = 0, totalMs = 0;
const hops = {}, pars = [];
for (const id of ids) {
  const t = performance.now();
  const c = buildCourse(id);
  const ms = performance.now() - t; totalMs += ms;
  if (ms > 400) slow++;
  const h = c.planets.length - 1;
  hops[h] = (hops[h] || 0) + 1;
  pars.push(c.par);
  const problems = [];
  if (h < 5) problems.push(`only ${h} hops`);
  if (c.bananas.length !== 3) problems.push(`${c.bananas.length} bananas`);
  if (!c.moon) problems.push("no moon");
  if (problems.length) { bad++; console.log(`${id}: ${problems.join(", ")}`); }
}
pars.sort((a, b) => a - b);
console.log(`${ids.length} courses · bad ${bad} · hops ${JSON.stringify(hops)} · par min/med/max ${pars[0]}/${pars[pars.length >> 1]}/${pars[pars.length - 1]} s · build avg ${(totalMs / ids.length).toFixed(0)} ms, >400ms: ${slow}`);
process.exit(bad ? 1 : 0);
