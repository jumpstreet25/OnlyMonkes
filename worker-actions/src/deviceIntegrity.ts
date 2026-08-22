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
 *                                  deviceHash, issuedAt, expiresAt }, TTL matches expiresAt
 *
 * Known, explicit gap: revocation-list checking (android.googleapis.com/attestation/status)
 * is NOT implemented — a chain that verifies structurally but was later revoked by Google would
 * still pass here. Left for a follow-up rather than blocking this on building that fetch/cache
 * layer too. Root rotation IS accounted for: both currently-published Google hardware
 * attestation roots (legacy RSA, valid to 2042; the newer "Key Attestation CA 1" ECDSA root
 * effective Feb 2026, valid to 2035) are pinned below.
 */

import "reflect-metadata";
import * as x509 from "@peculiar/x509";
import { AsnConvert } from "@peculiar/asn1-schema";
import { NonStandardKeyDescription, SecurityLevel as KeySecurityLevel } from "@peculiar/asn1-android";
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
  devicePubKeyBase64: string,
  // Test-only override — real request handling never passes this, always verifying against
  // the real pinned Google roots. Exists so a synthetic chain (built with a test root, since
  // no test can construct a chain that terminates at Google's actual private root key) can
  // exercise this function's full logic end to end.
  trustedRootPems: string[] = GOOGLE_ROOT_PEMS,
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
  try {
    const leafSpki = new Uint8Array(certs[0].publicKey.rawData);
    const presentedSpki = base64ToBytes(devicePubKeyBase64);
    if (leafSpki.length !== presentedSpki.length || !leafSpki.every((b, i) => b === presentedSpki[i])) {
      return { ok: false, securityLevel: "none", reason: "leaf key does not match presented device key" };
    }
  } catch {
    return { ok: false, securityLevel: "none", reason: "could not read leaf public key" };
  }

  // Signature chain: each cert's signature must verify against the next cert's public key.
  for (let i = 0; i < certs.length - 1; i++) {
    let sigOk: boolean;
    try {
      sigOk = await certs[i].verify({ publicKey: certs[i + 1] });
    } catch {
      sigOk = false;
    }
    if (!sigOk) {
      return { ok: false, securityLevel: "none", reason: `chain signature invalid at position ${i}` };
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
    challengeBytes.length === EXPECTED_PACKAGE_BYTES.length &&
    challengeBytes.every((b, i) => b === EXPECTED_PACKAGE_BYTES[i]);
  if (!challengeOk) {
    return { ok: false, securityLevel: "none", reason: "attestation challenge does not match expected app package" };
  }

  // Lower of the two levels — a StrongBox attestation statement backed by a merely-TEE keymaster
  // (or vice versa) is only as strong as its weaker link.
  const effective =
    attestationLevel === KeySecurityLevel.trustedEnvironment || keymasterLevel === KeySecurityLevel.trustedEnvironment
      ? "tee"
      : "strongbox";
  const bothStrongBox = attestationLevel === KeySecurityLevel.strongBox && keymasterLevel === KeySecurityLevel.strongBox;

  return { ok: true, securityLevel: bothStrongBox ? "strongbox" : (effective as SecurityLevelLabel) };
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
}

function walletKey(wallet: string): string {
  return `wallet:${wallet}`;
}

// ─── Challenge (nonce issuance) ────────────────────────────────────────────────

export async function handleDeviceIntegrityChallenge(env: Env): Promise<Response> {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(24));
  const nonce = [...nonceBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DEVICE_INTEGRITY.put(`nonce:${nonce}`, "1", { expirationTtl: NONCE_TTL_SECONDS });
  return jsonResponse({ nonce, expiresInSeconds: NONCE_TTL_SECONDS });
}

// ─── Issue ──────────────────────────────────────────────────────────────────

interface IssueBody {
  walletAddress?: string;
  devicePubKeyBase64?: string;
  certChainBase64?: string[];
  nonce?: string;
  deviceSigBase64?: string;
  walletSigBase64?: string;
  raspThreats?: string[];
}

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
  if (!walletAddress || !devicePubKeyBase64 || !certChainBase64 || !nonce || !deviceSigBase64 || !walletSigBase64) {
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
  let walletSigBytes: Uint8Array;
  try {
    deviceKeyBytes = base64ToBytes(devicePubKeyBase64);
    deviceSigBytes = base64ToBytes(deviceSigBase64);
    walletSigBytes = base64ToBytes(walletSigBase64);
  } catch {
    return errorResponse("Invalid base64 encoding", 400);
  }

  // Freshness proof — a live signature over THIS request's nonce, from the device's hardware key.
  const bindingMessage = new TextEncoder().encode(buildDeviceIntegrityBindingMessage(devicePubKeyBase64, nonce));
  const deviceSigOk = await verifyEcdsaP256(deviceKeyBytes, bindingMessage, deviceSigBytes);
  if (!deviceSigOk) {
    return errorResponse("Device signature verification failed", 401);
  }

  // Wallet binding — proves this device key is being claimed by the wallet that controls it.
  const walletSigOk = await verifyEd25519(walletBytes, bindingMessage, walletSigBytes);
  if (!walletSigOk) {
    return errorResponse("Wallet signature does not match binding message", 401);
  }

  // RASP: any hard threat is disqualifying, full stop, before spending time on the chain check.
  const threats = Array.isArray(body.raspThreats) ? body.raspThreats : [];
  const raspClean = !threats.some((t) => HARD_THREATS.has(t));

  // Hardware provenance — the actual new capability this module adds.
  const chainResult = await verifyKeyAttestationChain(certChainBase64, devicePubKeyBase64);
  if (!chainResult.ok) {
    return errorResponse(`Hardware attestation failed: ${chainResult.reason}`, 403);
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

  const deviceHash = await sha256Hex(deviceKeyBytes);
  const now = Date.now();
  const verdict: DeviceIntegrityVerdict = {
    securityLevel: chainResult.securityLevel,
    hardwareVerified: true,
    raspClean: true,
    holderTier,
    deviceHash,
    issuedAt: now,
    expiresAt: now + VERDICT_TTL_SECONDS * 1000,
  };
  await env.DEVICE_INTEGRITY.put(walletKey(walletAddress), JSON.stringify(verdict), {
    expirationTtl: VERDICT_TTL_SECONDS,
  });

  return jsonResponse({ status: "clean", ...verdict });
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
