import { Client, PublicIdentity } from "@xmtp/react-native-sdk";
import { deriveXmtpEoa, type DerivedXmtpEoa } from "./xmtpIdentity";

const SIGNATURE_BYTES = 64;

/**
 * Web: the wallet signature arrives in MWA format (message + signature, see
 * src/web/walletStandard.ts signMessageMwaFormat), which is what spec-
 * compliant phone wallets return. A phone wallet that returned only the
 * 64-byte signature would have produced a different inbox, so derive both
 * from the one signature and keep whichever is already registered on XMTP.
 * Neither registered (new user) → the MWA-format one, same as most phones.
 */
export async function deriveBoundXmtpEoa(
  signedPayload: Uint8Array,
  walletAddress: string,
  generation: number,
): Promise<DerivedXmtpEoa> {
  const full = deriveXmtpEoa(signedPayload, walletAddress, generation);
  if (signedPayload.length <= SIGNATURE_BYTES) return full;
  const sigOnly = deriveXmtpEoa(signedPayload.slice(-SIGNATURE_BYTES), walletAddress, generation);
  const lookup = (Client as unknown as {
    getInboxIdForIdentifier: (id: PublicIdentity) => Promise<string | undefined>;
  }).getInboxIdForIdentifier;
  try {
    if (await lookup(new PublicIdentity(full.address, "ETHEREUM"))) return full;
    if (await lookup(new PublicIdentity(sigOnly.address, "ETHEREUM"))) return sigOnly;
  } catch (e) {
    console.warn("[XMTP] inbox lookup failed, using MWA-format identity:", (e as Error)?.message);
  }
  return full;
}
