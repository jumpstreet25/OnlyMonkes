/** @jest-environment node */
import { LIVE_EVENT, liveZoneTime, renderLive } from "../src/site";

describe("/live event page", () => {
  test("start is 5 PM Eastern on Sat Nov 14", () => {
    expect(liveZoneTime(LIVE_EVENT.start, "America/New_York")).toBe("Sat 5:00 PM");
    expect(liveZoneTime(LIVE_EVENT.start, "America/Los_Angeles")).toBe("Sat 2:00 PM");
    expect(liveZoneTime(LIVE_EVENT.start, "Europe/London")).toBe("Sat 10:00 PM");
    expect(liveZoneTime(LIVE_EVENT.start, "Asia/Kolkata")).toBe("Sun 3:30 AM");
  });
  test("page has the zones table, calendar links and app links", async () => {
    const html = await renderLive(LIVE_EVENT.start - 3_600_000).text();
    for (const s of ["Sat 5:00 PM ET", "Sun 9:00 AM", "calendar.google.com", "text/calendar", 'href="/open/chat"', 'href="/get"', "tensor.trade", "x.com/intent/tweet"]) expect(html).toContain(s);
    expect(html).toContain("LIVE AVATAR ROOM");
  });
  test("phases", async () => {
    expect(await renderLive(LIVE_EVENT.start + 60_000).text()).toContain("● LIVE NOW");
    expect(await renderLive(LIVE_EVENT.start + 4 * 3_600_000).text()).toContain("This hangout has ended");
  });
});
