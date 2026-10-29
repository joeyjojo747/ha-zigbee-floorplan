// Coordinate maths for the building view. Every level's image is placed in one shared
// "building" frame in metres (x right, y down, as on the plans) by its top-left corner
// (floor.x, floor.y) and its scale. The 3D view is an oblique projection of that frame,
// with each level lifted by its elevation.
import type { Floor, Placement } from './api';

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Corner = 'nw' | 'ne' | 'sw' | 'se';
export type ViewMode = '2d' | '3d';
export type SizedFloor = Floor & { width: number; height: number };

/** A level without a scale is drawn this wide until it's scaled or resized in align mode. */
export const UNSCALED_WIDTH_M = 20;
/** 3D projection: depth is flattened by TILT and sheared by SKEW; elevation is exaggerated by LIFT. */
export const TILT = 0.5;
export const SKEW = 0.4;
export const LIFT = 8;

export const isSized = (floor: Floor | null | undefined): floor is SizedFloor => !!floor?.image && !!floor.width && !!floor.height;

/** The levels drawn: those with an image that aren't turned off, top to bottom. The active level is always drawn. */
export const shownLevels = (floors: Floor[], active: SizedFloor, hidden: string[]): SizedFloor[] =>
  floors.filter((f): f is SizedFloor => isSized(f) && (f.id === active.id || !hidden.includes(f.id)));

/** Image pixels per building metre, falling back to the unscaled width. */
const pxPerMetre = (floor: SizedFloor) => floor.pxPerMetre ?? floor.width / UNSCALED_WIDTH_M;

export const metresPerPx = (floor: SizedFloor) => 1 / pxPerMetre(floor);

export function floorRect(floor: SizedFloor): Rect {
  const ppm = pxPerMetre(floor);
  return { x: floor.x, y: floor.y, w: floor.width / ppm, h: floor.height / ppm };
}

export function imageToBuilding(floor: SizedFloor, p: Point): Point {
  const ppm = pxPerMetre(floor);
  return { x: floor.x + p.x / ppm, y: floor.y + p.y / ppm };
}

export function buildingToImage(floor: SizedFloor, p: Point): Point {
  const ppm = pxPerMetre(floor);
  return { x: (p.x - floor.x) * ppm, y: (p.y - floor.y) * ppm };
}

export const placementPoint = (floor: SizedFloor, placement: Placement): Point =>
  imageToBuilding(floor, { x: placement.x * floor.width, y: placement.y * floor.height });

/** A building point as placement fractions of the level's image, kept on the image. */
export function clampFraction(floor: SizedFloor, p: Point): Point {
  const image = buildingToImage(floor, p);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp(image.x / floor.width), y: clamp(image.y / floor.height) };
}

/** Elevation in metres of each level; floors are listed top to bottom and the bottom one is at 0. */
export function elevations(floors: Floor[]): Map<string, number> {
  const result: number[] = [];
  let elevation = 0;
  for (let i = floors.length - 1; i >= 0; i--) {
    result[i] = elevation;
    elevation += floors[i].floorHeight;
  }
  return new Map(floors.map((f, i) => [f.id, result[i]]));
}

export function project(p: Point, z: number, mode: ViewMode): Point {
  return mode === '2d' ? p : { x: p.x + SKEW * p.y, y: TILT * p.y - LIFT * z };
}

/** SVG transform from a level's image pixels to view units (building metres, or projected in 3D). */
export function floorTransform(floor: SizedFloor, z: number, mode: ViewMode): string {
  return rectTransform(floor, floorRect(floor), z, mode);
}

/** As floorTransform, for the level's image drawn into a given rect (the draft while aligning). */
export function rectTransform(floor: SizedFloor, rect: Rect, z: number, mode: ViewMode): string {
  const s = rect.w / floor.width;
  if (mode === '2d') return `matrix(${s} 0 0 ${s} ${rect.x} ${rect.y})`;
  return `matrix(${s} 0 ${SKEW * s} ${TILT * s} ${rect.x + SKEW * rect.y} ${TILT * rect.y - LIFT * z})`;
}

/** Resizes the rect by dragging a corner, keeping its aspect ratio and the opposite corner fixed. */
export function resizeFromCorner(rect: Rect, corner: Corner, pointer: Point): Rect {
  const sx = corner.endsWith('e') ? 1 : -1;
  const sy = corner.startsWith('s') ? 1 : -1;
  const ax = sx > 0 ? rect.x : rect.x + rect.w;
  const ay = sy > 0 ? rect.y : rect.y + rect.h;
  const aspect = rect.w / rect.h;
  // Signed, so dragging past the opposite corner shrinks to the minimum instead of flipping.
  const w = Math.max(1, sx * (pointer.x - ax), sy * (pointer.y - ay) * aspect);
  const h = w / aspect;
  return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
}

/**
 * What align mode saves: the position, plus the scale when the level was resized or already
 * had one, so merely moving an unscaled level doesn't turn the 20 m guess into a scale.
 */
export function alignPatch(floor: SizedFloor, rect: Rect): { x: number; y: number; pxPerMetre?: number } {
  const resized = Math.abs(rect.w - floorRect(floor).w) > 1e-9;
  return floor.pxPerMetre || resized ? { x: rect.x, y: rect.y, pxPerMetre: floor.width / rect.w } : { x: rect.x, y: rect.y };
}

/** New top-left corner that keeps the level's centre in place when its scale changes. */
export function rescaleAboutCentre(floor: SizedFloor, newPxPerMetre: number): Point {
  const r = floorRect(floor);
  const w = floor.width / newPxPerMetre;
  const h = floor.height / newPxPerMetre;
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2 };
}

/** Distance in metres between two placed devices, including the height between levels. */
export function linkDistance(floors: Floor[], placements: Record<string, Placement>, a: string, b: string): number | null {
  const pa = placements[a];
  const pb = placements[b];
  const fa = floors.find((f) => f.id === pa?.floorId);
  const fb = floors.find((f) => f.id === pb?.floorId);
  if (!pa || !pb || !isSized(fa) || !isSized(fb) || !fa.pxPerMetre || !fb.pxPerMetre) return null;
  const z = elevations(floors);
  const p = placementPoint(fa, pa);
  const q = placementPoint(fb, pb);
  return Math.hypot(p.x - q.x, p.y - q.y, z.get(fa.id)! - z.get(fb.id)!);
}
