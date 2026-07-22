/**
 * mediaCache.ts — writes IMAGE: message payloads to real cache files instead
 * of leaving them as base64 data URIs embedded in messageCache.ts's
 * AsyncStorage-persisted JSON blob.
 *
 * Every photo taken in-app and every PnL/Clout/LivePnL card shared to chat
 * embeds a full base64 JPEG directly in the message `content` string
 * (100-400KB as text). Kept indefinitely (see messageCache.ts's
 * isPreservable), that JSON blob only grows for the life of the install,
 * and JSON.parse-ing an ever-growing multi-MB blob on every cold start was
 * already diagnosed as the direct cause of load times climbing over time
 * (see MAX_PRESERVABLE's history in messageCache.ts).
 *
 * Uses SDK 54's new class-based expo-file-system API (File/Directory/Paths)
 * — sync reads/writes, no more separate legacy readAsStringAsync/
 * writeAsStringAsync calls. `file://` URIs render identically to `data:`
 * URIs in RN's <Image>/<VideoView> components, so nothing downstream needs
 * to change — this only touches the persistence layer.
 */

import { File, Directory, Paths } from "expo-file-system";

const CACHE_DIR_NAME = "chat_media";

function getCacheDir(): Directory {
  const dir = new Directory(Paths.cache, CACHE_DIR_NAME);
  if (!dir.exists) {
    try {
      dir.create({ intermediates: true, idempotent: true });
    } catch { /* best-effort — caller falls back to the original data URI */ }
  }
  return dir;
}

const DATA_URI_PREFIX = "data:image/jpeg;base64,";

/**
 * If `content` is an IMAGE: message carrying an embedded base64 data URI,
 * write the image to a real cache file and return the rewritten
 * `IMAGE:file://...` content string. Returns the original content
 * unchanged for anything else (already-cached file:// references, remote
 * URLs, non-IMAGE content, or on any failure — never throws).
 */
export function cacheImageContent(messageId: string, content: string): string {
  if (!content.startsWith("IMAGE:")) return content;
  const dataUri = content.slice("IMAGE:".length);
  if (!dataUri.startsWith(DATA_URI_PREFIX)) return content; // already file:// or some other form

  try {
    const file = new File(getCacheDir(), `${messageId}.jpg`);
    if (!file.exists) {
      const base64 = dataUri.slice(DATA_URI_PREFIX.length);
      file.write(base64, { encoding: "base64" });
    }
    return `IMAGE:${file.uri}`;
  } catch {
    return content; // fall back to the original data URI — never lose the image
  }
}

/** Best-effort delete — called when a preservable message ages out of messageCache.ts's MAX_PRESERVABLE trim. */
export function deleteCachedImage(messageId: string): void {
  try {
    const file = new File(getCacheDir(), `${messageId}.jpg`);
    if (file.exists) file.delete();
  } catch { /* non-critical */ }
}
