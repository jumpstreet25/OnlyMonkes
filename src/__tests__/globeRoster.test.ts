import { useAppStore } from "../store/appStore";
import { applyLocationSync, getGlobeRoster, getLocatedUserCount, globeName } from "../lib/userProfile";

jest.mock("../lib/constants", () => ({ BOT_INBOX_IDS: ["bot1"] }));
jest.mock("../lib/inboxLinking", () => ({ isMineInbox: (a: string, b: string) => a === b || a === "myOldInbox" }));

describe("MonkeGlobe roster", () => {
  it("is null until the bot sends a one-per-holder list (old bot payload has no d)", () => {
    applyLocationSync({ a: { u: "A", loc: "Austin" } });
    expect(getGlobeRoster("me")).toBeNull();
  });

  it("every device counts the bot's roster + me + the bot pin, and my other inboxes are left out", () => {
    useAppStore.setState({ myInboxId: "me", location: "Denver" } as never);
    applyLocationSync({
      a: { u: "A", loc: "Austin", d: 1 },
      b: { u: "", loc: "Boston", d: 1 },
      myOldInbox: { u: "Me", loc: "Denver", d: 1 },
    });
    expect(getGlobeRoster("me")).toEqual(["a", "b"]);
    expect(getLocatedUserCount()).toBe(2 + 1 + 1);
  });

  it("a holder with no name gets their monke number, else a generic label", () => {
    expect(globeName("Jump.skr", null)).toBe("Jump.skr");
    expect(globeName("", null)).toBe("Saga Monke holder");
    expect(globeName("  ", undefined)).toBe("Saga Monke holder");
  });
});
