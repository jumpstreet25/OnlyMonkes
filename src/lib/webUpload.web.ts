import { getXmtpCredential } from "@/web/webAuth";

const UPLOAD_URL = "https://onlymonkes.app/api/upload";
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Web: the image host's upload preset can't sit in a public site, so the
 * actions worker forwards the file for a signed-in holder (bearer = the web
 * sign-in token) and returns its public URL.
 */
export async function uploadViaWorker(uri: string, filename: string, mimeType: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  if (blob.size > MAX_BYTES) throw new Error("File is over 10 MB");
  const form = new FormData();
  form.append("file", new File([blob], filename, { type: mimeType || blob.type }));
  const { value } = await getXmtpCredential();
  const res = await fetch(UPLOAD_URL, { method: "POST", headers: { Authorization: value }, body: form });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data.url;
}
