jest.mock("@/hooks/useXmtp", () => ({ getXmtpClient: jest.fn() }));
jest.mock("@/lib/xmtp", () => ({ getWalletBoundSigner: jest.fn() }));

import { getXmtpClient } from "@/hooks/useXmtp";
import { getWalletBoundSigner } from "@/lib/xmtp";
import { orderDevices, removeLinkedDevices } from "@/lib/xmtpDevices";

describe("linked devices", () => {
  it("lists this device first, then newest first", () => {
    const d = orderDevices([{ id: "a", createdAt: 1 }, { id: "me", createdAt: 2 }, { id: "b", createdAt: 3 }, { id: "c" }], "me");
    expect(d.map((x) => x.id)).toEqual(["me", "b", "a", "c"]);
    expect(d[0].isThisDevice).toBe(true);
  });

  it("never removes this device and signs with the wallet-bound key", async () => {
    const revokeInstallations = jest.fn();
    (getXmtpClient as jest.Mock).mockReturnValue({ installationId: "me", revokeInstallations });
    (getWalletBoundSigner as jest.Mock).mockResolvedValue("signer");
    await removeLinkedDevices(["me", "old"]);
    expect(revokeInstallations).toHaveBeenCalledWith("signer", ["old"]);
    revokeInstallations.mockClear();
    await removeLinkedDevices(["me"]);
    expect(revokeInstallations).not.toHaveBeenCalled();
  });

  it("asks for a wallet reconnect when the key isn't on this phone", async () => {
    (getXmtpClient as jest.Mock).mockReturnValue({ installationId: "me", revokeInstallations: jest.fn() });
    (getWalletBoundSigner as jest.Mock).mockResolvedValue(null);
    await expect(removeLinkedDevices(["old"])).rejects.toThrow(/Reconnect/);
  });
});
