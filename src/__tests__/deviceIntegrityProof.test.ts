jest.mock("@/lib/deviceAttest", () => ({
  getDevicePublicKeyBase64: async () => "REVWS0VZ",
  getDeviceAttestationCertChain: async () => ["Q0VSVA=="],
  signWithDeviceKey: async () => "REVWU0lH",
}));
jest.mock("@/lib/security", () => ({ getActiveThreats: () => [] }));

import { issueDeviceIntegrityAttestation } from "@/lib/deviceIntegrity";
import { rememberSignIn, takeSignIn } from "@/lib/signInProof";

const calls: { url: string; body?: Record<string, unknown> }[] = [];

beforeEach(() => {
  calls.length = 0;
  global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.includes("/challenge")) return { ok: true, json: async () => ({ nonce: "server-nonce" }) };
    return { ok: true, status: 200, json: async () => ({ status: "clean", holderTier: "sagaMonke", expiresAt: 1 }) };
  }) as unknown as typeof fetch;
});

describe("Device Integrity wallet proof", () => {
  it("uses the connect screen's sign-in once, with its nonce and no wallet prompt", async () => {
    rememberSignIn("Wallet111", "signin-nonce", { signed_message: "bXNn-_", signature: "c2ln" });
    const signMessage = jest.fn();
    const r = await issueDeviceIntegrityAttestation("Wallet111", signMessage);
    expect(r.status).toBe("clean");
    expect(signMessage).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.includes("/challenge"))).toBe(false);
    const body = calls[0].body!;
    expect(body.nonce).toBe("signin-nonce");
    expect(body.signInMessageBase64).toBe("bXNn+/==");
    expect(body.signInSignatureBase64).toBe("c2ln");
    expect(body.walletSigBase64).toBeUndefined();
    expect(takeSignIn("Wallet111")).toBeNull();
  });

  it("refreshes with the phone's key alone when there is no sign-in and no prompt allowed", async () => {
    await issueDeviceIntegrityAttestation("Wallet111", null);
    const body = calls[1].body!;
    expect(body.nonce).toBe("server-nonce");
    expect(body.refresh).toBe(true);
    expect(body.walletSigBase64).toBeUndefined();
  });

  it("falls back to a wallet signature only when one is passed", async () => {
    const signMessage = jest.fn(async () => new Uint8Array([1, 2, 3]));
    await issueDeviceIntegrityAttestation("Wallet111", signMessage);
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(calls[1].body!.walletSigBase64).toBe("AQID");
  });

  it("ignores a sign-in from another wallet", async () => {
    rememberSignIn("OtherWallet", "signin-nonce", { signed_message: "bXNn", signature: "c2ln" });
    await issueDeviceIntegrityAttestation("Wallet111", null);
    expect(calls[1].body!.refresh).toBe(true);
  });
});
