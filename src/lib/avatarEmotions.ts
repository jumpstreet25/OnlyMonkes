/**
 * avatarEmotions.ts — Emotion detection from blendshapes + avatar personality.
 *
 * Detects emotions from blendshape thresholds (no LLM needed at runtime).
 * Maps emotions to avatar animation parameters (glow color, intensity, scale).
 * Room atmosphere is derived from aggregate participant emotions.
 *
 * Hermes integration: personality generation runs once per session via
 * Ollama/Groq to create per-NFT animation flavor text → params.
 */

import type { BlendshapeParams, BlendshapeName } from './faceTracking';
import { GROQ_API_KEY } from '@/lib/constants';

// ── Emotion Types ───────────────────────────────────────────────────────────

export type Emotion =
  | 'neutral'
  | 'happy'
  | 'surprised'
  | 'angry'
  | 'sad'
  | 'thinking'
  | 'laughing';

export interface EmotionState {
  primary: Emotion;
  confidence: number;    // 0-1
  secondary?: Emotion;
}

export interface EmotionAnimParams {
  glowColor: string;
  glowIntensity: number;   // 0-1, multiplier on existing glow
  scaleBoost: number;       // added to speak scale (e.g., 0.02 for excited)
  breathSpeed: number;      // multiplier (1 = normal, 1.5 = fast, 0.7 = slow)
}

export interface RoomAtmosphere {
  energy: number;          // 0-1, aggregate excitement
  mood: 'chill' | 'excited' | 'tense' | 'mixed';
  dominantEmotion: Emotion;
}

// ── Emotion Detection (threshold-based, no LLM) ────────────────────────────

function bs(values: Record<BlendshapeName, number>, name: BlendshapeName): number {
  return values[name] ?? 0;
}

export function detectEmotion(params: BlendshapeParams): EmotionState {
  const v = params.values;

  const jawOpen = bs(v, 'jawOpen');
  const smileL = bs(v, 'mouthSmileLeft');
  const smileR = bs(v, 'mouthSmileRight');
  const frownL = bs(v, 'mouthFrownLeft');
  const frownR = bs(v, 'mouthFrownRight');
  const browDownL = bs(v, 'browDownLeft');
  const browDownR = bs(v, 'browDownRight');
  const browInnerUp = bs(v, 'browInnerUp');
  const eyeWideL = bs(v, 'eyeWideLeft');
  const eyeWideR = bs(v, 'eyeWideRight');
  const eyeSquintL = bs(v, 'eyeSquintLeft');
  const eyeSquintR = bs(v, 'eyeSquintRight');

  const smile = (smileL + smileR) / 2;
  const frown = (frownL + frownR) / 2;
  const browDown = (browDownL + browDownR) / 2;
  const eyeWide = (eyeWideL + eyeWideR) / 2;
  const eyeSquint = (eyeSquintL + eyeSquintR) / 2;

  // Score each emotion
  const scores: Record<Emotion, number> = {
    neutral: 0.3,  // base bias toward neutral
    happy: smile * 0.8 + (jawOpen > 0.3 ? 0.2 : 0),
    surprised: eyeWide * 0.5 + jawOpen * 0.3 + browInnerUp * 0.2,
    angry: browDown * 0.4 + frown * 0.3 + eyeSquint * 0.3,
    sad: frown * 0.5 + browInnerUp * 0.3 + (1 - smile) * 0.2,
    thinking: browDown * 0.3 + eyeSquint * 0.3 + (jawOpen < 0.05 ? 0.2 : 0) + (smile < 0.1 ? 0.2 : 0),
    laughing: smile * 0.4 + jawOpen * 0.4 + (eyeSquint > 0.3 ? 0.2 : 0),
  };

  // Find top two
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [primary, confidence] = sorted[0] as [Emotion, number];
  const secondary = sorted[1]?.[0] as Emotion | undefined;

  return { primary, confidence: Math.min(1, confidence), secondary };
}

// ── Emotion → Animation Params ──────────────────────────────────────────────

const EMOTION_PARAMS: Record<Emotion, EmotionAnimParams> = {
  neutral:   { glowColor: '#22c55e', glowIntensity: 0.4, scaleBoost: 0,    breathSpeed: 1.0 },
  happy:     { glowColor: '#fbbf24', glowIntensity: 0.8, scaleBoost: 0.01, breathSpeed: 1.1 },
  surprised: { glowColor: '#60a5fa', glowIntensity: 0.9, scaleBoost: 0.03, breathSpeed: 1.3 },
  angry:     { glowColor: '#ef4444', glowIntensity: 0.7, scaleBoost: 0.02, breathSpeed: 1.4 },
  sad:       { glowColor: '#818cf8', glowIntensity: 0.3, scaleBoost: -0.01, breathSpeed: 0.7 },
  thinking:  { glowColor: '#a78bfa', glowIntensity: 0.5, scaleBoost: 0,    breathSpeed: 0.85 },
  laughing:  { glowColor: '#fde047', glowIntensity: 1.0, scaleBoost: 0.04, breathSpeed: 1.5 },
};

export function getEmotionAnimParams(emotion: Emotion): EmotionAnimParams {
  return EMOTION_PARAMS[emotion] ?? EMOTION_PARAMS.neutral;
}

// ── Room Atmosphere ─────────────────────────────────────────────────────────

export function computeRoomAtmosphere(participantEmotions: EmotionState[]): RoomAtmosphere {
  if (participantEmotions.length === 0) {
    return { energy: 0.3, mood: 'chill', dominantEmotion: 'neutral' };
  }

  // Count emotions
  const counts: Record<Emotion, number> = {
    neutral: 0, happy: 0, surprised: 0, angry: 0, sad: 0, thinking: 0, laughing: 0,
  };
  let totalEnergy = 0;

  for (const e of participantEmotions) {
    counts[e.primary] += e.confidence;
    // Energy from high-arousal emotions
    if (e.primary === 'happy' || e.primary === 'laughing' || e.primary === 'surprised') {
      totalEnergy += e.confidence;
    } else if (e.primary === 'angry') {
      totalEnergy += e.confidence * 0.7;
    } else {
      totalEnergy += e.confidence * 0.2;
    }
  }

  const energy = Math.min(1, totalEnergy / participantEmotions.length);

  // Find dominant
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as Emotion;

  // Determine mood
  let mood: RoomAtmosphere['mood'] = 'mixed';
  if (energy > 0.7) mood = 'excited';
  else if (energy < 0.3) mood = 'chill';
  else if (dominant === 'angry') mood = 'tense';

  return { energy, mood, dominantEmotion: dominant };
}

// ── Avatar Personality (Hermes one-shot) ────────────────────────────────────

export interface AvatarPersonality {
  style: string;         // e.g., "chill beach monkey", "fierce warrior"
  idleQuirk: string;     // e.g., "occasional ear twitch", "slow head bob"
  speakStyle: string;    // e.g., "energetic bouncing", "calm presence"
  glowTint: string;      // hex color that matches the NFT's vibe
}

const PERSONALITY_PROMPT = `You are analyzing a Saga Monkes NFT with these traits:
{TRAITS}

Based on these traits, generate a personality profile for this animated avatar in a live chat room. Return ONLY a JSON object:
{
  "style": "2-3 word personality description",
  "idleQuirk": "unique idle animation behavior (keep it subtle)",
  "speakStyle": "how this monkey moves when talking",
  "glowTint": "#hex color that matches this monkey's vibe"
}`;

/**
 * Generate avatar personality from NFT traits via Hermes (Ollama/Groq).
 * Fire-and-forget safe — returns null on failure.
 */
export async function generatePersonality(
  traits: Array<{ trait_type: string; value: string }>,
): Promise<AvatarPersonality | null> {
  const traitsStr = traits.map(t => `${t.trait_type}: ${t.value}`).join('\n');
  const prompt = PERSONALITY_PROMPT.replace('{TRAITS}', traitsStr);

  // Try Ollama first (local, free)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2:3b',  // Small model is fine for personality gen
        prompt,
        stream: false,
        options: { temperature: 0.7 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const match = data.response?.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    }
  } catch { /* fallback */ }

  // Try Groq (free tier)
  try {
    const groqKey = GROQ_API_KEY;
    if (!groqKey) return null;
    const controller2 = new AbortController();
    const timer2 = setTimeout(() => controller2.abort(), 8000);
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 200,
      }),
      signal: controller2.signal,
    });
    clearTimeout(timer2);
    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    }
  } catch { /* ignore */ }

  return null;
}
