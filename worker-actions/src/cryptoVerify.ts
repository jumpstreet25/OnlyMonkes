/**
 * cryptoVerify.ts — shared crypto/encoding helpers for verifying Android-Keystore-produced
 * signatures and Solana wallet signatures inside the Workers runtime (Web Crypto only, no
 * Node-native dependency). Extracted from sentimentOracle.ts so deviceIntegrity.ts can reuse
 * the same, already-battle-tested logic instead of a second copy drifting.
 */

// ─── Base64 / bytes helpers ──────────────────────────────────────────────────

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

// ─── ECDSA P-256 (device attestation key) verification ──────────────────────────────────
//
// Android's Signature.getInstance("SHA256withECDSA") produces a DER-encoded (r,s) signature.
// Web Crypto's ECDSA verify expects raw, fixed-width r||s (IEEE P1363) — NOT DER. This
// converts DER → raw before calling crypto.subtle.verify. Written against real
// Android-Keystore-produced signatures, not assumed from spec alone.

export function derToRawEcdsaSignature(der: Uint8Array): Uint8Array | null {
  if (der.length < 8 || der[0] !== 0x30) return null;
  let offset = 1;
  let seqLen = der[offset++];
  if (seqLen & 0x80) {
    const n = seqLen & 0x7f;
    seqLen = 0;
    for (let i = 0; i < n; i++) seqLen = (seqLen << 8) | der[offset++];
  }
  function readInt(): Uint8Array | null {
    if (der[offset] !== 0x02) return null;
    offset++;
    let len = der[offset++];
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | der[offset++];
    }
    if (offset + len > der.length) return null;
    const bytes = der.slice(offset, offset + len);
    offset += len;
    return bytes;
  }
  const r = readInt();
  const s = readInt();
  if (!r || !s) return null;

  const toFixed32 = (b: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < b.length - 1 && b[start] === 0) start++;
    const trimmed = b.slice(start);
    const out = new Uint8Array(32);
    out.set(trimmed.slice(Math.max(0, trimmed.length - 32)), Math.max(0, 32 - trimmed.length));
    return out;
  };

  const raw = new Uint8Array(64);
  raw.set(toFixed32(r), 0);
  raw.set(toFixed32(s), 32);
  return raw;
}

export async function verifyEcdsaP256(
  spkiDerBytes: Uint8Array,
  message: Uint8Array,
  derSignature: Uint8Array,
): Promise<boolean> {
  try {
    const rawSig = derToRawEcdsaSignature(derSignature);
    if (!rawSig) return false;
    const key = await crypto.subtle.importKey(
      "spki",
      spkiDerBytes as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      rawSig as BufferSource,
      message as BufferSource,
    );
  } catch {
    return false;
  }
}

// ─── Ed25519 (Solana wallet) verification — device→wallet binding proof ────────────────
// Cloudflare Workers' Web Crypto supports Ed25519 natively; no extra dependency needed.

export async function verifyEd25519(
  publicKeyBytes: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify("Ed25519", key, signature as BufferSource, message as BufferSource);
  } catch {
    return false;
  }
}

export function base58ToBytes(s: string): Uint8Array | null {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = 0n;
  for (const ch of s) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    num = num * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num /= 256n;
  }
  for (const ch of s) {
    if (ch === "1") bytes.unshift(0);
    else break;
  }
  return new Uint8Array(bytes);
}

// ─── Shared threat set ───────────────────────────────────────────────────────
// Mirrors HARD_THREATS in src/lib/security.ts — a request/batch reporting any of these is
// rejected, regardless of what else it proves (ownership, key provenance, etc).

export const HARD_THREATS = new Set([
  "privilegedAccess",
  "hooks",
  "appIntegrity",
  "deviceBinding",
  "raspNotConfigured",
]);
