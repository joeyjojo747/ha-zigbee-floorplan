// Floorplan layout: the levels (each with an image) and where each device sits.
// Pure functions so the rules are easy to test; Store persists the result.
// No Node imports: the web UI shares these types (crypto is a global in both).

export interface Floor {
  id: string;
  name: string;
  /** File name under floors/, or null until an image is uploaded. */
  image: string | null;
  /** Natural image size in pixels, as measured by the browser on upload. */
  width: number | null;
  height: number | null;
  /** Image pixels per real-world metre, or null until the scale is set. */
  pxPerMetre: number | null;
  /** Bumped on every image upload so browsers don't show a cached old image. */
  imageVersion: number;
  /** Where the image's top-left corner sits in the shared building frame, in metres. */
  x: number;
  y: number;
  /** Floor-to-floor height in metres; 0 puts the level above at the same elevation. */
  floorHeight: number;
}

export const DEFAULT_FLOOR_HEIGHT = 2.4;

/** Position as fractions (0–1) of the floor image, so a sharper image keeps placements. */
export interface Placement {
  floorId: string;
  x: number;
  y: number;
}

export interface Layout {
  /** In display order. */
  floors: Floor[];
  /** Keyed by device IEEE address. */
  placements: Record<string, Placement>;
}

export class LayoutError extends Error {
  constructor(readonly statusCode: 400 | 404, message: string) {
    super(message);
  }
}

export const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export const emptyLayout = (): Layout => ({ floors: [], placements: {} });

/** Fills in fields added since the layout was saved (position and height arrived in 0.4.0). */
export function normaliseLayout(layout: Layout): Layout {
  return {
    ...layout,
    floors: layout.floors.map((floor) => ({ ...floor, x: floor.x ?? 0, y: floor.y ?? 0, floorHeight: floor.floorHeight ?? DEFAULT_FLOOR_HEIGHT })),
  };
}

function findFloor(layout: Layout, id: string): Floor {
  const floor = layout.floors.find((f) => f.id === id);
  if (!floor) throw new LayoutError(404, `No level with id ${id}`);
  return floor;
}

function cleanName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) throw new LayoutError(400, 'Level name is required');
  if (name.trim().length > 60) throw new LayoutError(400, 'Level name must be 60 characters or fewer');
  return name.trim();
}

function positive(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new LayoutError(400, `${what} must be a positive number`);
  return value;
}

function position(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new LayoutError(400, 'Position must be a number');
  return value;
}

function floorHeight(value: unknown): number {
  if (typeof value !== 'number' || !(value >= 0 && value <= 20)) throw new LayoutError(400, 'Height must be between 0 and 20 m');
  return value;
}

export function addFloor(layout: Layout, name: unknown): Floor {
  const floor: Floor = {
    id: crypto.randomUUID().slice(0, 8), name: cleanName(name), image: null, width: null, height: null, pxPerMetre: null, imageVersion: 0,
    x: 0, y: 0, floorHeight: DEFAULT_FLOOR_HEIGHT,
  };
  layout.floors.push(floor);
  return floor;
}

export function updateFloor(
  layout: Layout,
  id: string,
  patch: { name?: unknown; pxPerMetre?: unknown; x?: unknown; y?: unknown; floorHeight?: unknown },
): Floor {
  const floor = findFloor(layout, id);
  // Validate everything before changing anything, so a bad field leaves the level as it was.
  const name = patch.name !== undefined ? cleanName(patch.name) : floor.name;
  const pxPerMetre = patch.pxPerMetre === undefined ? floor.pxPerMetre : patch.pxPerMetre === null ? null : positive(patch.pxPerMetre, 'Scale');
  const x = patch.x !== undefined ? position(patch.x) : floor.x;
  const y = patch.y !== undefined ? position(patch.y) : floor.y;
  const height = patch.floorHeight !== undefined ? floorHeight(patch.floorHeight) : floor.floorHeight;
  return Object.assign(floor, { name, pxPerMetre, x, y, floorHeight: height });
}

/** Puts the floors in the given order; every existing id must appear exactly once. */
export function reorderFloors(layout: Layout, ids: unknown): void {
  const current = layout.floors.map((f) => f.id);
  if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) {
    throw new LayoutError(400, 'Order must list every level exactly once');
  }
  layout.floors = ids.map((id) => findFloor(layout, id));
}

/** Removes the floor and the placements on it. Returns the image file to delete, if any. */
export function deleteFloor(layout: Layout, id: string): string | null {
  const floor = findFloor(layout, id);
  layout.floors = layout.floors.filter((f) => f !== floor);
  for (const [ieee, placement] of Object.entries(layout.placements)) {
    if (placement.floorId === id) delete layout.placements[ieee];
  }
  return floor.image;
}

/**
 * Records a new image for the floor. Returns the previous image file if its name changed.
 * The scale is carried over assuming the new image shows the same area.
 */
export function setFloorImage(layout: Layout, id: string, image: { contentType: string; width: unknown; height: unknown }): { floor: Floor; replaced: string | null } {
  const floor = findFloor(layout, id);
  const ext = IMAGE_TYPES[image.contentType];
  if (!ext) throw new LayoutError(400, 'Image must be JPEG, PNG or WebP');
  const width = positive(image.width, 'Image width');
  const height = positive(image.height, 'Image height');
  if (floor.pxPerMetre !== null && floor.width) floor.pxPerMetre *= width / floor.width;
  const previous = floor.image;
  floor.image = `${floor.id}.${ext}`;
  floor.width = width;
  floor.height = height;
  floor.imageVersion++;
  return { floor, replaced: previous !== floor.image ? previous : null };
}

export function setPlacement(layout: Layout, ieee: string, placement: { floorId?: unknown; x?: unknown; y?: unknown }): Placement {
  const { floorId, x, y } = placement;
  if (typeof floorId !== 'string') throw new LayoutError(400, 'floorId is required');
  findFloor(layout, floorId);
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new LayoutError(400, 'x and y must be numbers');
  }
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return (layout.placements[ieee] = { floorId, x: clamp(x), y: clamp(y) });
}

export function removePlacement(layout: Layout, ieee: string): void {
  delete layout.placements[ieee];
}
