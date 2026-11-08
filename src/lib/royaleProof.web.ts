import { getXmtpCredential } from "@/web/webAuth";

/** Web: the holder sign-in token (see royaleProof.ts). The match server checks it's a Saga Monke holder. */
export async function royaleProof(): Promise<Record<string, string>> {
  const { value } = await getXmtpCredential();
  return { kind: "holder", token: value.replace(/^Bearer /, "") };
}
