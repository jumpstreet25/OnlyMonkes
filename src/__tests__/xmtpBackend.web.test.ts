import { pickXmtpBackend, XMTP_PRODUCTION_URL, XMTP_STAGING_URL } from "@/lib/xmtpBackend.web";

describe("pickXmtpBackend (web)", () => {
  it("production only on the public onlymonkes.app hosts", () => {
    expect(pickXmtpBackend("onlymonkes.app")).toBe(XMTP_PRODUCTION_URL);
    expect(pickXmtpBackend("www.onlymonkes.app")).toBe(XMTP_PRODUCTION_URL);
    expect(pickXmtpBackend("onlymonkes-web.jumpstreet25.workers.dev")).toBe(XMTP_PRODUCTION_URL);
  });
  it("staging for localhost, the harness and anything else", () => {
    expect(pickXmtpBackend("localhost")).toBe(XMTP_STAGING_URL);
    expect(pickXmtpBackend("127.0.0.1")).toBe(XMTP_STAGING_URL);
    expect(pickXmtpBackend("evil-onlymonkes.app")).toBe(XMTP_STAGING_URL);
    expect(pickXmtpBackend(null)).toBe(XMTP_STAGING_URL);
  });
});
