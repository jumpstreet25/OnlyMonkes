const mockWallet = { address: "Wallet111" as string | undefined };
jest.mock("@/store/appStore", () => ({ useAppStore: { getState: () => ({ wallet: mockWallet.address ? mockWallet : null }) } }));
const mockGetMyReferral = jest.fn();
jest.mock("@/lib/referrals", () => ({
  getMyReferral: (...a: unknown[]) => mockGetMyReferral(...a),
  isReferralError: (r: unknown) => !!r && typeof r === "object" && "error" in (r as object),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { FALLBACK_SHARE_LINK, addShareLink, getShareLink, prepareShareLink, rememberShareLink, withShareLink } from "@/lib/shareLink";

describe("share links", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockGetMyReferral.mockReset();
    mockWallet.address = "Wallet111";
  });

  it("appends the link once, on its own line", () => {
    expect(withShareLink("+12% on $ORE ", "https://onlymonkes.app/r/ABCDEF")).toBe("+12% on $ORE\nhttps://onlymonkes.app/r/ABCDEF");
    expect(withShareLink("see onlymonkes.app/get", "https://onlymonkes.app/r/ABCDEF")).toBe("see onlymonkes.app/get");
  });

  it("uses the cached invite without asking the server", async () => {
    await rememberShareLink("Wallet111", "https://onlymonkes.app/r/ABCDEF");
    expect(await getShareLink()).toBe("https://onlymonkes.app/r/ABCDEF");
    expect(mockGetMyReferral).not.toHaveBeenCalled();
  });

  it("looks the invite up without a wallet prompt, and falls back to /get", async () => {
    mockGetMyReferral.mockResolvedValueOnce({ url: "https://onlymonkes.app/r/QWERTY" });
    expect(await getShareLink()).toBe("https://onlymonkes.app/r/QWERTY");
    expect(mockGetMyReferral).toHaveBeenCalledWith({ canPrompt: false });
    mockGetMyReferral.mockResolvedValueOnce({ error: "This phone isn't verified yet." });
    expect(await getShareLink()).toBe(FALLBACK_SHARE_LINK);
    mockWallet.address = undefined;
    expect(await addShareLink("hi")).toBe(`hi\n${FALLBACK_SHARE_LINK}`);
  });

  it("never caches or shares a URL that isn't an onlymonkes invite", async () => {
    await rememberShareLink("Wallet111", "https://evil.example/r/ABCDEF");
    mockGetMyReferral.mockResolvedValueOnce({ url: "https://evil.example/x" });
    expect(await getShareLink()).toBe(FALLBACK_SHARE_LINK);
  });

  it("after sign-in fetches the invite once (wallet prompt allowed), then waits a week after a miss", async () => {
    Object.defineProperty(Platform, "OS", { get: () => "android", configurable: true });
    mockGetMyReferral.mockResolvedValue({ error: "declined" });
    await prepareShareLink();
    expect(mockGetMyReferral).toHaveBeenCalledWith();
    await prepareShareLink();
    expect(mockGetMyReferral).toHaveBeenCalledTimes(1);
  });

  it("skips the after-sign-in fetch when the invite is already cached", async () => {
    await rememberShareLink("Wallet111", "https://onlymonkes.app/r/ABCDEF");
    await prepareShareLink();
    expect(mockGetMyReferral).not.toHaveBeenCalled();
  });
});
