import * as VideoThumbnails from 'expo-video-thumbnails';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Buffer } from 'buffer';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { holderGameProof } from '@/lib/royaleProof';

// Our own storage (worker-actions/src/webMedia.ts → R2, served from media.onlymonkes.app).
// The phone proves it's a holder with its hardware key (no wallet prompt when Device
// Integrity is clean; otherwise one signature, kept 24 h). No upload key in the app.
const UPLOAD_URL = 'https://onlymonkes.app/api/upload';
const THUMB_DIR = FileSystem.cacheDirectory + 'video_thumbs/';

/**
 * Compress a thumbnail to 480px wide, JPEG quality 0.7.
 */
async function compressThumbnail(uri: string): Promise<string> {
  const result = await manipulateAsync(
    uri,
    [{ resize: { width: 480 } }],
    { compress: 0.7, format: SaveFormat.JPEG },
  );
  return result.uri;
}

export async function getOrGenerateThumbnail(videoUri: string): Promise<string> {
  const hash = videoUri.split('/').pop()?.replace(/\W/g, '') ?? Date.now().toString();
  const cachedPath = THUMB_DIR + hash + '.jpg';
  const info = await FileSystem.getInfoAsync(cachedPath);
  if (info.exists) return cachedPath;
  await FileSystem.makeDirectoryAsync(THUMB_DIR, { intermediates: true });
  const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: 0 });
  // Compress the thumbnail before caching
  const compressed = await compressThumbnail(uri);
  await FileSystem.copyAsync({ from: compressed, to: cachedPath });
  return cachedPath;
}

async function uploadToMedia(uri: string, name: string, type: string, timeoutMs: number): Promise<string> {
  const proof = await holderGameProof((nonce) => `OnlyMonkes Upload\nnonce:${nonce}`);
  const form = new FormData();
  form.append('file', { uri, type, name } as any);
  const res = await fetchWithTimeout(UPLOAD_URL, {
    method: 'POST',
    headers: { 'X-OM-Proof': Buffer.from(JSON.stringify(proof), 'utf8').toString('base64') },
    body: form,
    timeoutMs,
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data.url;
}

export async function uploadVideo(videoUri: string): Promise<{ videoUrl: string; thumbUrl: string }> {
  const thumbUri = await getOrGenerateThumbnail(videoUri);
  const videoUrl = await uploadToMedia(videoUri, 'video.mp4', 'video/mp4', 120_000);
  const thumbUrl = await uploadToMedia(thumbUri, 'thumb.jpg', 'image/jpeg', 60_000);
  return { videoUrl, thumbUrl };
}

/** Upload a photo or file; returns its public HTTPS URL. */
export async function uploadFile(uri: string, filename: string, mimeType: string): Promise<string> {
  return uploadToMedia(uri, filename, mimeType, 120_000);
}

/**
 * Compress an image before upload — max 1200px wide, JPEG quality 0.7.
 */
export async function compressImage(uri: string): Promise<string> {
  const result = await manipulateAsync(
    uri,
    [{ resize: { width: 1200 } }],
    { compress: 0.7, format: SaveFormat.JPEG },
  );
  return result.uri;
}
