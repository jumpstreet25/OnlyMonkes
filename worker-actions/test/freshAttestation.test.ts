import { webcrypto } from "crypto";
import "reflect-metadata";
import * as x509 from "@peculiar/x509";
import { AsnConvert, OctetString } from "@peculiar/asn1-schema";
import { NonStandardAuthorizationList, NonStandardKeyDescription, SecurityLevel } from "@peculiar/asn1-android";

jest.mock("../src/index", () => ({ fetchOwnedMonke: jest.fn() }));
jest.mock("../src/genesisVerify", () => ({ verifyGenesisTokenOwnership: jest.fn() }));

import { verifyKeyAttestationChain } from "../src/deviceIntegrity";

if (!globalThis.crypto?.subtle) (globalThis as any).crypto = webcrypto;
x509.cryptoProvider.set(webcrypto as unknown as Crypto);

const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
const DAY = 24 * 3600 * 1000;
const b64 = (c: x509.X509Certificate) => Buffer.from(c.rawData).toString("base64");

/** Test root → intermediate → leaf with a KeyDescription carrying `challenge`, like a phone's
 *  chain but rooted at a test CA (nothing can sign as Google's real root). */
async function chain(challenge: string, intermediateDates = { from: Date.now() - DAY, to: Date.now() + 14 * DAY }) {
  const keys = async () => (await webcrypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  const [rootK, midK, leafK] = await Promise.all([keys(), keys(), keys()]);
  const root = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01", name: "CN=Test Root", notBefore: new Date(Date.now() - 365 * DAY), notAfter: new Date(Date.now() + 365 * DAY),
    keys: rootK, signingAlgorithm: ALG,
  });
  const mid = await x509.X509CertificateGenerator.create({
    serialNumber: "02", subject: "CN=Test Intermediate", issuer: root.subject,
    notBefore: new Date(intermediateDates.from), notAfter: new Date(intermediateDates.to),
    publicKey: midK.publicKey, signingKey: rootK.privateKey, signingAlgorithm: ALG,
  });
  const kd = new NonStandardKeyDescription({
    attestationVersion: 200,
    attestationSecurityLevel: SecurityLevel.trustedEnvironment,
    keymasterVersion: 200,
    keymasterSecurityLevel: SecurityLevel.trustedEnvironment,
    attestationChallenge: new OctetString(new TextEncoder().encode(challenge)),
    uniqueId: new OctetString(new Uint8Array(0)),
    softwareEnforced: new NonStandardAuthorizationList(),
    teeEnforced: new NonStandardAuthorizationList(),
  });
  const leaf = await x509.X509CertificateGenerator.create({
    serialNumber: "03", subject: "CN=Android Keystore Key", issuer: mid.subject,
    notBefore: new Date(0), notAfter: new Date(Date.now() + 365 * DAY),
    publicKey: leafK.publicKey, signingKey: midK.privateKey, signingAlgorithm: ALG,
    extensions: [new x509.Extension("1.3.6.1.4.1.11129.2.1.17", false, AsnConvert.serialize(kd))],
  });
  return { certs: [leaf, mid, root].map(b64), rootPem: root.toString("pem"), leafSpki: Buffer.from(leaf.publicKey.rawData).toString("base64") };
}

const NONCE = "166cc0da30afb18e278daaebfbd1401bc6e9610a060e1186";
const enc = (s: string) => new TextEncoder().encode(s);

describe("one-time check key (fresh Google stamp)", () => {
  beforeAll(() => {
    // Google's revocation list: nothing revoked.
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ entries: {} }) })) as unknown as typeof fetch;
  });

  it("accepts a check key made for this request's nonce, in date", async () => {
    const c = await chain(NONCE);
    const r = await verifyKeyAttestationChain(c.certs, null, [c.rootPem], enc(NONCE));
    expect(r.ok).toBe(true);
    expect(r.staleCert).toBeUndefined();
    expect(r.hardware?.bootState).toBe("missing");
  });

  it("refuses a check key made for a different request (replay)", async () => {
    const c = await chain("an-older-nonce");
    const r = await verifyKeyAttestationChain(c.certs, null, [c.rootPem], enc(NONCE));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("check key was not made for this request");
  });

  it("flags an out-of-date intermediate so the issue handler can refuse it", async () => {
    const c = await chain(NONCE, { from: Date.now() - 30 * DAY, to: Date.now() - 16 * DAY });
    const r = await verifyKeyAttestationChain(c.certs, null, [c.rootPem], enc(NONCE));
    expect(r.ok).toBe(true);
    expect(r.staleCert).toMatch(/position 1/);
  });

  it("still ties the device key's chain to the device key and the package name", async () => {
    const c = await chain("com.onlymonkes.app");
    expect((await verifyKeyAttestationChain(c.certs, c.leafSpki, [c.rootPem])).ok).toBe(true);
    const other = await chain("com.onlymonkes.app");
    expect((await verifyKeyAttestationChain(c.certs, other.leafSpki, [c.rootPem])).reason).toBe("leaf key does not match presented device key");
    expect((await verifyKeyAttestationChain((await chain(NONCE)).certs, null, [c.rootPem])).reason).toBe("chain does not terminate at a pinned Google root");
  });
});
