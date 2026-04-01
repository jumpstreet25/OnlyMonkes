/**
 * mouthOverlays.ts — Mouth trait→sprite mapping and audio energy→state mapping
 * for animated Saga Monke avatars in live rooms.
 *
 * 4 mouth traits × 5 animation states = 20 transparent PNG sprites.
 * Positioned at a fixed rect (all Monkes share the same facial structure).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type MouthTrait = 'Beaming' | 'Doobie' | 'None' | 'OwO';
export type MouthState = 'closed' | 'slightly_open' | 'open' | 'wide' | 'round';

export const MOUTH_TRAITS: MouthTrait[] = ['Beaming', 'Doobie', 'None', 'OwO'];
export const MOUTH_STATES: MouthState[] = ['closed', 'slightly_open', 'open', 'wide', 'round'];
export const DEFAULT_MOUTH_TRAIT: MouthTrait = 'None';

// ── Sprite Asset Map ─────────────────────────────────────────────────────────
// Each require() returns a number (React Native asset ID).
// Replace placeholder PNGs with art-matched sprites when ready.

/* eslint-disable @typescript-eslint/no-var-requires */
export const MOUTH_SPRITES: Record<MouthTrait, Record<MouthState, number>> = {
  Beaming: {
    closed:        require('../../assets/mouth-overlays/mouth_beaming_closed.png'),
    slightly_open: require('../../assets/mouth-overlays/mouth_beaming_slightly_open.png'),
    open:          require('../../assets/mouth-overlays/mouth_beaming_open.png'),
    wide:          require('../../assets/mouth-overlays/mouth_beaming_wide.png'),
    round:         require('../../assets/mouth-overlays/mouth_beaming_round.png'),
  },
  Doobie: {
    closed:        require('../../assets/mouth-overlays/mouth_doobie_closed.png'),
    slightly_open: require('../../assets/mouth-overlays/mouth_doobie_slightly_open.png'),
    open:          require('../../assets/mouth-overlays/mouth_doobie_open.png'),
    wide:          require('../../assets/mouth-overlays/mouth_doobie_wide.png'),
    round:         require('../../assets/mouth-overlays/mouth_doobie_round.png'),
  },
  None: {
    closed:        require('../../assets/mouth-overlays/mouth_none_closed.png'),
    slightly_open: require('../../assets/mouth-overlays/mouth_none_slightly_open.png'),
    open:          require('../../assets/mouth-overlays/mouth_none_open.png'),
    wide:          require('../../assets/mouth-overlays/mouth_none_wide.png'),
    round:         require('../../assets/mouth-overlays/mouth_none_round.png'),
  },
  OwO: {
    closed:        require('../../assets/mouth-overlays/mouth_owo_closed.png'),
    slightly_open: require('../../assets/mouth-overlays/mouth_owo_slightly_open.png'),
    open:          require('../../assets/mouth-overlays/mouth_owo_open.png'),
    wide:          require('../../assets/mouth-overlays/mouth_owo_wide.png'),
    round:         require('../../assets/mouth-overlays/mouth_owo_round.png'),
  },
};
/* eslint-enable @typescript-eslint/no-var-requires */

// ── Mouth Overlay Positioning ────────────────────────────────────────────────
// Relative to PFP container. Same for all Monkes (identical facial structure).
// Calibrate these against real Saga Monke PFP images.

export const MOUTH_OVERLAY_RECT = {
  topPct: 0.62,      // mouth starts at 62% from top (just below nostrils)
  leftPct: 0.38,     // 38% from left edge (centered on monkey face)
  widthPct: 0.32,    // 32% of PFP width (mouth width)
  heightPct: 0.10,   // 10% of PFP height (mouth is small on pixel art)
};

// ── Audio Energy → Mouth State ───────────────────────────────────────────────

const ENERGY_THRESHOLDS: [number, MouthState][] = [
  [0.70, 'round'],
  [0.45, 'wide'],
  [0.20, 'open'],
  [0.05, 'slightly_open'],
];

// Hysteresis: track previous state to prevent jitter.
// Require 2 consecutive samples below threshold before transitioning down.
const _hysteresisCounters = new Map<string, number>();

export function energyToMouthState(
  energy: number,
  participantId?: string,
): MouthState {
  // Determine target state from energy
  let target: MouthState = 'closed';
  for (const [threshold, state] of ENERGY_THRESHOLDS) {
    if (energy >= threshold) {
      target = state;
      break;
    }
  }

  // Without hysteresis tracking, return directly
  if (!participantId) return target;

  // Hysteresis: only transition DOWN after 2 consecutive low samples
  const key = participantId;
  const currentIdx = MOUTH_STATES.indexOf(target);
  const prevCount = _hysteresisCounters.get(key) ?? 0;

  if (currentIdx < (prevCount >> 8)) {
    // Trying to go down — increment counter
    const count = (prevCount & 0xff) + 1;
    if (count < 2) {
      _hysteresisCounters.set(key, (prevCount & 0xff00) | count);
      return MOUTH_STATES[(prevCount >> 8)] ?? 'closed';
    }
  }

  // Update stored state index + reset counter
  _hysteresisCounters.set(key, (currentIdx << 8) | 0);
  return target;
}

/**
 * Get the sprite asset source for a given mouth trait and audio energy level.
 */
export function getMouthSprite(trait: MouthTrait, energy: number, participantId?: string): number {
  const state = energyToMouthState(energy, participantId);
  return MOUTH_SPRITES[trait]?.[state] ?? MOUTH_SPRITES.None.closed;
}

// ── Cross-fade support ──────────────────────────────────────────────────────
// Returns two sprites + a blend factor (0-1) for smooth interpolation.

const ENERGY_STOPS: { threshold: number; state: MouthState }[] = [
  { threshold: 0,    state: 'closed' },
  { threshold: 0.05, state: 'slightly_open' },
  { threshold: 0.20, state: 'open' },
  { threshold: 0.45, state: 'wide' },
  { threshold: 0.70, state: 'round' },
];

export interface CrossFadeSprites {
  spriteA: number;  // lower state sprite
  spriteB: number;  // upper state sprite
  blend: number;    // 0 = fully spriteA, 1 = fully spriteB
}

export function getCrossFadeSprites(trait: MouthTrait, energy: number): CrossFadeSprites {
  const sprites = MOUTH_SPRITES[trait] ?? MOUTH_SPRITES.None;

  // Find which two stops we're between
  let lowerIdx = 0;
  for (let i = ENERGY_STOPS.length - 1; i >= 0; i--) {
    if (energy >= ENERGY_STOPS[i].threshold) {
      lowerIdx = i;
      break;
    }
  }

  const upperIdx = Math.min(lowerIdx + 1, ENERGY_STOPS.length - 1);

  if (lowerIdx === upperIdx) {
    // At or above highest stop
    return { spriteA: sprites[ENERGY_STOPS[lowerIdx].state], spriteB: sprites[ENERGY_STOPS[lowerIdx].state], blend: 0 };
  }

  const lowerThresh = ENERGY_STOPS[lowerIdx].threshold;
  const upperThresh = ENERGY_STOPS[upperIdx].threshold;
  const t = (energy - lowerThresh) / (upperThresh - lowerThresh);

  return {
    spriteA: sprites[ENERGY_STOPS[lowerIdx].state],
    spriteB: sprites[ENERGY_STOPS[upperIdx].state],
    blend: Math.max(0, Math.min(1, t)),
  };
}

/**
 * Parse a mouth trait string from NFT attributes into our typed enum.
 * Returns DEFAULT_MOUTH_TRAIT if unrecognized.
 */
export function parseMouthTrait(raw: string | undefined | null): MouthTrait {
  if (!raw) return DEFAULT_MOUTH_TRAIT;
  const normalized = raw.trim();
  if (MOUTH_TRAITS.includes(normalized as MouthTrait)) return normalized as MouthTrait;
  return DEFAULT_MOUTH_TRAIT;
}
