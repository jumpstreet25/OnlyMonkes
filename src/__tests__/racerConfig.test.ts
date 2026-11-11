import { parseRacerConfig, racerVisible } from "@/lib/racer/config";
import { isDailyTrack } from "@/lib/racer/run";

jest.mock("@/lib/royaleProof", () => ({ holderGameProof: jest.fn() }));
jest.mock("@/lib/bananaRewards", () => ({ addBananas: jest.fn() }));
jest.mock("@/store/appStore", () => ({ useAppStore: { getState: () => ({}) } }));

describe("Monke RC", () => {
  test("the shipped config is a dark launch (admin + testers)", () => {
    const cfg = parseRacerConfig(require("../../config/racer.json"));
    expect(cfg.enabled).toBe(true);
    expect(cfg.testersOnly).toBe(true);
    expect(racerVisible(cfg, true, null)).toBe(true);
    expect(racerVisible(cfg, false, "someone")).toBe(false);
  });
  test("only daily track ids go to the board", () => {
    expect(isDailyTrack("2026-11-11")).toBe(true);
    expect(isDailyTrack("demo")).toBe(false);
  });
});
