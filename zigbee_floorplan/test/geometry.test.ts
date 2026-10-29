import { describe, expect, it } from 'vitest';
import type { Floor } from '../src/server/layout.js';
import {
  alignPatch, buildingToImage, clampFraction, elevations, floorRect, floorTransform, imageToBuilding, linkDistance, metresPerPx,
  placementPoint, project, rescaleAboutCentre, resizeFromCorner, type SizedFloor,
} from '../src/web/geometry.js';

// A 400×200 px level at (10, 5) m, 20 px per metre: 20 × 10 m.
const floor = (overrides: Partial<Floor> = {}): SizedFloor => ({
  id: 'f', name: 'F', image: 'f.jpg', width: 400, height: 200, pxPerMetre: 20, imageVersion: 1, x: 10, y: 5, floorHeight: 2.4,
  ...overrides,
}) as SizedFloor;

describe('geometry', () => {
  it('uses the scale, or 20 m wide when unscaled', () => {
    expect(metresPerPx(floor())).toBe(0.05);
    expect(metresPerPx(floor({ pxPerMetre: null }))).toBe(0.05); // 20 / 400
    expect(floorRect(floor())).toEqual({ x: 10, y: 5, w: 20, h: 10 });
  });

  it('converts between image pixels and building metres both ways', () => {
    expect(imageToBuilding(floor(), { x: 200, y: 100 })).toEqual({ x: 20, y: 10 });
    expect(buildingToImage(floor(), { x: 20, y: 10 })).toEqual({ x: 200, y: 100 });
    expect(placementPoint(floor(), { floorId: 'f', x: 0.5, y: 0.5 })).toEqual({ x: 20, y: 10 });
  });

  it('clamps a building point to the level when placing', () => {
    expect(clampFraction(floor(), { x: 100, y: -50 })).toEqual({ x: 1, y: 0 });
    expect(clampFraction(floor(), { x: 15, y: 7.5 })).toEqual({ x: 0.25, y: 0.25 });
  });

  it('stacks elevations from the bottom, height 0 sharing the level above', () => {
    const fs = ['First', 'Ground', 'Site', 'Lower'].map((id, i) => floor({ id, floorHeight: i === 2 ? 0 : 2.4 }));
    expect([...elevations(fs)]).toEqual([['First', 4.8], ['Ground', 2.4], ['Site', 2.4], ['Lower', 0]]);
  });

  it('projects in 3D and leaves 2D alone', () => {
    expect(project({ x: 3, y: 4 }, 2, '2d')).toEqual({ x: 3, y: 4 });
    expect(project({ x: 3, y: 4 }, 2, '3d')).toEqual({ x: 3 + 0.4 * 4, y: 0.5 * 4 - 8 * 2 });
    expect(floorTransform(floor(), 0, '2d')).toBe('matrix(0.05 0 0 0.05 10 5)');
  });

  it('resizes from a corner keeping the aspect ratio and the opposite corner', () => {
    const r = { x: 0, y: 0, w: 20, h: 10 };
    expect(resizeFromCorner(r, 'se', { x: 40, y: 15 })).toEqual({ x: 0, y: 0, w: 40, h: 20 });
    expect(resizeFromCorner(r, 'nw', { x: -20, y: 0 })).toEqual({ x: -20, y: -10, w: 40, h: 20 });
    expect(resizeFromCorner(r, 'se', { x: -30, y: -30 })).toEqual({ x: 0, y: 0, w: 1, h: 0.5 }); // past the opposite corner
  });

  it('saves a scale from align mode only when the level was resized or already scaled', () => {
    const unscaled = floor({ pxPerMetre: null });
    expect(alignPatch(unscaled, { ...floorRect(unscaled), x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
    expect(alignPatch(unscaled, { x: 3, y: 4, w: 40, h: 20 })).toEqual({ x: 3, y: 4, pxPerMetre: 10 });
    expect(alignPatch(floor(), { ...floorRect(floor()), x: 3, y: 4 })).toEqual({ x: 3, y: 4, pxPerMetre: 20 });
  });

  it('keeps the centre when the scale changes', () => {
    expect(rescaleAboutCentre(floor(), 40)).toEqual({ x: 15, y: 7.5 });
  });

  it('measures links in 3D only when both levels are scaled', () => {
    const fs = [floor({ id: 'up', floorHeight: 3 }), floor({ id: 'down', floorHeight: 2.4 })];
    const p = { a: { floorId: 'up', x: 0, y: 0 }, b: { floorId: 'down', x: 0.15, y: 0.2 } };
    expect(linkDistance(fs, p, 'a', 'b')).toBeCloseTo(Math.hypot(3, 2, 2.4));
    fs[1].pxPerMetre = null;
    expect(linkDistance(fs, p, 'a', 'b')).toBeNull();
  });
});
