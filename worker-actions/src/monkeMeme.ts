/**
 * MonkeMeme fallback generator — FLUX.2 [klein] 4B on Workers AI.
 *
 * The app's first choice is a Hugging Face ZeroGPU Space called straight
 * from the phone (user's own free runs). Anonymous ZeroGPU callers only get
 * a handful of runs a day, so when that errors the app falls back here.
 *
 * Cost control — this route must never bill:
 *  - Workers AI free plan: 10,000 neurons/day; one 1024² meme with two 512²
 *    references is ~125 neurons. The same daily allocation also backs the
 *    bot's Cloudflare chat fallback hop, so memes are capped well below it.
 *  - GLOBAL_DAILY_CAP and PER_IP_DAILY_CAP via single-key KV get/put
 *    (never list() — KV list has its own daily cap, see index.ts history).
 *  - Holder check via the MonkeLedger service binding. The wallet is
 *    caller-supplied, so this only raises the bar; the caps are the real gate.
 */
import type { Env } from "./index";
import { CORS_HEADERS } from "./index";

const MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
const GLOBAL_DAILY_CAP = 60;
const PER_IP_DAILY_CAP = 6;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_PROMPT_CHARS = 2000;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

async function bump(kv: Env["COMMUNITY_DATA"], key: string, cap: number): Promise<boolean> {
  const used = Number((await kv.get(key)) ?? "0") || 0;
  if (used >= cap) return false;
  await kv.put(key, String(used + 1), { expirationTtl: 2 * 24 * 3600 });
  return true;
}

async function isHolder(env: Env, wallet: string): Promise<boolean> {
  try {
    const res = await env.MONKELEDGER.fetch(`https://monkeledger/wallet/${wallet}`);
    if (!res.ok) return false;
    const body = (await res.json()) as { owns?: boolean; assets?: unknown[] };
    return body.owns === true || (Array.isArray(body.assets) && body.assets.length > 0);
  } catch {
    return false;
  }
}

export async function handleMonkeMemeGenerate(request: Request, env: Env): Promise<Response> {
  if (!env.AI) return json({ error: "generator unavailable" }, 503);

  // Structural type: this file is also type-checked by the app's tsconfig,
  // whose React Native FormData lacks get().
  let form: { get(name: string): unknown };
  try {
    form = (await request.formData()) as unknown as { get(name: string): unknown };
  } catch {
    return json({ error: "expected multipart/form-data" }, 400);
  }
  const prompt = form.get("prompt");
  const wallet = form.get("wallet");
  const image0 = form.get("image_0");
  const image1 = form.get("image_1");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) {
    return json({ error: "bad prompt" }, 400);
  }
  if (typeof wallet !== "string" || !BASE58.test(wallet)) return json({ error: "bad wallet" }, 400);
  const images = [image0, image1].filter((f): f is File => f instanceof File);
  if (!images.length || images.some((f) => f.size === 0 || f.size > MAX_IMAGE_BYTES)) {
    return json({ error: "bad image" }, 400);
  }

  if (!(await isHolder(env, wallet))) return json({ error: "holders only" }, 403);

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const day = dayKey();
  const kv = env.COMMUNITY_DATA;
  if (!(await bump(kv, `monkememe:ip:${await sha256Hex(ip)}:${day}`, PER_IP_DAILY_CAP))) {
    return json({ error: "daily limit", kind: "quota" }, 429);
  }
  if (!(await bump(kv, `monkememe:global:${day}`, GLOBAL_DAILY_CAP))) {
    return json({ error: "generator busy for today", kind: "quota" }, 429);
  }

  const aiForm = new FormData();
  aiForm.append("prompt", prompt);
  images.forEach((f, i) => aiForm.append(`input_image_${i}`, f, f.name || `ref${i}.png`));
  aiForm.append("width", "1024");
  aiForm.append("height", "1024");
  // Workers AI multipart models want the serialized body + boundary header.
  const encoded = new Response(aiForm);
  try {
    const out = (await env.AI.run(MODEL, {
      multipart: { body: encoded.body, contentType: encoded.headers.get("content-type") ?? "multipart/form-data" },
    })) as { image?: string };
    if (!out?.image) return json({ error: "no image" }, 502);
    return json({ image: out.image });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Free-plan neuron exhaustion surfaces as an error, never a bill.
    const quota = /neuron|quota|limit|4006|429/i.test(msg);
    return json({ error: quota ? "generator busy for today" : "generation failed", kind: quota ? "quota" : "failed" }, quota ? 429 : 502);
  }
}
