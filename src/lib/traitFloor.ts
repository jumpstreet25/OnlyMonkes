/**
 * traitFloor.ts — Fetch trait floor prices from Magic Eden for Saga Monkes
 *
 * Uses ME's public API to get floor prices per trait attribute.
 * Caches results for 10 minutes to avoid rate limiting.
 */

import type { NftTrait } from '@/types';

const ME_COLLECTION_SYMBOL = 'saga_monkes';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export interface TraitFloor {
  trait_type: string;
  value: string;
  floor: number; // SOL
}

// ─── Cache ──────────────────────────────────────────────────────────────────

let _traitFloors: TraitFloor[] = [];
let _traitFloorsAt = 0;
let _allTraitTypes: string[] = [];

/**
 * Fetch trait floor prices from Magic Eden.
 * ME endpoint: GET /v2/collections/{symbol}/attributes
 * Returns all attribute categories with their values and floor prices.
 */
export async function fetchTraitFloors(): Promise<TraitFloor[]> {
  if (_traitFloors.length && Date.now() - _traitFloorsAt < CACHE_TTL) {
    return _traitFloors;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(
      `https://api-mainnet.magiceden.dev/v2/collections/${ME_COLLECTION_SYMBOL}/attributes`,
      { headers: { Accept: 'application/json' }, signal: controller.signal },
    );
    clearTimeout(timer);
    if (!res.ok) {
      console.warn('[traitFloor] ME API error:', res.status);
      return _traitFloors;
    }

    const data = await res.json() as Array<{
      attribute: { traitType: string; value: string };
      floor?: number;
      listed?: number;
    }>;

    const floors: TraitFloor[] = [];
    const typeSet = new Set<string>();

    for (const entry of data) {
      const traitType = entry.attribute?.traitType;
      const value = entry.attribute?.value;
      const floor = entry.floor;
      if (!traitType || !value || !floor) continue;
      typeSet.add(traitType);
      floors.push({ trait_type: traitType, value, floor: floor / 1e9 }); // lamports → SOL
    }

    _traitFloors = floors;
    _traitFloorsAt = Date.now();
    _allTraitTypes = [...typeSet].sort();

    console.log(`[traitFloor] Loaded ${floors.length} trait floors across ${_allTraitTypes.length} types`);
    return floors;
  } catch (err) {
    console.warn('[traitFloor] Fetch error:', (err as Error).message);
    return _traitFloors;
  }
}

/**
 * Get all known trait type categories (e.g., "Background", "Fur", "Eyes").
 */
export function getTraitTypes(): string[] {
  return _allTraitTypes;
}

/**
 * Get the floor price for a specific trait value.
 */
export function getTraitFloor(traitType: string, value: string): number | null {
  const entry = _traitFloors.find(
    f => f.trait_type === traitType && f.value === value,
  );
  return entry?.floor ?? null;
}

/**
 * Find the "top trait" for an NFT — the trait with the highest floor price.
 * Returns the trait name, value, and floor price.
 */
export function getTopTrait(traits: NftTrait[]): { trait: NftTrait; floor: number } | null {
  if (!traits.length || !_traitFloors.length) return null;

  let best: { trait: NftTrait; floor: number } | null = null;

  for (const t of traits) {
    const floor = getTraitFloor(t.trait_type, t.value);
    if (floor !== null && (best === null || floor > best.floor)) {
      best = { trait: t, floor };
    }
  }

  return best;
}

/**
 * Get all unique trait values for a given trait type from the cached floors.
 */
export function getTraitValues(traitType: string): string[] {
  return _traitFloors
    .filter(f => f.trait_type === traitType)
    .sort((a, b) => a.value.localeCompare(b.value))
    .map(f => f.value);
}
