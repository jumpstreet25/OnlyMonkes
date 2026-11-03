jest.mock("expo-updates", () => ({ runtimeVersion: "3.4" }));

import { DISMISS_MS, parseAppUpdateConfig, shouldShowUpdateBanner } from "@/lib/appUpdateNotice";
import cfgFile from "../../config/app-update.json";

describe("app update banner", () => {
  const on = parseAppUpdateConfig({ enabled: true, runtimes: ["3.4"] });
  const now = 10 * DISMISS_MS;

  it("ships switched off", () => {
    expect(parseAppUpdateConfig(cfgFile).enabled).toBe(false);
  });

  it("bad or missing config stays off", () => {
    expect(parseAppUpdateConfig(null)).toEqual({ enabled: false, required: false, runtimes: [] });
    expect(parseAppUpdateConfig({ enabled: "yes", runtimes: [3.4] })).toEqual({ enabled: false, required: false, runtimes: [] });
  });

  it("shows only on the listed runtimes, so 3.1 never nags itself", () => {
    expect(shouldShowUpdateBanner(on, "3.4", null, now)).toBe(true);
    expect(shouldShowUpdateBanner(on, "3.5", null, now)).toBe(false);
    expect(shouldShowUpdateBanner(on, null, null, now)).toBe(false);
  });

  it("a dismiss hides it for a day unless the update is required", () => {
    expect(shouldShowUpdateBanner(on, "3.4", now - 1000, now)).toBe(false);
    expect(shouldShowUpdateBanner(on, "3.4", now - DISMISS_MS, now)).toBe(true);
    const req = parseAppUpdateConfig({ enabled: true, required: true, runtimes: ["3.4"] });
    expect(shouldShowUpdateBanner(req, "3.4", now - 1000, now)).toBe(true);
  });
});
