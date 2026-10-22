import { getXmtpCredential } from "@/web/webAuth";

/** Web: the holder sign-in token proves this is a verified holder (see livekitProof.ts). */
export async function livekitProof(_roomName: string, _identity: string): Promise<Record<string, string> | undefined> {
  try {
    const { value } = await getXmtpCredential();
    return { kind: "holder", token: value.replace(/^Bearer /, "") };
  } catch {
    return undefined;
  }
}
