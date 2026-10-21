jest.mock("@wallet-standard/app", () => ({ getWallets: () => ({ get: () => [], on: () => () => {} }) }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock("@xmtp/react-native-sdk", () => ({ PublicIdentity: class {} }));

import { webcrypto } from "node:crypto";
import { x25519 } from "@noble/curves/ed25519";
import { formatShortCode, normalizeShortCode, openBundle, pairCode, readPairLink, sealBundle, toB64url, type PairBundle } from "../web/pairing";

if (!(globalThis as any).crypto?.subtle) (globalThis as any).crypto = webcrypto;

const bundle: PairBundle = { wallet: "7tLrnPvgcR5mLtyUcVwvmhAD1wXbAKgWcLBPWxpwyZ1J", token: "a.b.c", expiresAt: 1, tier: "monke", identity: "AAAA" };
const id = "0123456789abcdef0123456789abcdef";

describe("phone → desktop pairing crypto", () => {
  const desktopPriv = x25519.utils.randomPrivateKey();
  const desktopKey = toB64url(x25519.getPublicKey(desktopPriv));

  it("the desktop opens what the phone sealed", async () => {
    const sealed = await sealBundle(desktopKey, id, bundle);
    await expect(openBundle(desktopPriv, id, sealed)).resolves.toEqual(bundle);
  });

  it("another key, another pairing id, or altered data cannot open it", async () => {
    const sealed = await sealBundle(desktopKey, id, bundle);
    await expect(openBundle(x25519.utils.randomPrivateKey(), id, sealed)).rejects.toBeTruthy();
    await expect(openBundle(desktopPriv, "f".repeat(32), sealed)).rejects.toBeTruthy();
    const flipped = sealed.data.startsWith("A") ? "B" + sealed.data.slice(1) : "A" + sealed.data.slice(1);
    await expect(openBundle(desktopPriv, id, { ...sealed, data: flipped })).rejects.toBeTruthy();
  });

  it("both screens show the same 4-digit code; links parse strictly", () => {
    expect(pairCode(desktopKey)).toMatch(/^\d{4}$/);
    expect(pairCode(desktopKey)).toBe(pairCode(desktopKey));
    expect(readPairLink(`#id=${id}&k=${desktopKey}`)).toEqual({ id, desktopKey });
    expect(readPairLink("#id=nope&k=x")).toBeNull();
  });

  it("typed short codes forgive case, spaces, dashes and O/I/L typos", () => {
    expect(normalizeShortCode("k7q4-mx2p")).toBe("K7Q4MX2P");
    expect(normalizeShortCode(" K7Q4 MX2P ")).toBe("K7Q4MX2P");
    expect(normalizeShortCode("K7Q4MXOP")).toBe("K7Q4MX0P");
    expect(normalizeShortCode("K7Q4MXIL")).toBe("K7Q4MX11");
    expect(normalizeShortCode("K7Q4MX2")).toBeNull();
    expect(normalizeShortCode("K7Q4MX2U")).toBeNull();
    expect(formatShortCode("K7Q4MX2P")).toBe("K7Q4-MX2P");
  });
});
