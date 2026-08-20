/**
 * Wallet-stable XMTP identity.
 *
 * XMTP v5 only registers ETHEREUM | PASSKEY identities. Solana wallets are not
 * a PublicIdentity kind, so we derive a deterministic secp256k1 EOA from a
 * domain-separated Solana `signMessage` of the connected address.
 *
 * Same wallet + same message => same EOA => same XMTP inboxId on every phone,
 * runtime, and app upgrade. Never change IDENTITY_DOMAIN / message shape —
 * that would mint a new inbox for every user.
 *
 * The derived key is an OnlyMonkes XMTP identity key, not the Solana wallet.
 * It lives in SecureStore (wallet-scoped) so Client.create / addAccount can
 * run without a second MWA prompt after the first bind.
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { PublicIdentity } from "@xmtp/react-native-sdk";
import type { Signer } from "@xmtp/react-native-sdk";
import * as SecureStore from "expo-secure-store";

/** Frozen. Changing this string creates a new inbox for every wallet. */
export const XMTP_IDENTITY_DOMAIN = "onlymonkes-xmtp-identity-v1";

const SK_EOA_PREFIX = "xmtp_v5_eoa_";

export interface DerivedXmtpEoa {
  privateKey: Uint8Array;
  address: string;
}

export function xmtpIdentityMessage(walletAddress: string): string {
  return (
    `OnlyMonkes XMTP identity v1\n` +
    `Wallet: ${walletAddress}\n` +
    `This signature creates your OnlyMonkes chat identity. ` +
    `The same wallet always gets the same inbox on every device.`
  );
}

export function xmtpIdentityMessageBytes(walletAddress: string): Uint8Array {
  return new TextEncoder().encode(xmtpIdentityMessage(walletAddress));
}

function isValidSecpKey(key: Uint8Array): boolean {
  try {
    secp256k1.getPublicKey(key, true);
    return true;
  } catch {
    return false;
  }
}

export function deriveXmtpEoa(
  solanaSignature: Uint8Array,
  walletAddress: string,
): DerivedXmtpEoa {
  if (solanaSignature.length < 32) {
    throw new Error("XMTP identity: Solana signature too short");
  }
  const salt = new TextEncoder().encode(XMTP_IDENTITY_DOMAIN);
  let privateKey: Uint8Array | null = null;
  for (let i = 0; i < 8; i++) {
    const info = new TextEncoder().encode(`${walletAddress}:${i}`);
    const key = hkdf(sha256, solanaSignature, salt, info, 32);
    if (isValidSecpKey(key)) {
      privateKey = key;
      break;
    }
  }
  if (!privateKey) {
    throw new Error("XMTP identity: failed to derive secp256k1 key");
  }
  const uncompressed = secp256k1.getPublicKey(privateKey, false);
  const addressBytes = keccak_256(uncompressed.slice(1)).slice(-20);
  return {
    privateKey,
    address: `0x${bytesToHex(addressBytes)}`,
  };
}

function hashPersonalMessage(message: string): Uint8Array {
  const msg = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(
    `\x19Ethereum Signed Message:\n${msg.length}`,
  );
  const joined = new Uint8Array(prefix.length + msg.length);
  joined.set(prefix, 0);
  joined.set(msg, prefix.length);
  return keccak_256(joined);
}

function toEthSignatureHex(sig: {
  r: bigint;
  s: bigint;
  recovery: number;
}): string {
  const r = sig.r.toString(16).padStart(64, "0");
  const s = sig.s.toString(16).padStart(64, "0");
  const v = (sig.recovery + 27).toString(16).padStart(2, "0");
  return `0x${r}${s}${v}`;
}

export function makeXmtpEoaSigner(eoa: DerivedXmtpEoa): Signer {
  const identifier = new PublicIdentity(eoa.address, "ETHEREUM");
  return {
    getIdentifier: async () => identifier,
    getChainId: () => undefined,
    getBlockNumber: () => undefined,
    signerType: () => "EOA",
    signMessage: async (message: string) => {
      const hash = hashPersonalMessage(message);
      const sig = secp256k1.sign(hash, eoa.privateKey);
      return { signature: toEthSignatureHex(sig) };
    },
  };
}

function eoaStoreKey(walletAddress: string): string {
  return SK_EOA_PREFIX + walletAddress.slice(0, 16);
}

export async function loadDerivedXmtpEoa(
  walletAddress: string,
): Promise<DerivedXmtpEoa | null> {
  try {
    const stored = await SecureStore.getItemAsync(eoaStoreKey(walletAddress));
    if (!stored) return null;
    const bytes = Buffer.from(stored, "base64");
    if (bytes.length !== 32 || !isValidSecpKey(bytes)) return null;
    const uncompressed = secp256k1.getPublicKey(bytes, false);
    const addressBytes = keccak_256(uncompressed.slice(1)).slice(-20);
    return { privateKey: bytes, address: `0x${bytesToHex(addressBytes)}` };
  } catch {
    return null;
  }
}

export async function saveDerivedXmtpEoa(
  walletAddress: string,
  eoa: DerivedXmtpEoa,
): Promise<void> {
  await SecureStore.setItemAsync(
    eoaStoreKey(walletAddress),
    Buffer.from(eoa.privateKey).toString("base64"),
  );
}

export async function hasDerivedXmtpEoa(walletAddress: string): Promise<boolean> {
  return (await loadDerivedXmtpEoa(walletAddress)) !== null;
}
