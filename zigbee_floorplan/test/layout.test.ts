import { describe, expect, it } from 'vitest';
import {
  addFloor, deleteFloor, emptyLayout, LayoutError, normaliseLayout, removePlacement, reorderFloors, setFloorImage, setPlacement,
  updateFloor, type Layout,
} from '../src/server/layout.js';

const layoutWithFloors = (...names: string[]) => {
  const layout = emptyLayout();
  const floors = names.map((name) => addFloor(layout, name));
  return { layout, floors };
};

const expectError = (fn: () => unknown, statusCode: number, message: RegExp) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(LayoutError);
    expect((err as LayoutError).statusCode).toBe(statusCode);
    expect((err as LayoutError).message).toMatch(message);
    return;
  }
  throw new Error('expected a LayoutError');
};

describe('floors', () => {
  it('adds floors with trimmed names and unique ids', () => {
    const { layout, floors } = layoutWithFloors('  Ground ', 'First');
    expect(floors[0].name).toBe('Ground');
    expect(new Set(layout.floors.map((f) => f.id)).size).toBe(2);
  });

  it('rejects blank names', () => {
    expectError(() => addFloor(emptyLayout(), '  '), 400, /name/);
    expectError(() => addFloor(emptyLayout(), 42), 400, /name/);
  });

  it('renames and sets or clears the scale', () => {
    const { layout, floors } = layoutWithFloors('Ground');
    updateFloor(layout, floors[0].id, { name: 'Ground floor', pxPerMetre: 40 });
    expect(layout.floors[0]).toMatchObject({ name: 'Ground floor', pxPerMetre: 40 });
    updateFloor(layout, floors[0].id, { pxPerMetre: null });
    expect(layout.floors[0].pxPerMetre).toBeNull();
    expectError(() => updateFloor(layout, floors[0].id, { pxPerMetre: -1 }), 400, /Scale/);
    expectError(() => updateFloor(layout, 'nope', { name: 'x' }), 404, /No level/);
  });

  it('gives new levels a position and default height', () => {
    const { floors } = layoutWithFloors('Ground');
    expect(floors[0]).toMatchObject({ x: 0, y: 0, floorHeight: 2.4 });
  });

  it('sets position and height', () => {
    const { layout, floors } = layoutWithFloors('Ground');
    updateFloor(layout, floors[0].id, { x: -3.5, y: 12, floorHeight: 0 });
    expect(layout.floors[0]).toMatchObject({ x: -3.5, y: 12, floorHeight: 0 });
  });

  it('rejects bad position and height', () => {
    const { layout, floors } = layoutWithFloors('Ground');
    expectError(() => updateFloor(layout, floors[0].id, { x: 'a' }), 400, /Position/);
    expectError(() => updateFloor(layout, floors[0].id, { y: Infinity }), 400, /Position/);
    expectError(() => updateFloor(layout, floors[0].id, { floorHeight: -1 }), 400, /Height/);
    expectError(() => updateFloor(layout, floors[0].id, { floorHeight: 21 }), 400, /Height/);
  });

  it('fills in position and height for layouts saved before 0.4.0', () => {
    const old = {
      floors: [{ id: 'a', name: 'G', image: null, width: null, height: null, pxPerMetre: null, imageVersion: 0 }],
      placements: { p: { floorId: 'a', x: 0.5, y: 0.5 } },
    };
    const layout = normaliseLayout(old as unknown as Layout);
    expect(layout.floors[0]).toMatchObject({ x: 0, y: 0, floorHeight: 2.4 });
    expect(layout.placements.p).toEqual({ floorId: 'a', x: 0.5, y: 0.5 });
  });

  it('reorders only with a complete list of ids', () => {
    const { layout, floors } = layoutWithFloors('A', 'B', 'C');
    const [a, b, c] = floors.map((f) => f.id);
    reorderFloors(layout, [c, a, b]);
    expect(layout.floors.map((f) => f.name)).toEqual(['C', 'A', 'B']);
    expectError(() => reorderFloors(layout, [a, b]), 400, /every level/);
    expectError(() => reorderFloors(layout, [a, a, b]), 400, /every level/);
    expectError(() => reorderFloors(layout, [a, b, 'zz']), 400, /every level/);
  });

  it('deleting a floor removes its placements and returns its image', () => {
    const { layout, floors } = layoutWithFloors('Ground', 'First');
    setFloorImage(layout, floors[0].id, { contentType: 'image/jpeg', width: 700, height: 700 });
    setPlacement(layout, 'dev1', { floorId: floors[0].id, x: 0.5, y: 0.5 });
    setPlacement(layout, 'dev2', { floorId: floors[1].id, x: 0.5, y: 0.5 });
    expect(deleteFloor(layout, floors[0].id)).toBe(`${floors[0].id}.jpg`);
    expect(Object.keys(layout.placements)).toEqual(['dev2']);
    expect(layout.floors).toHaveLength(1);
  });
});

describe('floor images', () => {
  it('records size, bumps the version and reports a replaced file of another type', () => {
    const { layout, floors } = layoutWithFloors('Ground');
    const id = floors[0].id;
    const first = setFloorImage(layout, id, { contentType: 'image/jpeg', width: 700, height: 500 });
    expect(first.floor).toMatchObject({ image: `${id}.jpg`, width: 700, height: 500, imageVersion: 1 });
    expect(first.replaced).toBeNull();

    const same = setFloorImage(layout, id, { contentType: 'image/jpeg', width: 700, height: 500 });
    expect(same.replaced).toBeNull();

    const png = setFloorImage(layout, id, { contentType: 'image/png', width: 700, height: 500 });
    expect(png.replaced).toBe(`${id}.jpg`);
    expect(png.floor.imageVersion).toBe(3);
  });

  it('keeps the scale when a sharper image of the same plan is uploaded', () => {
    const { layout, floors } = layoutWithFloors('First');
    const id = floors[0].id;
    setFloorImage(layout, id, { contentType: 'image/jpeg', width: 330, height: 300 });
    updateFloor(layout, id, { pxPerMetre: 20 });
    setFloorImage(layout, id, { contentType: 'image/jpeg', width: 1320, height: 1200 });
    expect(layout.floors[0].pxPerMetre).toBe(80);
  });

  it('rejects unsupported types and missing sizes', () => {
    const { layout, floors } = layoutWithFloors('Ground');
    expectError(() => setFloorImage(layout, floors[0].id, { contentType: 'image/gif', width: 1, height: 1 }), 400, /JPEG/);
    expectError(() => setFloorImage(layout, floors[0].id, { contentType: 'image/png', width: NaN, height: 1 }), 400, /width/);
  });
});

describe('placements', () => {
  it('places, clamps to the image and moves between floors', () => {
    const { layout, floors } = layoutWithFloors('Ground', 'First');
    setPlacement(layout, 'dev', { floorId: floors[0].id, x: -0.2, y: 1.4 });
    expect(layout.placements.dev).toEqual({ floorId: floors[0].id, x: 0, y: 1 });
    setPlacement(layout, 'dev', { floorId: floors[1].id, x: 0.25, y: 0.75 });
    expect(layout.placements.dev).toEqual({ floorId: floors[1].id, x: 0.25, y: 0.75 });
    removePlacement(layout, 'dev');
    expect(layout.placements).toEqual({});
  });

  it('rejects unknown floors and bad coordinates', () => {
    const { layout, floors } = layoutWithFloors('Ground');
    expectError(() => setPlacement(layout, 'dev', { floorId: 'nope', x: 0, y: 0 }), 404, /No level/);
    expectError(() => setPlacement(layout, 'dev', { floorId: floors[0].id, x: '1', y: 0 }), 400, /numbers/);
    expectError(() => setPlacement(layout, 'dev', { x: 0, y: 0 }), 400, /floorId/);
  });
});
