import { isAllowedBotCommand } from "../lib/botCommandAllowlist";

describe("isAllowedBotCommand", () => {
  it("allows autonomonke status/setup/portfolio", () => {
    expect(isAllowedBotCommand("/autonomonke")).toBe(true);
    expect(isAllowedBotCommand("/autonomonke status")).toBe(true);
    expect(isAllowedBotCommand("/portfolio")).toBe(true);
    expect(isAllowedBotCommand('/autonomonke setup {"mainWallet":"Abc","maxSOL":2}')).toBe(true);
  });

  it("rejects fund-moving commands", () => {
    expect(isAllowedBotCommand("/autonomonke withdraw")).toBe(false);
    expect(isAllowedBotCommand("/autonomonke close $BONK")).toBe(false);
    expect(isAllowedBotCommand("hello")).toBe(false);
  });
});
