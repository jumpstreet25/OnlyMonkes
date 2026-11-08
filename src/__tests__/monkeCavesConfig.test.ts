import { monkeCavesVisible, parseMonkeCavesConfig, DEFAULT_MONKECAVES_CONFIG } from "@/lib/monkeCaves/config";
import { walletHash } from "@/lib/monkeMeme/config";

const W = "7tLrUKmkcBRVmwXtiRo8cTj6Mw2TGhFxyeNmKaU9mqZx";

describe("MonkeCaves dark launch", () => {
  test("a failed fetch stays hidden for normal holders", () => {
    expect(monkeCavesVisible(DEFAULT_MONKECAVES_CONFIG, false, W)).toBe(false);
    expect(monkeCavesVisible(null, true, W)).toBe(false);
  });
  test("admin and listed testers see it; testersOnly false opens it", () => {
    const cfg = parseMonkeCavesConfig({ testersOnly: true, testerWalletHashes: [walletHash(W), "not-a-hash"] });
    expect(cfg.testerWalletHashes).toEqual([walletHash(W)]);
    expect(monkeCavesVisible(cfg, true, null)).toBe(true);
    expect(monkeCavesVisible(cfg, false, W)).toBe(true);
    expect(monkeCavesVisible(cfg, false, "someoneElse")).toBe(false);
    expect(monkeCavesVisible(parseMonkeCavesConfig({ testersOnly: false }), false, null)).toBe(true);
    expect(monkeCavesVisible(parseMonkeCavesConfig({ enabled: false, testersOnly: false }), true, W)).toBe(false);
  });
  test("the shipped config is a dark launch", () => {
    const cfg = parseMonkeCavesConfig(require("../../config/monkecaves.json"));
    expect(cfg.testersOnly).toBe(true);
  });
});
