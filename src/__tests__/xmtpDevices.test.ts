jest.mock("@/hooks/useXmtp", () => ({ getXmtpClient: jest.fn() }));
jest.mock("@/lib/xmtp", () => ({ getWalletBoundSigner: jest.fn() }));

import { getXmtpClient } from "@/hooks/useXmtp";
import { getWalletBoundSigner } from "@/lib/xmtp";
import { listLinkedDevices, orderDevices, removeLinkedDevices } from "@/lib/xmtpDevices";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

const signer = { getIdentifier: async () => ({ identifier: "0xABC" }) };

function client(over: Record<string, unknown> = {}) {
  return {
    installationId: "me",
    revokeInstallations: jest.fn(),
    inboxState: jest.fn(async () => ({ installations: [{ id: "me" }, { id: "old" }], recoveryIdentifier: "0xabc" })),
    ...over,
  };
}

describe("linked devices", () => {
  it("lists this device first, then newest first, matching ids without case or 0x", () => {
    const d = orderDevices([{ id: "a", createdAt: 1 }, { id: "0xAB12", createdAt: 2 }, { id: "b", createdAt: 3 }, { id: "c" }], "ab12");
    expect(d.map((x) => x.id)).toEqual(["0xAB12", "b", "a", "c"]);
    expect(d[0].isThisDevice).toBe(true);
  });

  it("refuses to list when this device isn't in the inbox, so nothing can be removed", async () => {
    (getXmtpClient as jest.Mock).mockReturnValue(client({ inboxState: async () => ({ installations: [{ id: "x" }] }) }));
    await expect(listLinkedDevices()).rejects.toMatchObject({ code: "THIS_DEVICE_UNKNOWN" });
  });

  it("never removes this device and signs with the wallet-bound key", async () => {
    const c = client();
    (getXmtpClient as jest.Mock).mockReturnValue(c);
    (getWalletBoundSigner as jest.Mock).mockResolvedValue(signer);
    await removeLinkedDevices(["0xME", "old"]);
    expect(c.revokeInstallations).toHaveBeenCalledWith(signer, ["old"]);
    c.revokeInstallations.mockClear();
    await removeLinkedDevices(["me"]);
    expect(c.revokeInstallations).not.toHaveBeenCalled();
  });

  it("explains instead of failing when the key isn't here or isn't the recovery key", async () => {
    (getXmtpClient as jest.Mock).mockReturnValue(client());
    (getWalletBoundSigner as jest.Mock).mockResolvedValue(null);
    await expect(removeLinkedDevices(["old"])).rejects.toMatchObject({ code: "NEEDS_WALLET" });
    (getXmtpClient as jest.Mock).mockReturnValue(
      client({ inboxState: async () => ({ installations: [], recoveryIdentifier: "0xother" }) }),
    );
    (getWalletBoundSigner as jest.Mock).mockResolvedValue(signer);
    await expect(removeLinkedDevices(["old"])).rejects.toMatchObject({ code: "NOT_RECOVERY_KEY" });
  });

  it("has every error text in English and Spanish", () => {
    for (const code of ["NOT_CONNECTED", "THIS_DEVICE_UNKNOWN", "NEEDS_WALLET", "NOT_RECOVERY_KEY"]) {
      expect((en.linkedDevices.error as Record<string, string>)[code]).toBeTruthy();
      expect((es.linkedDevices.error as Record<string, string>)[code]).toBeTruthy();
    }
  });
});
