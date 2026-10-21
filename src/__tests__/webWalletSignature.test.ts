jest.mock("@wallet-standard/app", () => ({ getWallets: () => ({ get: () => [], on: () => () => {} }) }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
jest.mock("@xmtp/react-native-sdk", () => ({ PublicIdentity: class {} }));

import { signMessageMwaFormat } from "../web/walletStandard";
import { deriveXmtpEoa, xmtpIdentityMessageBytes } from "../lib/xmtpIdentity";

const WALLET = "7tLrnPvgcR5mLtyUcVwvmhAD1wXbAKgWcLBPWxpwyZ1J";
const message = xmtpIdentityMessageBytes(WALLET, 0);
const signature = Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 3) & 0xff);
const mwaPayload = new Uint8Array([...message, ...signature]);

function walletReturning(signedMessage: Uint8Array) {
  return {
    features: {
      "solana:signMessage": { signMessage: async () => [{ signedMessage, signature }] },
    },
  } as any;
}

describe("web wallet signatures match the phone's MWA bytes", () => {
  it("extension wallet (signedMessage = bare message) → message + signature", async () => {
    const out = await signMessageMwaFormat(walletReturning(message), {} as any, message);
    expect(Array.from(out)).toEqual(Array.from(mwaPayload));
  });

  it("Seeker Connect (signedMessage = MWA payload) → passed through unchanged", async () => {
    const out = await signMessageMwaFormat(walletReturning(mwaPayload), {} as any, message);
    expect(Array.from(out)).toEqual(Array.from(mwaPayload));
  });

  it("both paths derive the same XMTP identity as the phone", async () => {
    const ext = await signMessageMwaFormat(walletReturning(message), {} as any, message);
    const seeker = await signMessageMwaFormat(walletReturning(mwaPayload), {} as any, message);
    const phone = deriveXmtpEoa(mwaPayload, WALLET, 0).address;
    expect(deriveXmtpEoa(ext, WALLET, 0).address).toBe(phone);
    expect(deriveXmtpEoa(seeker, WALLET, 0).address).toBe(phone);
  });
});
