jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

import {
  rememberLocalInboxId,
  loadLocalInboxIds,
  getRememberedInboxIds,
} from "../lib/localInboxes";

describe("localInboxes", () => {
  const wallet = "7tLrnPvgcR5mLtyUcVwvmhAD1wXbAKgWcLBPWxpwyZ1J";

  it("remembers leftover inboxes for this device+wallet", async () => {
    await rememberLocalInboxId(wallet, "inbox-saga");
    await rememberLocalInboxId(wallet, "inbox-seeker");
    await rememberLocalInboxId(wallet, "inbox-saga");
    const ids = await loadLocalInboxIds(wallet);
    expect(ids).toEqual(expect.arrayContaining(["inbox-saga", "inbox-seeker"]));
    expect(getRememberedInboxIds().has("inbox-saga")).toBe(true);
  });
});
