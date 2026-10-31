import { chromium } from "playwright-core";
import { randomBytes } from "node:crypto";
import { start, brHits } from "./server.mjs";
const server = await start(8787);
const browser = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), headless: true });
const results = []; const check = (name, ok, extra = "") => { results.push([name, ok]); console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const page = async () => { const ctx = await browser.newContext(); const p = await ctx.newPage(); p.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 200)); }); await p.goto("http://127.0.0.1:8787/"); await p.waitForFunction(() => globalThis.OM); return { ctx, p }; };
const keyA = randomBytes(32).toString("hex"), keyB = randomBytes(32).toString("hex");
try {
  let A = await page(), B = await page();
  const t0 = Date.now();
  const a = await A.p.evaluate(async (k) => { const w = OM.wallet(k); const c = await OM.Client.create(w.signer); globalThis.c = c; globalThis.w = w; return { inbox: c.inboxId, addr: w.address }; }, keyA);
  check("A: create client (wasm via brotli)", !!a.inbox, `${a.inbox.slice(0, 8)}… in ${((Date.now() - t0) / 1000).toFixed(1)}s, wasm br hits ${brHits.n}`);
  const b = await B.p.evaluate(async (k) => { const w = OM.wallet(k); const c = await OM.Client.create(w.signer); globalThis.c = c; globalThis.w = w; globalThis.got = []; await c.conversations.streamAllMessages(async (m) => { globalThis.got.push(typeof m.content === "function" ? m.content() : m.content); }); return { inbox: c.inboxId }; }, keyB);
  check("B: create client + start stream", !!b.inbox);
  const look = await A.p.evaluate(async (addr) => OM.Client.getInboxIdForIdentifier(new OM.PublicIdentity(addr, "ETHEREUM")), a.addr);
  check("inbox lookup by wallet", look === a.inbox);
  await A.p.evaluate(async (peer) => { const dm = await c.conversations.findOrCreateDm(peer); globalThis.dm = dm; await dm.send("MSG:tester:hello from A"); }, b.inbox);
  const dmRead = await B.p.evaluate(async () => { await c.conversations.syncAllConversations(); const dms = await c.conversations.listDms(); const msgs = dms.length ? await dms[0].messages({ limit: 10 }) : []; return msgs.map((m) => (typeof m.content === "function" ? m.content() : m.content)); });
  check("DM: B reads A's message", dmRead.some((x) => x === "MSG:tester:hello from A"), JSON.stringify(dmRead).slice(0, 120));
  await A.p.evaluate(async () => { await dm.send("MSG:tester:live"); });
  const live = await B.p.waitForFunction(() => globalThis.got.includes("MSG:tester:live"), null, { timeout: 20000 }).then(() => true).catch(() => false);
  check("stream: B gets a live DM", live);
  const g = await A.p.evaluate(async (peer) => { const grp = await c.conversations.newGroup([peer], { name: "harness group" }); globalThis.grp = grp; await grp.send("MSG:tester:group hi"); return grp.id; }, b.inbox);
  const gRead = await B.p.evaluate(async (id) => { await c.conversations.syncAllConversations(); const gs = await c.conversations.listGroups(); const grp = gs.find((x) => x.id === id); globalThis.grp = grp; if (!grp) return null; await grp.sync(); return (await grp.messages({ limit: 10 })).map((m) => (typeof m.content === "function" ? m.content() : m.content)); }, g);
  check("group: B sees the group and its message", Array.isArray(gRead) && gRead.includes("MSG:tester:group hi"), JSON.stringify(gRead)?.slice(0, 120));
  const target = await B.p.evaluate(async () => { const m = (await grp.messages({ limit: 5 })).find((x) => (typeof x.content === "function" ? x.content() : x.content) === "MSG:tester:group hi"); await grp.send({ reaction: { reference: m.id, action: "added", schema: "unicode", content: "🍌" } }); await grp.send({ reply: { reference: m.id, content: { text: "MSG:tester:a reply" } } }); return m.id; });
  const rr = await A.p.evaluate(async () => { await grp.sync(); const ms = await grp.messages({ limit: 20 }); return ms.map((m) => { const c = typeof m.content === "function" ? m.content() : m.content; return typeof c === "string" ? c : JSON.stringify(c); }); });
  check("reaction + reply round-trip", rr.some((x) => x.includes("🍌")) && rr.some((x) => x.includes("a reply")), JSON.stringify(rr).slice(0, 200));
  // Reload A: same wallet reopens its database (no new installation)
  const inst1 = await A.p.evaluate(() => c.installationId);
  await A.ctx.pages()[0].reload(); await A.p.waitForFunction(() => globalThis.OM);
  const re = await A.p.evaluate(async (k) => { const w = OM.wallet(k); const c = await OM.Client.build(new OM.PublicIdentity(w.address, "ETHEREUM")); await c.conversations.sync(); const gs = await c.conversations.listGroups(); return { inbox: c.inboxId, inst: c.installationId, groups: gs.length }; }, keyA);
  check("reload: build() reopens the same installation + history", re.inbox === a.inbox && re.inst === inst1 && re.groups >= 1, `groups ${re.groups}`);
} catch (e) { check("harness error", false, String(e).slice(0, 300)); }
await browser.close(); server.close();
const pass = results.filter((r) => r[1]).length; console.log(`\n${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
