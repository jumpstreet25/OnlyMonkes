import { getXmtpCredential } from "@/web/webAuth";

/** Web: the holder sign-in token (see referralProof.ts). */
export async function referralProof(_action: string): Promise<Record<string, string> | null> {
  try {
    const { value } = await getXmtpCredential();
    return { kind: "holder", token: value.replace(/^Bearer /, "") };
  } catch {
    return null;
  }
}
