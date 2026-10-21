import { deriveXmtpEoa, type DerivedXmtpEoa } from "./xmtpIdentity";

/** Native: the MWA signed payload goes straight into the derivation. */
export async function deriveBoundXmtpEoa(
  signedPayload: Uint8Array,
  walletAddress: string,
  generation: number,
): Promise<DerivedXmtpEoa> {
  return deriveXmtpEoa(signedPayload, walletAddress, generation);
}
