import Constants from 'expo-constants';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as FileSystem from 'expo-file-system';

const CLOUD_NAME = Constants.expoConfig?.extra?.cloudinaryCloudName as string;
const UPLOAD_PRESET = Constants.expoConfig?.extra?.cloudinaryUploadPreset as string;
const THUMB_DIR = FileSystem.cacheDirectory + 'video_thumbs/';

export async function getOrGenerateThumbnail(videoUri: string): Promise<string> {
  const hash = videoUri.split('/').pop()?.replace(/\W/g, '') ?? Date.now().toString();
  const cachedPath = THUMB_DIR + hash + '.jpg';
  const info = await FileSystem.getInfoAsync(cachedPath);
  if (info.exists) return cachedPath;
  await FileSystem.makeDirectoryAsync(THUMB_DIR, { intermediates: true });
  const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: 0 });
  await FileSystem.copyAsync({ from: uri, to: cachedPath });
  return cachedPath;
}

export async function uploadVideo(videoUri: string): Promise<{ videoUrl: string; thumbUrl: string }> {
  const thumbUri = await getOrGenerateThumbnail(videoUri);

  const vForm = new FormData();
  vForm.append('file', { uri: videoUri, type: 'video/mp4', name: 'video.mp4' } as any);
  vForm.append('upload_preset', UPLOAD_PRESET);
  const vRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`, {
    method: 'POST',
    body: vForm,
  });
  const vData = await vRes.json();
  if (!vData.secure_url) throw new Error(vData.error?.message ?? 'Video upload failed');

  const tForm = new FormData();
  tForm.append('file', { uri: thumbUri, type: 'image/jpeg', name: 'thumb.jpg' } as any);
  tForm.append('upload_preset', UPLOAD_PRESET);
  const tRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: tForm,
  });
  const tData = await tRes.json();
  const thumbUrl = tData.secure_url ?? vData.secure_url + '.jpg';

  return { videoUrl: vData.secure_url, thumbUrl };
}
