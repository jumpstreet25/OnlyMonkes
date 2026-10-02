/**
 * monkeNumbers — MONKE #n → its image, for every Saga Monke, offline.
 *
 * Built from MonkeLedger /export (2026-10-01, 9,999 live assets) and
 * verified to reproduce every asset's image URL exactly. The whole
 * collection fits in a few constants because images are always
 * `<arweave folder>/<n>.png`: two folders, three animated GIFs, and the
 * 15 burned numbers that no longer exist.
 *
 * Wave 2 (#8889–8988) are 1/1s whose only trait is "Wave: 02" — no fur,
 * head or eyes — so their art is the only description the generator gets.
 */

const BASE_A = "https://arweave.net/8bJFg1KcX8M_ahz3wJplqdG4-8we_Ts1pTSi5wephHE";
const BASE_B = "https://arweave.net/2x92sGwXGIDCumAN1vawXd6CitHeqyjuZ1fUWOVmfsY";
const BASE_B_RANGE: [number, number] = [8989, 10014];
const MAX_NUMBER = 10014;
const GIF_NUMBERS = new Set([8986, 8987, 8988]);
const BURNED_NUMBERS = new Set([411, 2976, 3109, 3140, 3850, 3970, 4747, 4979, 5203, 5363, 5462, 5952, 6692, 6797, 7894]);
const WAVE2_RANGE: [number, number] = [8889, 8988];

/** Image URL for MONKE #n, or null if n isn't a live Saga Monke. */
export function monkeImageForNumber(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > MAX_NUMBER || BURNED_NUMBERS.has(n)) return null;
  const base = n >= BASE_B_RANGE[0] && n <= BASE_B_RANGE[1] ? BASE_B : BASE_A;
  return `${base}/${n}.${GIF_NUMBERS.has(n) ? "gif" : "png"}`;
}

export function isWave2(n: number): boolean {
  return n >= WAVE2_RANGE[0] && n <= WAVE2_RANGE[1];
}

/** "MONKE #1760" / "#1760" / "1760" → 1760; anything else → null. */
export function parseMonkeNumber(text: string | null | undefined): number | null {
  const m = String(text ?? "").match(/#?\s*(\d{1,5})\s*$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return monkeImageForNumber(n) ? n : null;
}
