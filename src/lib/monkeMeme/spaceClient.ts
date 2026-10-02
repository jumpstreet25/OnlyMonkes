/**
 * spaceClient — calls a FLUX.2 [klein] Gradio Space (Hugging Face ZeroGPU)
 * straight from the phone. Calling from the device, not our VPS/Worker, is
 * the whole cost model: ZeroGPU bills GPU time to the caller, so every user
 * spends their own free daily allowance and we pay nothing.
 *
 * Anonymous callers get only ~3 runs/day ("ZeroGPU runs limit"), so the
 * caller (generate.ts) falls back to our Worker when this throws.
 *
 * Gradio's API is three steps:
 *   1. POST {space}/gradio_api/upload        multipart "files" → ["/tmp/gradio/…/x.png"]
 *      (the Space rejects plain or data: URLs for inputs — files must be uploaded —
 *      and silently fails on references larger than 512px)
 *   2. POST {space}/gradio_api/call/infer    {data:[…]} → {event_id}
 *   3. GET  {space}/gradio_api/call/infer/{id} → SSE text ending in
 *      "event: complete\ndata: [{url,…}, seed]" or "event: error".
 * RN's fetch can't stream, but step 3's response closes once the job is
 * done, so reading the whole body and parsing it afterwards is enough.
 */

export interface SpaceImage {
  /** Local file URI (file://…) from react-native-view-shot's captureRef. */
  uri: string;
  name: string;
}

export class SpaceError extends Error {
  constructor(message: string, readonly kind: "quota" | "busy" | "failed") {
    super(message);
  }
}

const UPLOAD_TIMEOUT_MS = 30_000;
const RESULT_TIMEOUT_MS = 180_000;

async function fetchT(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function upload(api: string, img: SpaceImage): Promise<string> {
  const form = new FormData();
  // React Native's FormData file part: {uri, name, type}.
  form.append("files", { uri: img.uri, name: img.name, type: "image/png" } as unknown as Blob);
  const res = await fetchT(`${api}/upload`, { method: "POST", body: form }, UPLOAD_TIMEOUT_MS);
  if (!res.ok) throw new SpaceError(`upload ${res.status}`, res.status === 429 ? "busy" : "failed");
  const paths = (await res.json()) as unknown;
  if (!Array.isArray(paths) || typeof paths[0] !== "string") throw new SpaceError("upload: bad response", "failed");
  return paths[0];
}

/** Parse the final SSE body of /call/infer/{id}. Exported for tests. */
export function parseSseResult(body: string): { url: string } {
  const lines = body.split(/\r?\n/);
  let event = "";
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:") && (event === "complete" || event === "error")) {
      const raw = line.slice(5).trim();
      if (event === "error") {
        const msg = raw && raw !== "null" ? raw : "generation failed";
        const quota = /quota|exceeded|gpu limit|zerogpu/i.test(msg);
        throw new SpaceError(msg, quota ? "quota" : "failed");
      }
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new SpaceError("bad result payload", "failed");
      }
      const first = Array.isArray(data) ? data[0] : null;
      const url = first && typeof first === "object" ? (first as { url?: unknown }).url : null;
      if (typeof url !== "string" || !/^https:\/\//.test(url)) throw new SpaceError("no image in result", "failed");
      return { url };
    }
  }
  // Stream closed without a terminal event — treat like a busy queue.
  throw new SpaceError("no result from generator", "busy");
}

export interface GenerateArgs {
  spaceUrl: string;
  prompt: string;
  /** image 1 = the monke PFP, image 2 (optional) = house style reference. */
  images: SpaceImage[];
  seed?: number;
}

/** Returns a temporary https URL of the generated image on the Space. */
export async function generateOnSpace({ spaceUrl, prompt, images, seed }: GenerateArgs): Promise<string> {
  const api = `${spaceUrl}/gradio_api`;
  const paths: string[] = [];
  for (const img of images) paths.push(await upload(api, img));

  const inputImages = paths.map((path, i) => ({
    image: { path, orig_name: images[i].name, mime_type: "image/png", meta: { _type: "gradio.FileData" } },
    caption: null,
  }));
  // Order matches the Space's /infer signature: prompt, input_images, mode,
  // seed, randomize_seed, width, height, steps, guidance, prompt_upsampling.
  const data = [prompt, inputImages, "Distilled (4 steps)", seed ?? 0, seed === undefined, 1024, 1024, 4, 1.0, false];

  const start = await fetchT(
    `${api}/call/infer`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) },
    UPLOAD_TIMEOUT_MS,
  );
  if (!start.ok) throw new SpaceError(`queue ${start.status}`, start.status === 429 ? "busy" : "failed");
  const { event_id } = (await start.json()) as { event_id?: string };
  if (!event_id) throw new SpaceError("no event id", "failed");

  const result = await fetchT(`${api}/call/infer/${event_id}`, { method: "GET" }, RESULT_TIMEOUT_MS);
  if (!result.ok) throw new SpaceError(`result ${result.status}`, "failed");
  return parseSseResult(await result.text()).url;
}

export interface FallbackArgs {
  fallbackUrl: string;
  prompt: string;
  images: SpaceImage[];
  /** Holder wallet — the Worker checks it against MonkeLedger. */
  wallet: string;
}

/** Workers AI fallback (worker-actions /api/monkememe/generate). Returns a
 *  data: URI (the model returns JPEG). */
export async function generateOnWorker({ fallbackUrl, prompt, images, wallet }: FallbackArgs): Promise<string> {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("wallet", wallet);
  images.slice(0, 2).forEach((img, i) =>
    form.append(`image_${i}`, { uri: img.uri, name: img.name, type: "image/png" } as unknown as Blob),
  );
  const res = await fetchT(`${fallbackUrl}/api/monkememe/generate`, { method: "POST", body: form }, RESULT_TIMEOUT_MS);
  let body: { image?: unknown; kind?: unknown; error?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    // fall through to status handling
  }
  if (res.ok && typeof body.image === "string" && body.image.length > 100) {
    return `data:image/jpeg;base64,${body.image}`;
  }
  if (res.status === 429 || body.kind === "quota") throw new SpaceError("fallback quota", "quota");
  throw new SpaceError(typeof body.error === "string" ? body.error : `fallback ${res.status}`, "failed");
}
