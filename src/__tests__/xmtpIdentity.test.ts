jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));
jest.mock("@xmtp/react-native-sdk", () => {
  class PublicIdentity {
    identifier: string;
    kind: string;
    constructor(identifier: string, kind: string) {
      this.identifier = identifier.toLowerCase();
      this.kind = kind;
    }
  }
  return { PublicIdentity };
});

import {
  deriveXmtpEoa,
  makeXmtpEoaSigner,
  xmtpIdentityMessage,
  xmtpIdentityMessageBytes,
  XMTP_IDENTITY_DOMAIN,
} from "../lib/xmtpIdentity";

const WALLET_A = "7tLrnPvgcR5mLtyUcVwvmhAD1wXbAKgWcLBPWxpwyZ1J";
const WALLET_B = "So11111111111111111111111111111111111111112";

function sigFrom(fill: number): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, i) => (fill + i) & 0xff);
}

describe("xmtpIdentity", () => {
  it("keeps a frozen domain string (changing it mints new inboxes)", () => {
    expect(XMTP_IDENTITY_DOMAIN).toBe("onlymonkes-xmtp-identity-v1");
  });

  it("includes the wallet in the signed message", () => {
    const msg = xmtpIdentityMessage(WALLET_A);
    expect(msg).toContain("OnlyMonkes XMTP identity v1");
    expect(msg).toContain(WALLET_A);
    expect(xmtpIdentityMessageBytes(WALLET_A)).toEqual(
      new TextEncoder().encode(msg),
    );
  });

  it("is deterministic for the same signature and wallet", () => {
    const sig = sigFrom(7);
    const a = deriveXmtpEoa(sig, WALLET_A);
    const b = deriveXmtpEoa(sig, WALLET_A);
    expect(a.address).toBe(b.address);
    expect(a.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(Buffer.from(a.privateKey)).toEqual(Buffer.from(b.privateKey));
  });

  it("changes when the Solana signature or wallet changes", () => {
    const a = deriveXmtpEoa(sigFrom(7), WALLET_A);
    const b = deriveXmtpEoa(sigFrom(8), WALLET_A);
    const c = deriveXmtpEoa(sigFrom(7), WALLET_B);
    expect(a.address).not.toBe(b.address);
    expect(a.address).not.toBe(c.address);
  });

  it("builds an EOA signer whose identifier is the derived address", async () => {
    const eoa = deriveXmtpEoa(sigFrom(3), WALLET_A);
    const signer = makeXmtpEoaSigner(eoa);
    const id = await signer.getIdentifier();
    expect(id.kind).toBe("ETHEREUM");
    expect(id.identifier).toBe(eoa.address);
    expect(signer.signerType()).toBe("EOA");
    const signed = await signer.signMessage("xmtp auth");
    expect(signed.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });
});
