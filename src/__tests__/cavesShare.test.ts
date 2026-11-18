jest.mock("react-native", () => ({ Linking: { openURL: jest.fn(() => Promise.resolve()) } }));
jest.mock("@/lib/shareLink", () => ({ addShareLink: (t: string) => Promise.resolve(t) }));
import { cavesClearUrl } from "../lib/shareToX";

describe("MonkeCaves clear share link", () => {
  test("builds the card link", () => {
    expect(cavesClearUrl(8982, 2, "A", 1613)).toBe("https://onlymonkes.app/monke/8982/cave/2/A/1613");
  });
  test("refuses anything off-pattern", () => {
    expect(cavesClearUrl(0, 2, "A", 1613)).toBeNull();
    expect(cavesClearUrl(8982, 10, "A", 1613)).toBeNull();
    expect(cavesClearUrl(8982, 2, "Z", 1613)).toBeNull();
    expect(cavesClearUrl(8982, 2, "A/../x", 1613)).toBeNull();
    expect(cavesClearUrl(8982, 2, "A", 50)).toBeNull();
    expect(cavesClearUrl(8982, NaN, "A", 1613)).toBeNull();
  });
});
