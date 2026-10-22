// Web stand-in for expo-file-system/legacy (whose web build throws on every
// call). The app only needs to read picked/captured images as base64 or text
// (blob:/data:/http URLs in a browser); there is no cache directory, so
// "downloads" hand back the original URL and directory/copy calls are no-ops.

export const EncodingType = { UTF8: "utf8", Base64: "base64" } as const;

export const cacheDirectory = "";
export const documentDirectory = "";

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function readAsStringAsync(uri: string, opts?: { encoding?: string }): Promise<string> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`read failed (${res.status})`);
  return opts?.encoding === EncodingType.Base64 ? toBase64(await res.arrayBuffer()) : res.text();
}

export async function downloadAsync(uri: string): Promise<{ uri: string; status: number }> {
  return { uri, status: 200 };
}

export async function getInfoAsync(): Promise<{ exists: false }> {
  return { exists: false };
}

export async function makeDirectoryAsync(): Promise<void> {}
export async function copyAsync(): Promise<void> {}
export async function writeAsStringAsync(): Promise<void> {}
export async function deleteAsync(): Promise<void> {}
