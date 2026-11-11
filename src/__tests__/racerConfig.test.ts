import { parseRacerConfig, racerVisible } from "@/lib/racer/config";
import { isDailyTrack } from "@/lib/racer/run";

jest.mock("@/lib/royaleProof", () => ({ holderGameProof: jest.fn() }));
jest.mock("@/lib/bananaRewards", () => ({ addBananas: jest.fn() }));
jest.mock("@/store/appStore", () => ({ useAppStore: { getState: () => ({}) } }));

describe("Monke RC", () => {
  test("the shipped config is open to every holder (2026-11-11)", () => {
    const cfg = parseRacerConfig(require("../../config/racer.json"));
    expect(cfg.enabled).toBe(true);
    expect(cfg.testersOnly).toBe(false);
    expect(racerVisible(cfg, false, "someone")).toBe(true);
    expect(racerVisible({ ...cfg, testersOnly: true }, false, "someone")).toBe(false);
  });
  test("only daily track ids go to the board", () => {
    expect(isDailyTrack("2026-11-11")).toBe(true);
    expect(isDailyTrack("demo")).toBe(false);
  });
});
