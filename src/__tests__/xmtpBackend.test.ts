jest.mock("expo-application", () => ({ applicationId: "com.onlymonkes.app.next" }));

import { pickXmtpBackend, XMTP_PRODUCTION_URL, XMTP_STAGING_URL } from "@/lib/xmtpBackend";

describe("pickXmtpBackend", () => {
  it("production only for the store package in a release build", () => {
    expect(pickXmtpBackend("com.onlymonkes.app", false)).toBe(XMTP_PRODUCTION_URL);
  });
  it("staging for test flavors, dev builds and unknown packages", () => {
    expect(pickXmtpBackend("com.onlymonkes.app", true)).toBe(XMTP_STAGING_URL);
    expect(pickXmtpBackend("com.onlymonkes.app.next", false)).toBe(XMTP_STAGING_URL);
    expect(pickXmtpBackend("com.onlymonkes.app.canary", false)).toBe(XMTP_STAGING_URL);
    expect(pickXmtpBackend(null, false)).toBe(XMTP_STAGING_URL);
  });
});
