/**
 * deviceIntegrity.ts — Device Integrity Attestation (the "TEEPIN substitute", generalized).
 *
 * There is no public Solana Mobile TEEPIN SDK for third-party apps as of this writing (checked
 * docs.solanamobile.com + the TEEPIN announcement directly — Guardian Network is still
 * first-party-only). This builds the real thing from primitives that exist today:
 *
 *  - The hardware-backed EC key + attestation cert chain DeviceAttestModule.kt already
 *    generates (originally for Data Oracle Phase 1's sentiment oracle) — reused as-is, no new
 *    native code. Sentiment oracle never verified that cert chain server-side; this module is
 *    that follow-up, generalized into a standalone device-integrity check any wallet activity
 *    can gate on, not just sentiment submissions.
 *  - Free-RASP's already-collected threat state (src/lib/security.ts's HARD_THREATS, mirrored
 *    here via cryptoVerify.ts).
 *  - Saga Monke + Genesis Token ownership (fetchOwnedMonke, reused; verifyGenesisTokenOwnership,
 *    ported from the app/bot in genesisVerify.ts).
 *
 * NOT on-chain: priced against the real Solana Attestation Service program (~78 SOL/year in
 * re-issuance transaction fees at realistic engagement, at a 7-day expiry) and decided against
 * it for this phase — nothing on-chain needs to read this credential today, so it's verified
 * server-side and cached in KV instead. The verdict shape below is intentionally the same shape
 * a SAS schema would use, so mirroring it on-chain later (if a concrete third-party-contract
 * reason ever comes up) is additive, not a rewrite.
 *
 * KV namespace (create via `wrangler kv:namespace create DEVICE_INTEGRITY`):
 *   DEVICE_INTEGRITY
 *     nonce:<nonce>          — presence-only marker, 2min TTL, single-use challenge
 *     wallet:<address>        — { securityLevel, hardwareVerified, raspClean, holderTier,
 *                                  deviceHash, issuedAt, expiresAt }, TTL matches expiresAt —
 *                                  the most recent phone's verdict (status endpoint)
 *     devices:<address>       — verdicts of every verified phone on the wallet (max 5)
 *     bind:<deviceHash>       — wallet a device key was bound to (key-only refreshes)
 *
 * 2026-11-04 — one account per wallet, up to MAX_DEVICES phones: each phone's verdict is kept
 * in devices:<address>, so verifying one phone no longer pushes another off (LiveKit and
 * referrals used to accept only the last phone to verify). A verified phone can list the
 * wallet's phones and remove one (POST /api/device-integrity/devices, signed by its own key);
 * removal also drops that phone's binding, so it needs a wallet sign-in to come back.
 *
 * Revocation: every cert serial is checked against Google's status list
 * (android.googleapis.com/attestation/status, cached 1h; an unreachable list is logged, not fatal).
 *
 * 2026-11-04 — no wallet prompts after sign-in, and "not rooted" from Google rather than the phone:
 *  - Wallet proof is the Sign In With Solana result from the connect screen (one screen the user
 *    already sees), or the old signMessage. A successful issue remembers device key → wallet for
 *    180 days, so later refreshes need only the device key (no wallet prompt).
 *  - The attestation's RootOfTrust (verified boot + locked bootloader, hardware-enforced) and
 *    attestationApplicationId (our package + release signing cert) are read and logged on every
 *    issue. With DI_HARDWARE_ENFORCE="1" a phone failing either gets no verdict (unverified —
 *    never a chat block). Read `[deviceIntegrity] hardware` in the logs before turning it on.
 *
 * Root rotation IS accounted for: both currently-published Google hardware
 * attestation roots (legacy RSA, valid to 2042; the newer "Key Attestation CA 1" ECDSA root
 * effective Feb 2026, valid to 2035) are pinned below.
 */

import "reflect-metadata";
import * as x509 from "@peculiar/x509";
import { AsnConvert } from "@peculiar/asn1-schema";
import {
  AttestationApplicationId,
  NonStandardKeyDescription,
  SecurityLevel as KeySecurityLevel,
  VerifiedBootState,
} from "@peculiar/asn1-android";
import type { Env } from "./index";
import { fetchOwnedMonke } from "./index";
import {
  base64ToBytes,
  sha256Hex,
  verifyEcdsaP256,
  verifyEd25519,
  base58ToBytes,
  HARD_THREATS,
} from "./cryptoVerify";
import { verifyGenesisTokenOwnership } from "./genesisVerify";

x509.cryptoProvider.set(crypto as unknown as Crypto);

// ─── Local response helpers (same "avoid a churny export" convention as sentimentOracle.ts) ──

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 65_536; // cert chains run a few KB each; generous but bounded
const NONCE_TTL_SECONDS = 120;
// A sign-in nonce is signed on the connect screen; issuance follows after the holder check.
const SIGNIN_NONCE_TTL_SECONDS = 600;
const BINDING_TTL_SECONDS = 180 * 24 * 3600;
/** The SIWS domain the app puts in its sign-in request (host of its MWA identity URI). */
export const SIGNIN_DOMAIN = "onlymonkes-actions.jumpstreet25.workers.dev";
const APP_PACKAGE = "com.onlymonkes.app";
// SHA-256 of the release signing cert (CN=OnlyMonkes) — same as the apex assetlinks.json.
const RELEASE_CERT_SHA256 = "2e2feeb81ccf0de5d191f6e174113ba9839181b1cb7540ab6d5c94a9cff487d8";
const CRL_URL = "https://android.googleapis.com/attestation/status";
const CRL_CACHE_MS = 3600_000;
export const MAX_DEVICES = 5;
const VERDICT_TTL_SECONDS = 7 * 24 * 3600; // matches checkNftGate's existing TTL precedent
const MAX_CHAIN_CERTS = 10; // sanity bound — real chains are 3-4 deep
const EXPECTED_PACKAGE_BYTES = new TextEncoder().encode("com.onlymonkes.app");
const KEY_DESCRIPTION_OID = "1.3.6.1.4.1.11129.2.1.17";

const key_description_ce_oid = KEY_DESCRIPTION_OID; // local alias for readability at call sites

// Google's currently-published Android hardware attestation roots
// (https://developer.android.com/privacy-and-security/security-key-attestation, confirmed
// 2026-08-22). Two roots because Google is mid-rotation to Remote Key Provisioning — both are
// currently valid and a real device's chain can terminate at either.
const GOOGLE_ROOT_PEMS = [
  // Legacy RSA root, valid 2022-03-20 to 2042-03-15, subject serial f92009e853b6b045.
  `-----BEGIN CERTIFICATE-----
MIIFHDCCAwSgAwIBAgIJAPHBcqaZ6vUdMA0GCSqGSIb3DQEBCwUAMBsxGTAXBgNV
BAUTEGY5MjAwOWU4NTNiNmIwNDUwHhcNMjIwMzIwMTgwNzQ4WhcNNDIwMzE1MTgw
NzQ4WjAbMRkwFwYDVQQFExBmOTIwMDllODUzYjZiMDQ1MIICIjANBgkqhkiG9w0B
AQEFAAOCAg8AMIICCgKCAgEAr7bHgiuxpwHsK7Qui8xUFmOr75gvMsd/dTEDDJdS
Sxtf6An7xyqpRR90PL2abxM1dEqlXnf2tqw1Ne4Xwl5jlRfdnJLmN0pTy/4lj4/7
tv0Sk3iiKkypnEUtR6WfMgH0QZfKHM1+di+y9TFRtv6y//0rb+T+W8a9nsNL/ggj
nar86461qO0rOs2cXjp3kOG1FEJ5MVmFmBGtnrKpa73XpXyTqRxB/M0n1n/W9nGq
C4FSYa04T6N5RIZGBN2z2MT5IKGbFlbC8UrW0DxW7AYImQQcHtGl/m00QLVWutHQ
oVJYnFPlXTcHYvASLu+RhhsbDmxMgJJ0mcDpvsC4PjvB+TxywElgS70vE0XmLD+O
JtvsBslHZvPBKCOdT0MS+tgSOIfga+z1Z1g7+DVagf7quvmag8jfPioyKvxnK/Eg
sTUVi2ghzq8wm27ud/mIM7AY2qEORR8Go3TVB4HzWQgpZrt3i5MIlCaY504LzSRi
igHCzAPlHws+W0rB5N+er5/2pJKnfBSDiCiFAVtCLOZ7gLiMm0jhO2B6tUXHI/+M
RPjy02i59lINMRRev56GKtcd9qO/0kUJWdZTdA2XoS82ixPvZtXQpUpuL12ab+9E
aDK8Z4RHJYYfCT3Q5vNAXaiWQ+8PTWm2QgBR/bkwSWc+NpUFgNPN9PvQi8WEg5Um
AGMCAwEAAaNjMGEwHQYDVR0OBBYEFDZh4QB8iAUJUYtEbEf/GkzJ6k8SMB8GA1Ud
IwQYMBaAFDZh4QB8iAUJUYtEbEf/GkzJ6k8SMA8GA1UdEwEB/wQFMAMBAf8wDgYD
VR0PAQH/BAQDAgIEMA0GCSqGSIb3DQEBCwUAA4ICAQB8cMqTllHc8U+qCrOlg3H7
174lmaCsbo/bJ0C17JEgMLb4kvrqsXZs01U3mB/qABg/1t5Pd5AORHARs1hhqGIC
W/nKMav574f9rZN4PC2ZlufGXb7sIdJpGiO9ctRhiLuYuly10JccUZGEHpHSYM2G
tkgYbZba6lsCPYAAP83cyDV+1aOkTf1RCp/lM0PKvmxYN10RYsK631jrleGdcdkx
oSK//mSQbgcWnmAEZrzHoF1/0gso1HZgIn0YLzVhLSA/iXCX4QT2h3J5z3znluKG
1nv8NQdxei2DIIhASWfu804CA96cQKTTlaae2fweqXjdN1/v2nqOhngNyz1361mF
mr4XmaKH/ItTwOe72NI9ZcwS1lVaCvsIkTDCEXdm9rCNPAY10iTunIHFXRh+7KPz
lHGewCq/8TOohBRn0/NNfh7uRslOSZ/xKbN9tMBtw37Z8d2vvnXq/YWdsm1+JLVw
n6yYD/yacNJBlwpddla8eaVMjsF6nBnIgQOf9zKSe06nSTqvgwUHosgOECZJZ1Eu
zbH4yswbt02tKtKEFhx+v+OTge/06V+jGsqTWLsfrOCNLuA8H++z+pUENmpqnnHo
vaI47gC+TNpkgYGkkBT6B/m/U01BuOBBTzhIlMEZq9qkDWuM2cA5kW5V3FJUcfHn
w1IdYIg2Wxg7yHcQZemFQg==
-----END CERTIFICATE-----`,
  // New ECDSA P-384 root "Key Attestation CA 1", effective 2025-07-17, valid to 2035-07-15.
  `-----BEGIN CERTIFICATE-----
MIICIjCCAaigAwIBAgIRAISp0Cl7DrWK5/8OgN52BgUwCgYIKoZIzj0EAwMwUjEc
MBoGA1UEAwwTS2V5IEF0dGVzdGF0aW9uIENBMTEQMA4GA1UECwwHQW5kcm9pZDET
MBEGA1UECgwKR29vZ2xlIExMQzELMAkGA1UEBhMCVVMwHhcNMjUwNzE3MjIzMjE4
WhcNMzUwNzE1MjIzMjE4WjBSMRwwGgYDVQQDDBNLZXkgQXR0ZXN0YXRpb24gQ0Ex
MRAwDgYDVQQLDAdBbmRyb2lkMRMwEQYDVQQKDApHb29nbGUgTExDMQswCQYDVQQG
EwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABCPaI3FO3z5bBQo8cuiEas4HjqCt
G/mLFfRT0MsIssPBEEU5Cfbt6sH5yOAxqEi5QagpU1yX4HwnGb7OtBYpDTB57uH5
Eczm34A5FNijV3s0/f0UPl7zbJcTx6xwqMIRq6NCMEAwDwYDVR0TAQH/BAUwAwEB
/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFFIyuyz7RkOb3NaBqQ5lZuA0QepA
MAoGCCqGSM49BAMDA2gAMGUCMETfjPO/HwqReR2CS7p0ZWoD/LHs6hDi422opifH
EUaYLxwGlT9SLdjkVpz0UUOR5wIxAIoGyxGKRHVTpqpGRFiJtQEOOTp/+s1GcxeY
uR2zh/80lQyu9vAFCj6E4AXc+osmRg==
-----END CERTIFICATE-----`,
];

let _rootCerts: x509.X509Certificate[] | null = null;
function rootCerts(): x509.X509Certificate[] {
  if (!_rootCerts) _rootCerts = GOOGLE_ROOT_PEMS.map((pem) => new x509.X509Certificate(pem));
  return _rootCerts;
}

// ─── KeyDescription chain verification ────────────────────────────────────────

export type SecurityLevelLabel = "none" | "tee" | "strongbox";

function labelSecurityLevel(level: KeySecurityLevel | undefined): SecurityLevelLabel {
  if (level === KeySecurityLevel.strongBox) return "strongbox";
  if (level === KeySecurityLevel.trustedEnvironment) return "tee";
  return "none";
}

interface ChainVerifyResult {
  ok: boolean;
  securityLevel: SecurityLevelLabel;
  reason?: string;
  /** The worker couldn't check a signature (e.g. an algorithm Workers' WebCrypto lacks) —
   *  not evidence of a forged chain, so the caller must not hard-fail the device on it. */
  unchecked?: boolean;
  /** Set when the chain verified but an issued cert is past its dates (accepted). */
  staleCert?: string;
  hardware?: HardwareFacts;
}

/** What Google's attestation says about the phone and the app, beyond "the key is in hardware". */
export interface HardwareFacts {
  /** RootOfTrust.verifiedBootState (hardware-enforced): "verified" = stock, signed system. */
  bootState: string;
  deviceLocked: boolean;
  /** attestationApplicationId: our package, signed with our release cert. */
  genuineApp: boolean;
  packages: string[];
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export function readHardwareFacts(kd: NonStandardKeyDescription): HardwareFacts {
  const rot = kd.teeEnforced.findProperty("rootOfTrust");
  const bootState = rot ? (VerifiedBootState[rot.verifiedBootState] ?? String(rot.verifiedBootState)) : "missing";
  let packages: string[] = [];
  let digests: string[] = [];
  const appIdRaw = kd.softwareEnforced.findProperty("attestationApplicationId") ?? kd.teeEnforced.findProperty("attestationApplicationId");
  if (appIdRaw) {
    try {
      const appId = AsnConvert.parse(appIdRaw.buffer, AttestationApplicationId);
      packages = appId.packageInfos.map((p) => new TextDecoder().decode(p.packageName.buffer));
      digests = appId.signatureDigests.map((d) => toHex(d.buffer));
    } catch { /* unreadable → not genuine */ }
  }
  return {
    bootState,
    deviceLocked: rot?.deviceLocked === true,
    genuineApp: packages.includes(APP_PACKAGE) && digests.includes(RELEASE_CERT_SHA256),
    packages,
  };
}

export function hardwareTrusted(h: HardwareFacts): boolean {
  return h.bootState === "verified" && h.deviceLocked && h.genuineApp;
}

let crlCache: { at: number; entries: Record<string, { status?: string }> } | null = null;

/** Google's revoked/suspended attestation cert serials (lowercase hex), or null when unreachable. */
async function revokedSerials(): Promise<Record<string, { status?: string }> | null> {
  if (crlCache && Date.now() - crlCache.at < CRL_CACHE_MS) return crlCache.entries;
  try {
    const res = await fetch(CRL_URL, { cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { entries?: Record<string, { status?: string }> };
    crlCache = { at: Date.now(), entries: json.entries ?? {} };
    return crlCache.entries;
  } catch (e) {
    console.warn(`[deviceIntegrity] revocation list unavailable: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** Sign In With Solana message fields we rely on (CAIP-122 / SIWS text format). */
export function parseSignInMessage(text: string): { domain: string; address: string; nonce?: string; expirationTime?: string } | null {
  const lines = text.split("\n");
  const m = /^(\S+) wants you to sign in with your Solana account:$/.exec(lines[0] ?? "");
  if (!m || !lines[1]) return null;
  const field = (name: string) => lines.find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2).trim();
  return { domain: m[1], address: lines[1].trim(), nonce: field("Nonce"), expirationTime: field("Expiration Time") };
}

/** "ECDSA/SHA-384 by ECDSA P-521" — for failure reasons; certificates hold no user data. */
function sigAlgLabel(cert: x509.X509Certificate, issuer: x509.X509Certificate): string {
  try {
    const sig = cert.signatureAlgorithm as { name?: string; hash?: { name?: string } };
    const key = issuer.publicKey.algorithm as { name?: string; namedCurve?: string; modulusLength?: number };
    return `${sig.name ?? "?"}/${sig.hash?.name ?? "?"} by ${key.name ?? "?"} ${key.namedCurve ?? key.modulusLength ?? ""}`.trim();
  } catch {
    return "unknown algorithm";
  }
}

/**
 * Parses + chain-verifies an Android Key Attestation cert chain, and confirms it was actually
 * generated for this app's device key. This is the capability sentimentOracle.ts's own doc
 * comment flagged as missing ("does not currently parse its KeyDescription extension to
 * confirm hardware provenance server-side... a real gap versus 'true' attestation").
 *
 * Does NOT check freshness — the attestationChallenge baked into the chain is static
 * (this app's package name, set once at key-generation time in DeviceAttestModule.kt), so this
 * proves hardware provenance of the key once, not freshness of the current request. Freshness
 * comes from the separate fresh ECDSA signature over the server nonce (see verifyIssueRequest).
 */
export async function verifyKeyAttestationChain(
  certChainBase64: string[],
  /** The key the leaf must certify; null for a one-time check key (only its challenge matters). */
  devicePubKeyBase64: string | null,
  // Test-only override — real request handling never passes this, always verifying against
  // the real pinned Google roots. Exists so a synthetic chain (built with a test root, since
  // no test can construct a chain that terminates at Google's actual private root key) can
  // exercise this function's full logic end to end.
  trustedRootPems: string[] = GOOGLE_ROOT_PEMS,
  /** attestationChallenge the leaf must carry: the package name for the device key, the
   *  request's nonce for a one-time check key. */
  expectedChallenge: Uint8Array = EXPECTED_PACKAGE_BYTES,
): Promise<ChainVerifyResult> {
  if (!Array.isArray(certChainBase64) || certChainBase64.length === 0) {
    return { ok: false, securityLevel: "none", reason: "empty cert chain" };
  }
  if (certChainBase64.length > MAX_CHAIN_CERTS) {
    return { ok: false, securityLevel: "none", reason: "cert chain too long" };
  }

  let certs: x509.X509Certificate[];
  try {
    certs = certChainBase64.map((b64) => new x509.X509Certificate(base64ToBytes(b64)));
  } catch {
    return { ok: false, securityLevel: "none", reason: "malformed certificate in chain" };
  }

  // Leaf's public key must match the device pubkey the client is presenting, so a valid but
  // unrelated chain can't be substituted in for a different key.
  if (devicePubKeyBase64 !== null) try {
    const leafSpki = new Uint8Array(certs[0].publicKey.rawData);
    const presentedSpki = base64ToBytes(devicePubKeyBase64);
    if (leafSpki.length !== presentedSpki.length || !leafSpki.every((b, i) => b === presentedSpki[i])) {
      return { ok: false, securityLevel: "none", reason: "leaf key does not match presented device key" };
    }
  } catch {
    return { ok: false, securityLevel: "none", reason: "could not read leaf public key" };
  }

  // Signature chain: each cert's signature must verify against the next cert's public key.
  // 2026-10-29: a throw (key import / unsupported algorithm) used to count as an invalid
  // signature, and two Seeker holders were hard-blocked with "chain signature invalid at
  // position 1". Only a signature that was checked and failed is a hardware failure now.
  // 2026-10-31: x509's verify() returns false (not a throw) when the key import fails, and
  // without signatureOnly it also returns false for a cert outside its validity dates — both
  // were reported as "chain signature invalid at position 1" and hard-blocked Seeker holders
  // (ONLYMONKES-15). Import the key here and check dates separately.
  const now = Date.now();
  let outOfDate: string | null = null;
  for (let i = 0; i < certs.length - 1; i++) {
    let sigOk: boolean;
    try {
      const issuerKey = await certs[i + 1].publicKey.export(
        { ...certs[i + 1].publicKey.algorithm, ...certs[i].signatureAlgorithm },
        ["verify"],
        crypto as unknown as Crypto,
      );
      sigOk = await certs[i].verify({ publicKey: issuerKey, signatureOnly: true });
    } catch (e) {
      const why = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      return { ok: false, unchecked: true, securityLevel: "none", reason: `could not check signature at position ${i} (${sigAlgLabel(certs[i], certs[i + 1])}; ${why.slice(0, 120)})` };
    }
    if (!sigOk) {
      return { ok: false, securityLevel: "none", reason: `chain signature invalid at position ${i} (${sigAlgLabel(certs[i], certs[i + 1])})` };
    }
    // The leaf's dates come from the device's KeyMint and are often placeholders; only issued certs count.
    if (i > 0 && !outOfDate && (now < certs[i].notBefore.getTime() || now > certs[i].notAfter.getTime())) {
      outOfDate = `cert at position ${i} valid ${certs[i].notBefore.toISOString().slice(0, 10)}..${certs[i].notAfter.toISOString().slice(0, 10)}`;
    }
  }

  // The last cert in the presented chain must itself match one of the pinned Google roots
  // (by raw DER bytes) — not just "self-signed", which anyone can produce.
  const trustedRoots = trustedRootPems === GOOGLE_ROOT_PEMS
    ? rootCerts()
    : trustedRootPems.map((pem) => new x509.X509Certificate(pem));
  const last = certs[certs.length - 1];
  const lastDer = new Uint8Array(last.rawData);
  const matchesRoot = trustedRoots.some((root) => {
    const rootDer = new Uint8Array(root.rawData);
    return rootDer.length === lastDer.length && rootDer.every((b, i) => b === lastDer[i]);
  });
  if (!matchesRoot) {
    return { ok: false, securityLevel: "none", reason: "chain does not terminate at a pinned Google root" };
  }

  // Parse the leaf's KeyDescription extension and confirm hardware provenance.
  const ext = certs[0].getExtension(key_description_ce_oid);
  if (!ext) {
    return { ok: false, securityLevel: "none", reason: "leaf certificate has no KeyDescription extension" };
  }
  let keyDescription: NonStandardKeyDescription;
  try {
    keyDescription = AsnConvert.parse(ext.value, NonStandardKeyDescription);
  } catch {
    return { ok: false, securityLevel: "none", reason: "could not parse KeyDescription extension" };
  }

  const attestationLevel = keyDescription.attestationSecurityLevel;
  const keymasterLevel = keyDescription.keymasterSecurityLevel;
  if (attestationLevel === KeySecurityLevel.software || keymasterLevel === KeySecurityLevel.software) {
    return { ok: false, securityLevel: "none", reason: "key is software-backed, not hardware-backed" };
  }

  const challengeBytes = new Uint8Array(keyDescription.attestationChallenge.buffer);
  const challengeOk =
    challengeBytes.length === expectedChallenge.length &&
    challengeBytes.every((b, i) => b === expectedChallenge[i]);
  if (!challengeOk) {
    return { ok: false, securityLevel: "none", reason: expectedChallenge === EXPECTED_PACKAGE_BYTES ? "attestation challenge does not match expected app package" : "check key was not made for this request" };
  }

  const revoked = await revokedSerials();
  if (revoked) {
    for (const c of certs) {
      const serial = c.serialNumber.toLowerCase().replace(/^0+/, "");
      if (revoked[serial]) {
        return { ok: false, unchecked: true, securityLevel: "none", reason: `attestation cert ${revoked[serial].status ?? "revoked"} by Google` };
      }
    }
  }

  // Signatures and the pinned Google root check out but an issued cert has expired: the phone's
  // attestation key is older than its short-lived intermediate, and the 3.0 app can't make a new
  // key, so these phones could never verify (2026-11-04). Expired is not revoked — accept it, logged.

  // Lower of the two levels — a StrongBox attestation statement backed by a merely-TEE keymaster
  // (or vice versa) is only as strong as its weaker link.
  const effective =
    attestationLevel === KeySecurityLevel.trustedEnvironment || keymasterLevel === KeySecurityLevel.trustedEnvironment
      ? "tee"
      : "strongbox";
  const bothStrongBox = attestationLevel === KeySecurityLevel.strongBox && keymasterLevel === KeySecurityLevel.strongBox;

  return { ok: true, securityLevel: bothStrongBox ? "strongbox" : (effective as SecurityLevelLabel), staleCert: outOfDate ?? undefined, hardware: readHardwareFacts(keyDescription) };
}

// ─── Verdict shape (mirrors what a SAS schema for this would hold — see module doc comment) ──

export interface DeviceIntegrityVerdict {
  securityLevel: SecurityLevelLabel;
  hardwareVerified: boolean;
  raspClean: boolean;
  holderTier: "none" | "sagaMonke" | "genesis";
  deviceHash: string;
  issuedAt: number;
  expiresAt: number;
  /** Phone model the app reported (e.g. "Seeker"), shown only to the wallet's own phones. */
  label?: string;
}

function walletKey(wallet: string): string {
  return `wallet:${wallet}`;
}

const devicesKey = (wallet: string) => `devices:${wallet}`;

/** The wallet's verified phones, expired ones dropped. Verdicts from before the per-wallet
 *  list existed are only in wallet:<address>, so that one counts too. */
async function loadDevices(env: Env, wallet: string): Promise<DeviceIntegrityVerdict[]> {
  const now = Date.now();
  const [rawList, rawLatest] = await Promise.all([
    env.DEVICE_INTEGRITY.get(devicesKey(wallet)),
    env.DEVICE_INTEGRITY.get(walletKey(wallet)),
  ]);
  let list: DeviceIntegrityVerdict[] = [];
  try { list = rawList ? (JSON.parse(rawList) as DeviceIntegrityVerdict[]) : []; } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  if (rawLatest && !rawList) {
    try {
      const latest = JSON.parse(rawLatest) as DeviceIntegrityVerdict;
      if (latest?.deviceHash) list.push(latest);
    } catch { /* ignore */ }
  }
  return list.filter((d) => d && typeof d.deviceHash === "string" && d.expiresAt > now);
}

async function saveDevices(env: Env, wallet: string, list: DeviceIntegrityVerdict[]): Promise<void> {
  if (list.length === 0) {
    await Promise.all([env.DEVICE_INTEGRITY.delete(devicesKey(wallet)), env.DEVICE_INTEGRITY.delete(walletKey(wallet))]);
    return;
  }
  const latest = list.reduce((a, b) => (b.issuedAt > a.issuedAt ? b : a));
  const ttl = Math.max(60, Math.ceil((Math.max(...list.map((d) => d.expiresAt)) - Date.now()) / 1000));
  await Promise.all([
    env.DEVICE_INTEGRITY.put(devicesKey(wallet), JSON.stringify(list), { expirationTtl: ttl }),
    env.DEVICE_INTEGRITY.put(walletKey(wallet), JSON.stringify(latest), {
      expirationTtl: Math.max(60, Math.ceil((latest.expiresAt - Date.now()) / 1000)),
    }),
  ]);
}

/** This phone's current verdict for the wallet, or null (LiveKit tokens, referrals). */
export async function deviceVerdict(env: Env, wallet: string, deviceHash: string): Promise<DeviceIntegrityVerdict | null> {
  return (await loadDevices(env, wallet)).find((d) => d.deviceHash === deviceHash) ?? null;
}

/** Keeps a model name readable and harmless: letters, digits, spaces, - _ . ( ), 40 chars. */
export function cleanDeviceLabel(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const label = raw.replace(/[^\p{L}\p{N} ._()-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return label || undefined;
}

// ─── Challenge (nonce issuance) ────────────────────────────────────────────────

export async function handleDeviceIntegrityChallenge(env: Env, url?: URL): Promise<Response> {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(24));
  const nonce = [...nonceBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const ttl = url?.searchParams.get("for") === "signin" ? SIGNIN_NONCE_TTL_SECONDS : NONCE_TTL_SECONDS;
  await env.DEVICE_INTEGRITY.put(`nonce:${nonce}`, "1", { expirationTtl: ttl });
  return jsonResponse({ nonce, expiresInSeconds: ttl, domain: SIGNIN_DOMAIN });
}

// ─── Issue ──────────────────────────────────────────────────────────────────

interface IssueBody {
  walletAddress?: string;
  devicePubKeyBase64?: string;
  certChainBase64?: string[];
  nonce?: string;
  deviceSigBase64?: string;
  walletSigBase64?: string;
  /** Sign In With Solana from the connect screen, in place of walletSigBase64. */
  signInMessageBase64?: string;
  signInSignatureBase64?: string;
  /** No wallet proof: allowed when this device key was bound to the wallet before. */
  refresh?: boolean;
  /** 3.1+: chain of a one-time key the app made for this request with the nonce as its
   *  attestation challenge — a cert Google issued just now, and the phone's state right now. */
  freshChainBase64?: string[];
  deviceLabel?: string;
  raspThreats?: string[];
}

const bindingKey = (deviceHash: string) => `bind:${deviceHash}`;

function buildDeviceIntegrityBindingMessage(devicePubKeyBase64: string, nonce: string): string {
  return `OnlyMonkes Device Integrity Attestation\ndevice:${devicePubKeyBase64}\nnonce:${nonce}`;
}

export async function handleDeviceIntegrityIssue(request: Request, env: Env): Promise<Response> {
  let body: IssueBody;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return errorResponse("Body too large", 413);
    body = JSON.parse(text);
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const { walletAddress, devicePubKeyBase64, certChainBase64, nonce, deviceSigBase64, walletSigBase64 } = body;
  const proofKind = walletSigBase64 ? "signature" : body.signInMessageBase64 && body.signInSignatureBase64 ? "signin" : body.refresh ? "refresh" : null;
  if (!walletAddress || !devicePubKeyBase64 || !certChainBase64 || !nonce || !deviceSigBase64 || !proofKind) {
    return errorResponse("Missing required field(s)");
  }

  // Single-use nonce — consume before doing any real work.
  const nonceKey = `nonce:${nonce}`;
  const nonceValid = await env.DEVICE_INTEGRITY.get(nonceKey);
  if (!nonceValid) {
    return errorResponse("Nonce missing, expired, or already used — request a fresh challenge", 401);
  }
  await env.DEVICE_INTEGRITY.delete(nonceKey);

  const walletBytes = base58ToBytes(walletAddress);
  if (!walletBytes || walletBytes.length !== 32) {
    return errorResponse("Invalid wallet address", 400);
  }

  let deviceKeyBytes: Uint8Array;
  let deviceSigBytes: Uint8Array;
  try {
    deviceKeyBytes = base64ToBytes(devicePubKeyBase64);
    deviceSigBytes = base64ToBytes(deviceSigBase64);
  } catch {
    return errorResponse("Invalid base64 encoding", 400);
  }
  const deviceHash = await sha256Hex(deviceKeyBytes);

  // Freshness proof — a live signature over THIS request's nonce, from the device's hardware key.
  const bindingMessage = new TextEncoder().encode(buildDeviceIntegrityBindingMessage(devicePubKeyBase64, nonce));
  const deviceSigOk = await verifyEcdsaP256(deviceKeyBytes, bindingMessage, deviceSigBytes);
  if (!deviceSigOk) {
    return errorResponse("Device signature verification failed", 401);
  }

  // Wallet binding — proves this device key is being claimed by the wallet that controls it:
  // a signature over the binding message, a sign-in signed on the connect screen for this same
  // nonce, or (refresh) a device key this wallet already bound.
  if (proofKind === "signature") {
    let walletSigBytes: Uint8Array;
    try { walletSigBytes = base64ToBytes(walletSigBase64!); } catch { return errorResponse("Invalid base64 encoding", 400); }
    if (!(await verifyEd25519(walletBytes, bindingMessage, walletSigBytes))) {
      return errorResponse("Wallet signature does not match binding message", 401);
    }
  } else if (proofKind === "signin") {
    let msgBytes: Uint8Array;
    let sigBytes: Uint8Array;
    try {
      msgBytes = base64ToBytes(body.signInMessageBase64!);
      sigBytes = base64ToBytes(body.signInSignatureBase64!);
    } catch {
      return errorResponse("Invalid base64 encoding", 400);
    }
    const signIn = parseSignInMessage(new TextDecoder().decode(msgBytes));
    if (!signIn || signIn.domain !== SIGNIN_DOMAIN || signIn.address !== walletAddress || signIn.nonce !== nonce) {
      return errorResponse("Sign-in message does not match this request", 401);
    }
    if (signIn.expirationTime && Date.parse(signIn.expirationTime) < Date.now()) {
      return errorResponse("Sign-in expired — sign in again", 401);
    }
    if (!(await verifyEd25519(walletBytes, msgBytes, sigBytes))) {
      return errorResponse("Sign-in signature invalid", 401);
    }
  } else if ((await env.DEVICE_INTEGRITY.get(bindingKey(deviceHash))) !== walletAddress) {
    return errorResponse("Device not bound to this wallet yet", 401);
  }

  // RASP: any hard threat is disqualifying, full stop, before spending time on the chain check.
  const threats = Array.isArray(body.raspThreats) ? body.raspThreats : [];
  const raspClean = !threats.some((t) => HARD_THREATS.has(t));

  // Hardware provenance — the actual new capability this module adds.
  const chainResult = await verifyKeyAttestationChain(certChainBase64, devicePubKeyBase64);
  if (!chainResult.ok) {
    console.warn(`[deviceIntegrity] chain not verified: ${chainResult.reason}`);
    // The app reads a 403 "Hardware attestation failed" as hardware_failed (blocks chat); a
    // chain we couldn't check degrades to unverified instead.
    if (chainResult.unchecked) return errorResponse(`Could not verify the hardware attestation right now: ${chainResult.reason}`, 503);
    return errorResponse(`Hardware attestation failed: ${chainResult.reason}`, 403);
  }

  // 3.1+: a one-time check key made for this nonce. Its cert is brand new, so it must be in
  // date, and its boot / app facts describe the phone now (the device key's describe the day
  // that key was made). With it, the device key's own out-of-date cert no longer matters.
  const fresh = Array.isArray(body.freshChainBase64) && body.freshChainBase64.length > 0
    ? await verifyKeyAttestationChain(body.freshChainBase64, null, GOOGLE_ROOT_PEMS, new TextEncoder().encode(nonce))
    : null;
  if (fresh && !fresh.ok) {
    console.warn(`[deviceIntegrity] check key not verified: ${fresh.reason}`);
    if (fresh.unchecked) return errorResponse(`Could not verify the hardware attestation right now: ${fresh.reason}`, 503);
    return errorResponse(`Hardware attestation failed: ${fresh.reason}`, 403);
  }
  if (fresh?.staleCert) {
    console.warn(`[deviceIntegrity] check key cert out of date: ${fresh.staleCert}`);
    return errorResponse("Could not verify the hardware attestation right now: check key certificate out of date", 503);
  }
  if (!fresh && chainResult.staleCert) {
    // Apps before 3.1 can't make a new key; #52 accepts their out-of-date certs until DI_ALLOW_STALE="0".
    if (env.DI_ALLOW_STALE === "0") return errorResponse("Update OnlyMonkes to verify this phone", 403);
    console.log(`[deviceIntegrity] accepted out-of-date cert: ${chainResult.staleCert}`);
  }
  const hw = (fresh ?? chainResult).hardware;
  console.log(`[deviceIntegrity] hardware boot=${hw?.bootState} locked=${hw?.deviceLocked} genuineApp=${hw?.genuineApp} packages=${hw?.packages.join(",")} proof=${proofKind} fresh=${fresh ? "yes" : "no"}`);
  if (env.DI_HARDWARE_ENFORCE === "1" && !(hw && hardwareTrusted(hw))) {
    return errorResponse("This phone or app build could not be confirmed as unmodified — verification not issued", 403);
  }

  // Ownership — reuse the existing tiered chains, don't reimplement.
  const [monkeResult, genesisResult] = await Promise.all([
    fetchOwnedMonke(walletAddress, env),
    verifyGenesisTokenOwnership(walletAddress, env),
  ]);
  let holderTier: DeviceIntegrityVerdict["holderTier"] = "none";
  if (monkeResult.monke) holderTier = "sagaMonke";
  else if (genesisResult.verified) holderTier = "genesis";

  if (holderTier === "none") {
    if (monkeResult.uncertain) {
      return errorResponse("Could not verify holder status right now — retry shortly", 503);
    }
    return errorResponse("Wallet does not hold a Saga Monke or Genesis Token", 403);
  }

  if (!raspClean) {
    // Ownership + hardware provenance are real, but a hard RASP threat still blocks issuance —
    // never issue a "clean" verdict for a device that already tripped a hard threat locally.
    return errorResponse("Device reports a hard security threat — attestation not issued", 403);
  }

  const devices = await loadDevices(env, walletAddress);
  const others = devices.filter((d) => d.deviceHash !== deviceHash);
  if (others.length >= MAX_DEVICES) {
    return errorResponse(`This wallet already has ${MAX_DEVICES} verified phones. Remove one under Your devices on another phone, then try again.`, 409);
  }

  const now = Date.now();
  const verdict: DeviceIntegrityVerdict = {
    securityLevel: chainResult.securityLevel,
    hardwareVerified: true,
    raspClean: true,
    holderTier,
    deviceHash,
    issuedAt: now,
    expiresAt: now + VERDICT_TTL_SECONDS * 1000,
    label: cleanDeviceLabel(body.deviceLabel) ?? devices.find((d) => d.deviceHash === deviceHash)?.label,
  };
  await saveDevices(env, walletAddress, [...others, verdict]);
  await env.DEVICE_INTEGRITY.put(bindingKey(deviceHash), walletAddress, { expirationTtl: BINDING_TTL_SECONDS });

  return jsonResponse({ status: "clean", ...verdict });
}

// ─── Your devices (list / remove) ──────────────────────────────────────────────

export function buildDevicesMessage(action: string, wallet: string, target: string, nonce: string): string {
  return `OnlyMonkes Devices\naction:${action}\nwallet:${wallet}\ntarget:${target}\nnonce:${nonce}`;
}

/** Short id shown to the app; 16 hex of the device hash is unique among ≤5 phones. */
const deviceId = (hash: string) => hash.slice(0, 16);

interface DevicesBody {
  action?: string;
  walletAddress?: string;
  devicePubKeyBase64?: string;
  nonce?: string;
  deviceSigBase64?: string;
  target?: string;
}

/**
 * A verified phone lists the wallet's phones or removes one. Signed by the calling phone's
 * hardware key over a single-use nonce; the caller must itself be verified on this wallet.
 * Removing a phone drops its verdict, its binding (so it needs a wallet sign-in to return)
 * and its sentiment-oracle registration.
 */
export async function handleDeviceIntegrityDevices(request: Request, env: Env): Promise<Response> {
  let body: DevicesBody;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return errorResponse("Body too large", 413);
    body = JSON.parse(text);
  } catch {
    return errorResponse("Invalid JSON body");
  }
  const { action, walletAddress, devicePubKeyBase64, nonce, deviceSigBase64 } = body;
  const target = typeof body.target === "string" ? body.target : "-";
  if ((action !== "list" && action !== "remove") || !walletAddress || !devicePubKeyBase64 || !nonce || !deviceSigBase64) {
    return errorResponse("Missing required field(s)");
  }
  if (action === "remove" && !/^[0-9a-f]{16}$/.test(target)) return errorResponse("Invalid device id");
  if (base58ToBytes(walletAddress)?.length !== 32) return errorResponse("Invalid wallet address", 400);

  const nonceKey = `nonce:${nonce}`;
  if (!(await env.DEVICE_INTEGRITY.get(nonceKey))) {
    return errorResponse("Nonce missing, expired, or already used — request a fresh challenge", 401);
  }
  await env.DEVICE_INTEGRITY.delete(nonceKey);

  let keyBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(devicePubKeyBase64);
    sigBytes = base64ToBytes(deviceSigBase64);
  } catch {
    return errorResponse("Invalid base64 encoding", 400);
  }
  const message = new TextEncoder().encode(buildDevicesMessage(action, walletAddress, target, nonce));
  if (!(await verifyEcdsaP256(keyBytes, message, sigBytes))) return errorResponse("Device signature verification failed", 401);

  const callerHash = await sha256Hex(keyBytes);
  const devices = await loadDevices(env, walletAddress);
  if (!devices.some((d) => d.deviceHash === callerHash)) {
    return errorResponse("This phone isn't verified on this wallet", 403);
  }

  if (action === "remove") {
    const gone = devices.find((d) => deviceId(d.deviceHash) === target);
    if (gone) {
      await saveDevices(env, walletAddress, devices.filter((d) => d !== gone));
      if ((await env.DEVICE_INTEGRITY.get(bindingKey(gone.deviceHash))) === walletAddress) {
        await env.DEVICE_INTEGRITY.delete(bindingKey(gone.deviceHash));
      }
      const reg = await env.SENTIMENT_ORACLE.get(`device:${gone.deviceHash}`);
      if (reg && (JSON.parse(reg) as { walletAddress?: string }).walletAddress === walletAddress) {
        await env.SENTIMENT_ORACLE.delete(`device:${gone.deviceHash}`);
      }
      console.log(`[deviceIntegrity] device removed (${devices.length - 1} left)`);
    }
  }

  const remaining = action === "remove" ? await loadDevices(env, walletAddress) : devices;
  return jsonResponse({
    max: MAX_DEVICES,
    devices: remaining
      .sort((a, b) => b.issuedAt - a.issuedAt)
      .map((d) => ({
        id: deviceId(d.deviceHash),
        label: d.label ?? null,
        isThisDevice: d.deviceHash === callerHash,
        verifiedAt: d.issuedAt,
        expiresAt: d.expiresAt,
      })),
  });
}

// ─── Status (cached read) ──────────────────────────────────────────────────────

export async function handleDeviceIntegrityStatus(url: URL, env: Env): Promise<Response> {
  const wallet = url.searchParams.get("wallet");
  if (!wallet) return errorResponse("Missing wallet", 400);

  const raw = await env.DEVICE_INTEGRITY.get(walletKey(wallet));
  if (!raw) return jsonResponse({ status: "unverified" });

  const verdict: DeviceIntegrityVerdict = JSON.parse(raw);
  if (verdict.expiresAt < Date.now()) {
    return jsonResponse({ status: "unverified" });
  }
  return jsonResponse({ status: "clean", ...verdict });
}
