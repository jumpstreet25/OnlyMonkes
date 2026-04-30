import * as VideoThumbnails from 'expo-video-thumbnails';
import * as FileSystem from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from '@/lib/constants';

const CLOUD_NAME = CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = CLOUDINARY_UPLOAD_PRESET;
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

/**
 * Insert Cloudinary transformation into a URL for auto quality/format.
 * e.g. .../upload/v123/file.mp4 → .../upload/q_auto,f_auto/v123/file.mp4
 */
function addCloudinaryTransform(url: string, transform: string): string {
  return url.replace('/upload/', `/upload/${transform}/`);
}

export async function uploadVideo(videoUri: string): Promise<{ videoUrl: string; thumbUrl: string }> {
  const thumbUri = await getOrGenerateThumbnail(videoUri);

  const vForm = new FormData();
  vForm.append('file', { uri: videoUri, type: 'video/mp4', name: 'video.mp4' } as any);
  vForm.append('upload_preset', UPLOAD_PRESET);
  const vRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`, {
    method: 'POST',
    body: vForm,
    signal: AbortSignal.timeout(120_000),
  });
  const vData = await vRes.json();
  if (!vData.secure_url) throw new Error(vData.error?.message ?? 'Video upload failed');

  const tForm = new FormData();
  tForm.append('file', { uri: thumbUri, type: 'image/jpeg', name: 'thumb.jpg' } as any);
  tForm.append('upload_preset', UPLOAD_PRESET);
  const tRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: tForm,
    signal: AbortSignal.timeout(60_000),
  });
  const tData = await tRes.json();
  const thumbUrl = tData.secure_url ?? vData.secure_url + '.jpg';

  // Apply server-side transformations for optimized delivery
  return {
    videoUrl: addCloudinaryTransform(vData.secure_url, 'q_auto,f_auto'),
    thumbUrl: addCloudinaryTransform(thumbUrl, 'w_480,q_auto,f_auto'),
  };
}

/**
 * Upload a generic file to Cloudinary (raw resource type).
 * Returns the public HTTPS URL.
 */
export async function uploadFile(uri: string, filename: string, mimeType: string): Promise<string> {
  const form = new FormData();
  form.append('file', { uri, type: mimeType, name: filename } as any);
  form.append('upload_preset', UPLOAD_PRESET);
  // Use 'raw' resource type for generic files (PDFs, docs, etc.)
  const resourceType = mimeType.startsWith('image/') ? 'image'
    : mimeType.startsWith('video/') ? 'video'
    : 'raw';
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  if (!data.secure_url) throw new Error(data.error?.message ?? 'File upload failed');
  return data.secure_url;
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
