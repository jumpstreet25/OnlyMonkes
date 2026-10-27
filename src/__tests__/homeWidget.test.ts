jest.mock("@/lib/notifications", () => ({
  notificationPreviewText: (s: string) => (s.startsWith("IMAGE:") ? "📷 Photo" : s),
}));
jest.mock("@/lib/appLock", () => ({ useAppLock: { getState: () => ({ enabled: false }), subscribe: () => () => {} } }));
import { widgetLine } from "@/lib/homeWidget";

describe("widgetLine", () => {
  it("turns MSG:<name>:<text> into 'name: text'", () => {
    expect(widgetLine("MSG:jump:gm monkes")).toBe("jump: gm monkes");
    expect(widgetLine("MSG:AI Agent #9385:🍌 BOUNCE WATCH $QI")).toBe("AI Agent #9385: 🍌 BOUNCE WATCH $QI");
  });
  it("uses the given name for plain text and previews media", () => {
    expect(widgetLine("hello there", "nana")).toBe("nana: hello there");
    expect(widgetLine("MSG:nana:IMAGE:https://x/y.png")).toBe("nana: 📷 Photo");
  });
  it("keeps it to one short line", () => {
    expect(widgetLine("a\n\nb   c")).toBe("a b c");
    expect(widgetLine("x".repeat(300)).length).toBe(120);
  });
});
