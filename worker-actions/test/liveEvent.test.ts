/** @jest-environment node */
jest.mock("@cf-wasm/photon/workerd", () => ({ PhotonImage: {} }), { virtual: true });
jest.mock("qrcode/lib/core/qrcode", () => jest.requireActual("qrcode/lib/core/qrcode"));
import { writeFileSync } from "fs";
import { cleanLivePoll, handleLive } from "../src/liveEvent";
import { liveCardLines, liveInviteCard } from "../src/referrals";

const kv = new Map<string, string>();
const env: any = { BOT_HTTP_SECRET: "s3", COMMUNITY_DATA: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) } };
const poll = { id: "poll-1794613855027-nwa6rz", question: "When?", options: [{ id: "opt-0", label: "5pm <b>", votes: 3 }, { id: "opt-1", label: "6pm", votes: 1 }], resolvesAt: 1794693658714, status: "open" };
const post = (auth: string, body: unknown) => handleLive(new Request("https://x/api/live/poll", { method: "POST", headers: { authorization: auth }, body: JSON.stringify(body) }), env, "/api/live/poll");

describe("Monke Live", () => {
  test("card lines", () => expect(liveCardLines()).toEqual(["SAT NOV 14 - 5:00 PM EST", "2PM PT - 10PM UK - SUN 9AM SYD"]));
  test("only the bot can post the tally; labels are cleaned", async () => {
    expect((await post("Bearer nope", poll)).status).toBe(401);
    expect((await post("Bearer s3", { ...poll, id: "../x" })).status).toBe(400);
    expect((await post("Bearer s3", poll)).status).toBe(200);
    const got = await (await handleLive(new Request("https://x/api/live"), env, "/api/live")).json();
    expect(got.poll.options[0]).toEqual({ id: "opt-0", label: "5pm  b", votes: 3 });
    expect(got.event.start).toBe(Date.UTC(2026, 10, 14, 22, 0));
  });
  test("refuses junk", () => {
    expect(cleanLivePoll({ ...poll, options: [{ id: "x", label: "a", votes: 1 }, { id: "opt-1", label: "b", votes: 0 }] })).toBeNull();
    expect(cleanLivePoll(null)).toBeNull();
  });
  test("event card renders", async () => {
    const realFetch = globalThis.fetch; globalThis.fetch = (async () => new Response("no", { status: 503 })) as any;
    try { const c = await liveInviteCard("ABC234", { n: "Jump.skr", p: 8982 } as any); writeFileSync("/tmp/claude-1000/-home-jump-OnlyMonkes/6be153fc-98f2-4e09-a04a-d3520bc4787f/scratchpad/livecard.png", c.png); expect(c.png.length).toBeGreaterThan(1000); }
    finally { globalThis.fetch = realFetch; }
  });
});
