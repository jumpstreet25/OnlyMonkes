/**
 * nftFeatureDetection.ts — Per-NFT facial feature detection via Hermes/Ollama vision.
 *
 * Uses LLaVA (local vision model) to detect facial feature bounding boxes
 * on each unique NFT image. Results are cached in AsyncStorage forever
 * (an NFT's image never changes).
 *
 * Pipeline: NFT Image → Ollama LLaVA → Feature Map JSON → AsyncStorage
 *
 * Falls back to default Saga Monke positions if detection fails or
 * Ollama isn't available.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { GROQ_API_KEY } from '@/lib/constants';

// ── Types ────────────────────────────────────────────────────────────────────

export interface FeatureRect {
  x: number;      // center X as fraction of image width (0-1)
  y: number;      // center Y as fraction of image height (0-1)
  w: number;      // width as fraction of image width
  h: number;      // height as fraction of image height
}

export interface NFTFeatureMap {
  leftEye: FeatureRect;
  rightEye: FeatureRect;
  mouth: FeatureRect;
  leftBrow: FeatureRect;
  rightBrow: FeatureRect;
  detectedAt: number;
  source: 'ollama' | 'default' | 'manual';
}

// ── Default Saga Monke positions ────────────────────────────────────────────
// Calibrated from visual inspection of typical Saga Monke pixel art.

const DEFAULT_FEATURE_MAP: NFTFeatureMap = {
  leftEye:   { x: 0.36, y: 0.44, w: 0.10, h: 0.06 },
  rightEye:  { x: 0.64, y: 0.44, w: 0.10, h: 0.06 },
  mouth:     { x: 0.50, y: 0.67, w: 0.32, h: 0.10 },
  leftBrow:  { x: 0.36, y: 0.38, w: 0.12, h: 0.04 },
  rightBrow: { x: 0.64, y: 0.38, w: 0.12, h: 0.04 },
  detectedAt: 0,
  source: 'default',
};

// ── Cache ────────────────────────────────────────────────────────────────────

const CACHE_PREFIX = 'nft_features_v1_';

export async function getCachedFeatureMap(nftMint: string): Promise<NFTFeatureMap | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + nftMint);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

async function cacheFeatureMap(nftMint: string, map: NFTFeatureMap): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + nftMint, JSON.stringify(map));
  } catch { /* ignore */ }
}

// ── Ollama Vision Detection ─────────────────────────────────────────────────

const OLLAMA_URL = 'http://localhost:11434';
const VISION_MODEL = 'llava:13b';  // or 'bakllava' — both support vision

const DETECTION_PROMPT = `Analyze this pixel art monkey face image. I need the exact positions of facial features as percentages of the image dimensions.

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "leftEye": {"x": 0.36, "y": 0.44, "w": 0.10, "h": 0.06},
  "rightEye": {"x": 0.64, "y": 0.44, "w": 0.10, "h": 0.06},
  "mouth": {"x": 0.50, "y": 0.67, "w": 0.32, "h": 0.10},
  "leftBrow": {"x": 0.36, "y": 0.38, "w": 0.12, "h": 0.04},
  "rightBrow": {"x": 0.64, "y": 0.38, "w": 0.12, "h": 0.04}
}

Where x,y are the CENTER of each feature as a fraction of width/height (0-1).
w,h are the WIDTH and HEIGHT of each feature as fractions.
Left/right are from the character's perspective (left eye is on the right side of the image).`;

/**
 * Fetch image as base64 for Ollama vision API.
 */
async function imageToBase64(imageUri: string): Promise<string | null> {
  try {
    const response = await fetch(imageUri);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        // Strip data URL prefix to get raw base64
        const base64 = dataUrl.split(',')[1];
        resolve(base64 ?? null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Call Ollama vision model to detect facial features on an NFT image.
 */
async function detectViaOllama(imageUri: string): Promise<NFTFeatureMap | null> {
  const base64 = await imageToBase64(imageUri);
  if (!base64) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VISION_MODEL,
        prompt: DETECTION_PROMPT,
        images: [base64],
        stream: false,
        options: { temperature: 0.1 },  // Low temp for consistent JSON output
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) return null;

    const data = await response.json();
    const text = data.response?.trim() ?? '';

    // Extract JSON from response (may have markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate structure
    const features = ['leftEye', 'rightEye', 'mouth', 'leftBrow', 'rightBrow'];
    for (const f of features) {
      if (!parsed[f] || typeof parsed[f].x !== 'number') return null;
      // Clamp to valid range
      parsed[f].x = Math.max(0, Math.min(1, parsed[f].x));
      parsed[f].y = Math.max(0, Math.min(1, parsed[f].y));
      parsed[f].w = Math.max(0.02, Math.min(0.5, parsed[f].w));
      parsed[f].h = Math.max(0.02, Math.min(0.5, parsed[f].h));
    }

    return {
      ...parsed,
      detectedAt: Date.now(),
      source: 'ollama' as const,
    };
  } catch {
    return null;
  }
}

// ── Groq/Cerebras cloud fallback (free tier) ────────────────────────────────

async function detectViaGroq(imageUri: string): Promise<NFTFeatureMap | null> {
  // Groq's Llama Vision models support image input
  // This is a fallback if Ollama isn't running locally
  const groqKey = GROQ_API_KEY;
  if (!groqKey) return null;

  const base64 = await imageToBase64(imageUri);
  if (!base64) return null;

  try {
    const controller2 = new AbortController();
    const timer2 = setTimeout(() => controller2.abort(), 15000);
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.2-90b-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: DETECTION_PROMPT },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
      signal: controller2.signal,
    });
    clearTimeout(timer2);

    if (!response.ok) return null;

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const features = ['leftEye', 'rightEye', 'mouth', 'leftBrow', 'rightBrow'];
    for (const f of features) {
      if (!parsed[f] || typeof parsed[f].x !== 'number') return null;
      parsed[f].x = Math.max(0, Math.min(1, parsed[f].x));
      parsed[f].y = Math.max(0, Math.min(1, parsed[f].y));
      parsed[f].w = Math.max(0.02, Math.min(0.5, parsed[f].w));
      parsed[f].h = Math.max(0.02, Math.min(0.5, parsed[f].h));
    }

    return { ...parsed, detectedAt: Date.now(), source: 'ollama' as const };
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get facial feature positions for an NFT. Checks cache first, then
 * tries Ollama vision detection, falls back to defaults.
 *
 * This is fire-and-forget safe — always returns a usable feature map.
 */
export async function getFeatureMap(
  nftMint: string,
  imageUri: string,
): Promise<NFTFeatureMap> {
  // 1. Check cache
  const cached = await getCachedFeatureMap(nftMint);
  if (cached) return cached;

  // 2. Try Ollama vision (local)
  const detected = await detectViaOllama(imageUri);
  if (detected) {
    await cacheFeatureMap(nftMint, detected);
    return detected;
  }

  // 3. Try Groq cloud fallback
  const groqDetected = await detectViaGroq(imageUri);
  if (groqDetected) {
    await cacheFeatureMap(nftMint, groqDetected);
    return groqDetected;
  }

  // 4. Default positions
  return DEFAULT_FEATURE_MAP;
}

/**
 * Get default feature map (no detection, instant).
 */
export function getDefaultFeatureMap(): NFTFeatureMap {
  return { ...DEFAULT_FEATURE_MAP };
}

/**
 * Pre-detect features for a list of NFTs (batch, fire-and-forget).
 * Call during app startup for known holders.
 */
export async function preDetectFeatures(
  nfts: Array<{ mint: string; imageUri: string }>,
): Promise<void> {
  for (const nft of nfts) {
    const cached = await getCachedFeatureMap(nft.mint);
    if (!cached) {
      // Non-blocking — don't await each one
      getFeatureMap(nft.mint, nft.imageUri).catch(() => {});
      // Small delay to avoid hammering Ollama
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}
