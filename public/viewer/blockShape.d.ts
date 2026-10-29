// Types for blockShape.js (plain JS so the viewer pages can load it without a build).
export type Px = number[][][];
export type Cell = [number, number, number];
export interface BlockShape { headD: number; bodyD: number; width: number; wrap: number; ear: number; gap: number }
export interface BlockFace { i: number; j: number; k: number; dir: number; c: number }
export interface Parts<T> { head: T; body: T }

export const NECK_ROW: number;
export const RES: number;
export const V: number;
export const BLOCK_SHAPE: BlockShape;
export const BLOCK_LIMITS: { yaw: number; pitch: number; roll: number };
export const DIRS: Cell[];
export const FRONT: number;
export const BACK: number;
export function clampTilt(pitch: number, roll: number, L?: { pitch: number; roll: number }): [number, number];
export function isBg(r: number, g: number, b: number, a: number): boolean;
export function solidFromPx(px: Px): boolean[][];
export function toWorld(i: number, j: number, k: number, shape?: BlockShape): Cell;
export function neckPivot(solid: boolean[][], shape?: BlockShape): Cell;
export function blockFaces(px: Px, solid: boolean[][], shape?: BlockShape): {
  cubes: Parts<Cell[]>;
  faces: Parts<BlockFace[]>;
  zFront: Parts<number>;
  skin: number;
  fur: number;
};
