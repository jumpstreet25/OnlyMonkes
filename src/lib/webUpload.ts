// Native uploads go straight to the image host (src/lib/videoUpload.ts).
// The web version (webUpload.web.ts) goes through the actions worker.
export async function uploadViaWorker(_uri: string, _filename: string, _mimeType: string): Promise<string> {
  throw new Error("uploadViaWorker is web-only");
}
