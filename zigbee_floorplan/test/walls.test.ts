import { describe, expect, it } from 'vitest';
import type { Floor } from '../src/server/layout.js';
import { countCrossings, detectWalls, linkObstacles, type Pixels } from '../src/web/walls.js';

/** A white RGBA image with black rectangles. */
function image(width: number, height: number, rects: [number, number, number, number][]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x, y, w, h] of rects) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) data.set([0, 0, 0, 255], (j * width + i) * 4);
    }
  }
  return { width, height, data };
}

describe('detectWalls', () => {
  // A 160 × 110 px room with 6 px walls, a 1 px dimension line below it and a bold
  // 10 px blob of "text" in the middle.
  const room = image(200, 150, [
    [20, 20, 160, 6], [20, 124, 160, 6], [20, 20, 6, 110], [174, 20, 6, 110],
    [20, 140, 160, 1],
    [90, 70, 10, 10],
  ]);

  it('finds the four walls with their thickness and ignores thin lines and text', () => {
    const walls = detectWalls(room);
    expect(walls).toHaveLength(4);
    expect(walls).toEqual(expect.arrayContaining([
      { x1: 20, y1: 23, x2: 180, y2: 23, t: 6 },
      { x1: 20, y1: 127, x2: 180, y2: 127, t: 6 },
      { x1: 23, y1: 20, x2: 23, y2: 130, t: 6 },
      { x1: 177, y1: 20, x2: 177, y2: 130, t: 6 },
    ]));
  });

  it('splits a wall at a door gap', () => {
    const walls = detectWalls(image(200, 60, [[10, 20, 80, 6], [120, 20, 70, 6]]));
    expect(walls.map((w) => [w.x1, w.x2])).toEqual([[10, 90], [120, 190]]);
  });

  it('keeps a wall whole when a notch splits part of its thickness', () => {
    const img = image(200, 60, [[20, 20, 160, 8]]);
    for (let y = 24; y < 28; y++) img.data.set([255, 255, 255, 255], (y * 200 + 100) * 4); // notch in the lower half
    expect(detectWalls(img)).toEqual([{ x1: 20, y1: 24, x2: 180, y2: 24, t: 8 }]);
  });

  it('finds a wall along the edge of a tightly cropped plan', () => {
    expect(detectWalls(image(200, 60, [[0, 0, 200, 8]]))).toEqual([{ x1: 0, y1: 4, x2: 200, y2: 4, t: 8 }]);
  });

  it('skips solid filled areas', () => {
    expect(detectWalls(image(200, 200, [[50, 50, 100, 100]]))).toEqual([]);
  });
});

describe('crossings', () => {
  const walls = [{ x1: 50, y1: 0, x2: 50, y2: 100, t: 6 }, { x1: 0, y1: 50, x2: 100, y2: 50, t: 6 }];

  it('counts walls a straight line crosses, not ones it only touches at an end', () => {
    expect(countCrossings({ x: 10, y: 10 }, { x: 90, y: 90 }, walls)).toBe(2);
    expect(countCrossings({ x: 10, y: 10 }, { x: 40, y: 40 }, walls)).toBe(0);
    expect(countCrossings({ x: 10, y: 20 }, { x: 50, y: 20 }, walls)).toBe(0); // device on the wall
  });

  const level = (id: string, floorHeight: number, extra: Partial<Floor> = {}): Floor => ({
    id, name: id, image: `${id}.jpg`, width: 100, height: 100, pxPerMetre: 10, imageVersion: 1, x: 0, y: 0, floorHeight, walls: [], ...extra,
  });

  it('reports walls on one level and floors between levels', () => {
    const floors = [level('first', 2.4), level('ground', 2.4, { walls }), level('site', 0), level('lower', 2.4)];
    const placements = {
      a: { floorId: 'ground', x: 0.1, y: 0.1 }, b: { floorId: 'ground', x: 0.9, y: 0.9 },
      c: { floorId: 'lower', x: 0.5, y: 0.5 }, d: { floorId: 'first', x: 0.5, y: 0.5 }, e: { floorId: 'site', x: 0.2, y: 0.2 },
    };
    expect(linkObstacles(floors, placements, 'a', 'b')).toEqual({ walls: 2 });
    expect(linkObstacles(floors, placements, 'a', 'c')).toEqual({ floors: 1 });
    expect(linkObstacles(floors, placements, 'd', 'c')).toEqual({ floors: 2 });
    expect(linkObstacles(floors, placements, 'a', 'e')).toEqual({ floors: 0 }); // site plan shares the ground floor's height
    expect(linkObstacles(floors, placements, 'a', 'zz')).toBeNull();
  });
});
