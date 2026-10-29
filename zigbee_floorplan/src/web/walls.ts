// Walls on a plan: finding them in the image, and counting the walls (or floors) a link
// passes through. Pure, so it runs in the browser on canvas pixels and in tests.
import type { Floor, Placement, Wall } from './api';
import { elevations, isSized, type Point } from './geometry';

/** RGBA pixels, as from a canvas's getImageData. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const DARK_LUMINANCE = 110;

/**
 * Finds straight horizontal and vertical walls drawn as thick dark lines. Dark pixels are
 * eroded with a 3×3 square, which removes thin lines (text strokes, dimensions, hatching);
 * long runs of what's left are merged across neighbouring rows (or columns) into bands,
 * and each band becomes a wall with its measured thickness. Ends and centrelines are in
 * pixel-edge coordinates, so a wall filling pixels 20–179 runs from 20 to 180.
 */
export function detectWalls(image: Pixels): Wall[] {
  const { width, height, data } = image;
  const dark = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b, a] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
    dark[i] = a >= 128 && 0.299 * r + 0.587 * g + 0.114 * b < DARK_LUMINANCE ? 1 : 0;
  }
  const core = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1 && all; dx++) all = dark[(y + dy) * width + x + dx];
      core[y * width + x] = all;
    }
  }

  const minLength = Math.max(20, Math.round(0.03 * Math.max(width, height)));
  // Thicker than this is a filled area (a stair block, a shaded room), not a wall.
  const maxThickness = Math.max(12, 0.08 * Math.max(width, height));
  const walls: Wall[] = [];
  const horizontal = bands(width, height, (u, v) => core[v * width + u], minLength);
  const vertical = bands(height, width, (u, v) => core[u * width + v], minLength);
  // Erosion trimmed one pixel from every side; put it back.
  for (const b of horizontal) {
    const t = b.v1 - b.v0 + 3;
    if (t <= maxThickness) walls.push({ x1: b.u0 - 1, y1: (b.v0 + b.v1 + 1) / 2, x2: b.u1 + 2, y2: (b.v0 + b.v1 + 1) / 2, t });
  }
  for (const b of vertical) {
    const t = b.v1 - b.v0 + 3;
    if (t <= maxThickness) walls.push({ x1: (b.v0 + b.v1 + 1) / 2, y1: b.u0 - 1, x2: (b.v0 + b.v1 + 1) / 2, y2: b.u1 + 2, t });
  }
  return walls;
}

type Band = { u0: number; u1: number; v0: number; v1: number };

/** Runs along u of at least minLength, merged into bands across consecutive v. Inclusive ranges. */
function bands(lenU: number, lenV: number, at: (u: number, v: number) => number, minLength: number): Band[] {
  const done: Band[] = [];
  let open: Band[] = [];
  for (let v = 0; v < lenV; v++) {
    const next: Band[] = [];
    let u = 0;
    while (u < lenU) {
      if (!at(u, v)) { u++; continue; }
      const start = u;
      while (u < lenU && at(u, v)) u++;
      const end = u - 1;
      if (end - start + 1 < minLength) continue;
      const overlaps = (b: Band) => Math.min(b.u1, end) - Math.max(b.u0, start) + 1 >= 0.5 * Math.min(b.u1 - b.u0 + 1, end - start + 1);
      const i = open.findIndex(overlaps);
      // A run that overlaps a band another run already continued in this row (a notch split
      // the wall) joins that band rather than starting a thin duplicate.
      const same = next.find(overlaps);
      if (i >= 0) {
        const [b] = open.splice(i, 1);
        next.push({ u0: Math.min(b.u0, start), u1: Math.max(b.u1, end), v0: b.v0, v1: v });
      } else if (same) {
        same.u0 = Math.min(same.u0, start);
        same.u1 = Math.max(same.u1, end);
      } else {
        next.push({ u0: start, u1: end, v0: v, v1: v });
      }
    }
    done.push(...open);
    open = next;
  }
  return [...done, ...open].sort((a, b) => a.v0 - b.v0 || a.u0 - b.u0);
}

/** How many walls the straight line from a to b crosses, ignoring touches near either end. */
export function countCrossings(a: Point, b: Point, walls: Wall[]): number {
  let count = 0;
  for (const w of walls) {
    const dx = b.x - a.x, dy = b.y - a.y, ex = w.x2 - w.x1, ey = w.y2 - w.y1;
    const denom = dx * ey - dy * ex;
    if (denom === 0) continue;
    const s = ((w.x1 - a.x) * ey - (w.y1 - a.y) * ex) / denom; // along the link
    const r = ((w.x1 - a.x) * dy - (w.y1 - a.y) * dx) / denom; // along the wall
    if (s > 0.02 && s < 0.98 && r >= 0 && r <= 1) count++;
  }
  return count;
}

/** Walls a link crosses on its level, or floors it passes through between levels. */
export function linkObstacles(
  floors: Floor[], placements: Record<string, Placement>, a: string, b: string,
): { walls: number } | { floors: number } | null {
  const pa = placements[a];
  const pb = placements[b];
  const fa = floors.find((f) => f.id === pa?.floorId);
  const fb = floors.find((f) => f.id === pb?.floorId);
  if (!pa || !pb || !fa || !fb) return null;
  if (fa === fb) {
    if (!isSized(fa)) return null;
    const px = (p: Placement) => ({ x: p.x * fa.width, y: p.y * fa.height });
    return { walls: countCrossings(px(pa), px(pb), fa.walls) };
  }
  const z = elevations(floors);
  const [lo, hi] = [z.get(fa.id)!, z.get(fb.id)!].sort((x, y) => x - y);
  return { floors: new Set([...z.values()].filter((e) => e > lo && e <= hi)).size };
}
