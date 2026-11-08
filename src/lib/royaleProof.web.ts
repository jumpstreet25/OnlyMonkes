import { getXmtpCredential } from "@/web/webAuth";

/** Web: the holder sign-in token for every MonkeCaves proof (see royaleProof.ts); the message is phone-only. */
export async function holderGameProof(_messageFor?: (nonce: string) => string, _canPrompt = true): Promise<Record<string, string>> {
  const { value } = await getXmtpCredential();
  return { kind: "holder", token: value.replace(/^Bearer /, "") };
}

/** The match server checks it's a Saga Monke holder. */
export const royaleProof = (_canPrompt = true) => holderGameProof();
