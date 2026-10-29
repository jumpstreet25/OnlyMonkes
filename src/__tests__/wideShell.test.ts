jest.mock("@/lib/constants", () => ({ THEME: {}, FONTS: {} }));
jest.mock("@/store/appStore", () => ({ useAppStore: jest.fn() }));
jest.mock("@/store/tradesStore", () => ({ useTradesStore: jest.fn() }));
jest.mock("@/components/MenuIcon", () => ({ MenuIcon: () => null }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, usePathname: jest.fn() }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { railItems, isRailActive } from "../components/WideShell.web";

const t = (k: string) => k;

describe("wide web layout rail", () => {
  test("Genesis-only holders see Genesis Chat only", () => {
    expect(railItems(t, false, true).map((i) => i.path)).toEqual(["/genesis-chat"]);
    expect(railItems(t, false, false)).toEqual([]);
  });

  test("Monke holders get chats first, Genesis only when they hold it", () => {
    const monke = railItems(t, true, false).map((i) => i.path);
    expect(monke.slice(0, 3)).toEqual(["/chat", "/bot-channel?channelId=trades", "/dms"]);
    expect(monke).not.toContain("/genesis-chat");
    expect(railItems(t, true, true).map((i) => i.path)[1]).toBe("/genesis-chat");
  });

  test("active entry follows the current route", () => {
    const items = railItems(t, true, false);
    const byPath = (p: string) => items.find((i) => i.path === p)!;
    expect(isRailActive(byPath("/bot-channel?channelId=trades"), "/bot-channel")).toBe(true);
    expect(isRailActive(byPath("/dms"), "/dm/abc")).toBe(true);
    expect(isRailActive(byPath("/chat"), "/chat")).toBe(true);
    expect(isRailActive(byPath("/chat"), "/portfolio")).toBe(false);
  });
});
