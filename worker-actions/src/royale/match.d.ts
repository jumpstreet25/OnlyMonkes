// Types for match.js (a copy of public/viewer/caves-royale.js on the web-app branch).
export const ROYALE_VERSION: number;
export const VS: { HP: number; KILLS_TO_WIN: number; TIME: number; SEATS: number; [k: string]: number };
export const ROSTER: { n: number; skill: number }[];
export const BANANAS: { WIN: number; KILL: number; BOTS_ONLY: number; DAILY_MAX: number };

export interface Fighter {
  id: string; n: number; name: string; bot: boolean; skill: number;
  x: number; y: number; a: number; hp: number; ammo: number; dead: number; shield: number;
  kills: number; deaths: number; fix?: boolean;
}
export interface MatchEvent { t: string; id?: string; by?: string; winner?: string | null; [k: string]: unknown }
export interface Match {
  fighters: Fighter[]; time: number; over: boolean; winner: string | null;
  addFighter(opts: { id: string; n: number; name?: string; bot?: boolean; skill?: number }): Fighter;
  fillBots(seats?: number): void;
  replaceBot(opts: { id: string; n: number; name?: string }): Fighter | null;
  botify(id: string): void;
  step(dt: number, human?: Record<string, { x: number; y: number; a: number; aim?: number; fire?: boolean }>): MatchEvent[];
  snapshot(): { tm: number; f: unknown[]; s: unknown[]; p: string };
  standings(): Fighter[];
}
export function createMatch(arena: unknown, opts?: { seed?: number }): Match;
export function matchBananas(m: Match, id: string): number;
