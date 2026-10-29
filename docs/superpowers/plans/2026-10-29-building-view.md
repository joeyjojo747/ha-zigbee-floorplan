# Building View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every level in one panel with one pan/zoom, let the user align levels to each other and set floor heights, with a 2D/3D toggle (add-on 0.4.0).

**Architecture:** Levels gain a position (`x`, `y` in metres) and a `floorHeight`; together with `pxPerMetre` they place each level's image in a shared "building" frame in metres. A new pure module `src/web/geometry.ts` does every coordinate conversion. A new `BuildingCanvas` renders all levels into one SVG (2D: building metres; 3D: an oblique projection), replacing `FloorCanvas` and the side-by-side `AllLevels` grid.

**Tech Stack:** TypeScript 7, React 19, plain SVG, Fastify 5, Vitest 5. All npm commands run through `.\scripts\dev.ps1` (Docker, no local Node).

**Spec:** `docs/design.md`, section "Building view (0.4.0)".

## Global Constraints

- Building frame: metres, x right, y down. `building = (floor.x, floor.y) + imagePx * metresPerPx(floor)`.
- `metresPerPx(floor)` = `1 / pxPerMetre`, or `20 / width` when the level has no scale.
- New `Floor` fields: `x`, `y` (metres, default 0, any finite number), `floorHeight` (metres, default 2.4, range 0–20 inclusive).
- Levels are ordered top to bottom; elevation = sum of `floorHeight` of the levels below; bottom level is 0.
- Existing `layout.json` without the new fields loads with `x = y = 0`, `floorHeight = 2.4`; placements unchanged.
- 3D projection: `TILT = 0.5`, `SKEW = 0.4`, `LIFT = 5` — screen `x' = x + SKEW·y`, `y' = TILT·y − LIFT·z`.
- Align mode: aligned level at 60% opacity; corner resize keeps aspect ratio and the opposite corner fixed; minimum width 1 m.
- Placing, dragging, scale tool and Align work on the active level, in 2D only. 3D is select, pan and zoom.
- Markers and labels keep a constant on-screen size (multiply by `k`, building units per screen pixel).
- No rotation, attenuation or coverage.
- No git commits or pushes until the user approves; the version bump to 0.4.0 is done but not released.

## Review Focus

1. **Old data:** a `layout.json` from 0.3.0 and a remembered view of `'all'` in localStorage must load into the new view without errors (Task 1 migration test; Task 4 maps `'all'` → `'plan'`).
2. **A level with no image** in the stack: skipped when drawing, excluded from fit, Align disabled for it, its tab still shows the "Upload image" prompt (Task 3 renders only sized floors; Task 4 empty state).
3. **Dragging a corner past the opposite corner** must not flip or collapse the level (Task 2 `resizeFromCorner` min-size test).
4. **Placing or dragging outside the active level's image** clamps to the image edge, never to another level (Task 2 `buildingToImage` + clamp test via `clampFraction`).
5. **Scale tool on an aligned level:** scale points are image pixels of the active level, and saving a scale keeps the level's centre where it was (Task 2 `rescaleAboutCentre` test).

---

### Task 1: Level position and height in the layout model

**Files:**
- Modify: `zigbee_floorplan/src/server/layout.ts` (Floor, addFloor, updateFloor, new `normaliseLayout`)
- Modify: `zigbee_floorplan/src/server/store.ts:24-26` (loadLayout runs `normaliseLayout`)
- Modify: `zigbee_floorplan/src/server/index.ts:116` (PATCH body type)
- Modify: `zigbee_floorplan/src/web/api.ts:38` (updateFloor patch type)
- Test: `zigbee_floorplan/test/layout.test.ts`

**Interfaces:**
- Produces: `Floor` gains `x: number; y: number; floorHeight: number`. `DEFAULT_FLOOR_HEIGHT = 2.4`. `updateFloor(layout, id, patch: { name?; pxPerMetre?; x?; y?; floorHeight? })`. `normaliseLayout(raw: Layout): Layout` fills missing fields. `api.updateFloor(id, { name?; pxPerMetre?; x?; y?; floorHeight? })`.

- [ ] **Step 1: Write the failing tests** in `describe('floors')`:

```ts
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
  const old = { floors: [{ id: 'a', name: 'G', image: null, width: null, height: null, pxPerMetre: null, imageVersion: 0 }], placements: { p: { floorId: 'a', x: 0.5, y: 0.5 } } };
  const layout = normaliseLayout(old as unknown as Layout);
  expect(layout.floors[0]).toMatchObject({ x: 0, y: 0, floorHeight: 2.4 });
  expect(layout.placements.p).toEqual({ floorId: 'a', x: 0.5, y: 0.5 });
});
```

- [ ] **Step 2: Run** `.\scripts\dev.ps1 test` — Expected: the four new tests FAIL (missing fields / `normaliseLayout` not exported).

- [ ] **Step 3: Implement** in `layout.ts`: the three fields with doc comments, defaults in `addFloor`, `updateFloor` validation with messages `Position must be a number` and `Height must be between 0 and 20 m`, and `normaliseLayout` (spread defaults under each stored floor). `store.loadLayout` returns `normaliseLayout(...)`. Widen the PATCH body type in `index.ts` and the `api.updateFloor` patch type.

- [ ] **Step 4: Run** `.\scripts\dev.ps1 test` — Expected: all tests PASS (27).

### Task 2: Geometry module

**Files:**
- Create: `zigbee_floorplan/src/web/geometry.ts`
- Test: `zigbee_floorplan/test/geometry.test.ts`

**Interfaces:**
- Consumes: `Floor`, `Placement` from Task 1 (via `./api` re-exports).
- Produces (all pure; `SizedFloor = Floor & { width: number; height: number }`, `Point = { x: number; y: number }`, `Rect = { x: number; y: number; w: number; h: number }`, `Corner = 'nw' | 'ne' | 'sw' | 'se'`):
  - `metresPerPx(floor: SizedFloor): number`
  - `floorRect(floor: SizedFloor): Rect` — the level's image in building metres
  - `imageToBuilding(floor: SizedFloor, p: Point): Point` / `buildingToImage(floor: SizedFloor, p: Point): Point`
  - `placementPoint(floor: SizedFloor, placement: Placement): Point` — building metres
  - `clampFraction(floor: SizedFloor, p: Point): Point` — building point → placement fractions clamped to 0–1
  - `elevations(floors: Floor[]): Map<string, number>` — floors top to bottom
  - `project(p: Point, z: number, mode: '2d' | '3d'): Point` — identity in 2D
  - `floorTransform(floor: SizedFloor, z: number, mode: '2d' | '3d'): string` — SVG `matrix(...)` mapping image px to screen (building or projected) units
  - `resizeFromCorner(rect: Rect, corner: Corner, pointer: Point): Rect` — aspect kept, opposite corner fixed, `w ≥ 1`
  - `rescaleAboutCentre(floor: SizedFloor, pxPerMetre: number): Point` — new `{x, y}` so the centre stays put
  - `linkDistance(floors: Floor[], placements: Record<string, Placement>, a: string, b: string): number | null` — 3D metres when both levels have an image and `pxPerMetre`, else null
  - Constants `TILT = 0.5`, `SKEW = 0.4`, `LIFT = 5`, `UNSCALED_WIDTH_M = 20`.

- [ ] **Step 1: Write the failing tests** (a helper `floor(overrides)` builds a 400×200 px level at x=10, y=5, pxPerMetre=20, floorHeight 2.4):

```ts
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
  expect(project({ x: 3, y: 4 }, 2, '3d')).toEqual({ x: 3 + 0.4 * 4, y: 0.5 * 4 - 5 * 2 });
  expect(floorTransform(floor(), 0, '2d')).toBe('matrix(0.05 0 0 0.05 10 5)');
});

it('resizes from a corner keeping the aspect ratio and the opposite corner', () => {
  const r = { x: 0, y: 0, w: 20, h: 10 };
  expect(resizeFromCorner(r, 'se', { x: 40, y: 15 })).toEqual({ x: 0, y: 0, w: 40, h: 20 });
  expect(resizeFromCorner(r, 'nw', { x: -20, y: 0 })).toEqual({ x: -20, y: -10, w: 40, h: 20 });
  expect(resizeFromCorner(r, 'se', { x: -30, y: -30 })).toEqual({ x: 0, y: 0, w: 1, h: 0.5 }); // past the opposite corner
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
```

- [ ] **Step 2: Run** `.\scripts\dev.ps1 test` — Expected: geometry tests FAIL (module missing).

- [ ] **Step 3: Implement** `geometry.ts`. `floorTransform` composes image→building (`s = metresPerPx`, offset `floor.x, floor.y`) with the projection:
  2D `matrix(s 0 0 s x y)`; 3D `matrix(s 0 SKEW·s TILT·s x+SKEW·y TILT·y−LIFT·z)`. `resizeFromCorner`: anchor = opposite corner; with `sx, sy = ±1` pointing from the anchor towards the dragged corner, new width = `max(1, sx·(px−ax), sy·(py−ay)·aspect)` (signed, so crossing the anchor collapses to the 1 m minimum instead of flipping); height = width / aspect; the rect extends from the anchor in the `sx, sy` direction.

- [ ] **Step 4: Run** `.\scripts\dev.ps1 test` — Expected: all PASS.

### Task 3: BuildingCanvas

**Files:**
- Create: `zigbee_floorplan/src/web/BuildingCanvas.tsx` (replaces `FloorCanvas.tsx`; move `linkShown`, `LinkFilters`, `Point`, `ScaleBar` into it)
- Delete: `zigbee_floorplan/src/web/FloorCanvas.tsx`, `zigbee_floorplan/src/web/AllLevels.tsx`

**Interfaces:**
- Consumes: Task 2 geometry functions.
- Produces:

```ts
export type ViewMode = '2d' | '3d';
export type OtherLevels = 'hidden' | 'faint';
interface Props {
  floors: Floor[];                 // all levels, top to bottom
  activeId: string;
  mode: ViewMode;
  others: OtherLevels;
  devices: Map<string, NetworkDevice>;
  links: NetworkLink[];
  placements: Record<string, Placement>;
  filters: LinkFilters;
  selected: string | null;
  onSelect: (ieee: string | null) => void;
  placing: string | null;
  onPlace: (ieee: string, floorId: string, x: number, y: number) => void;   // fractions
  scalePoints: Point[] | null;     // image px of the active level
  onScalePoint: (p: Point) => void;
  align: Rect | null;              // draft rect (building m) while aligning, else null
  onAlign: (rect: Rect) => void;
}
export function BuildingCanvas(props: Props): JSX.Element;
export function linkShown(l: NetworkLink, filters: LinkFilters): boolean;
```

- [ ] **Step 1: Implement** by adapting `FloorCanvas`: the SVG's units are building metres (2D) or projected units (3D). Draw sized floors in reverse list order (bottom first), each `<image>` inside `<g transform={floorTransform(...)}>`, class `plan` plus `faint` for non-active levels (`others === 'faint'`), skipping non-active levels when `others === 'hidden'`. While `align` is set, draw the active level from the draft rect (`matrix(rect.w/width 0 0 rect.h/height rect.x rect.y)`) at opacity 0.6 above the others, plus a frame with four corner handles: dragging inside moves the rect, dragging a handle calls `resizeFromCorner`; every change calls `onAlign`. Marker positions = `project(placementPoint(...), elevation, mode)`; markers on other levels get class `other-level`. Fit = bounding box of the projected corners of visible sized floors, padded 3%. Zoom limits: width between 2 m and 4× the fitted width. Placing/dragging/scale/align only in 2D on the active level: placing and dragging use `clampFraction`; scale clicks pass `buildingToImage(active, p)`; scale-line drawing converts back with `imageToBuilding`. `⇅ n` badges only when `others === 'hidden'`. `ScaleBar` takes `metresPerScreenPx = k` and is shown only in 2D.
- [ ] **Step 2: Add CSS** in `styles.css`: `.plan.faint { opacity: .25 }`, `.marker.other-level { opacity: .45 }`, `.align-frame` (dashed accent stroke, `fill: transparent; cursor: move`), `.align-handle` (accent fill, `cursor: nwse-resize` / `nesw-resize`); delete `.all-levels`, `.level-grid`, `.level-panel*`, `.cross-links` rules and the 760px `.level-grid` override.
- [ ] **Step 3: Run** `.\scripts\dev.ps1 run build` — Expected: fails only in `App.tsx`/`Sidebar.tsx` imports (fixed in Task 4).

### Task 4: Wire into the app, Levels dialog and sidebar

**Files:**
- Modify: `zigbee_floorplan/src/web/App.tsx`
- Modify: `zigbee_floorplan/src/web/LevelsDialog.tsx`
- Modify: `zigbee_floorplan/src/web/Sidebar.tsx:3,117-118`

**Interfaces:**
- Consumes: `BuildingCanvas` props (Task 3); `rescaleAboutCentre`, `floorRect`, `linkDistance` (Task 2); `api.updateFloor` with `x, y, floorHeight` (Task 1).

- [ ] **Step 1: App.tsx.** Remove `'all'` from the view type and the All levels tab; a remembered `'all'` becomes `'plan'`. New remembered state `mode: ViewMode` (`'2d'`) and `others: OtherLevels` (`'faint'`); new state `align: Rect | null`. Plan toolbar (when not placing/scaling/aligning): Legend, a segmented `2D | 3D`, an "Other levels" select (`Faint` / `Hidden`, shown when more than one level), and in 2D `Set scale` and `Align` buttons (Align disabled when the active level has no image or there is only one level). Align toolbar: "Drag to move, drag a corner to resize." + `Done` + `Cancel`; `Done` sends `api.updateFloor(id, { x: rect.x, y: rect.y, pxPerMetre: width / rect.w })` then reloads; `Cancel`/Esc clears `align`. Switching to 3D or another level cancels placing, scaling and aligning. `saveScale` also sends `rescaleAboutCentre(floor, newPxPerMetre)`. Render `BuildingCanvas` when the active level has an image, else the existing empty state. `DeviceTray` always gets the active floor.
- [ ] **Step 2: LevelsDialog.tsx.** Under each level's name add `<label>Height <input type="number" min=0 max=20 step=0.1 defaultValue={floor.floorHeight}/> m</label>`, saved on blur when changed, via `api.updateFloor(id, { floorHeight })`. Add a one-line hint above the list: "Listed top to bottom. Height is floor to floor; use 0 for a level at the same height as the one above, e.g. a site plan."
- [ ] **Step 3: Sidebar.tsx.** Replace `distanceMetres` with `linkDistance(floors, placements, ieee, other)`.
- [ ] **Step 4: Run** `.\scripts\dev.ps1 run build` and `.\scripts\dev.ps1 test` — Expected: build succeeds, all tests PASS.

### Task 5: Verify on the dev server, docs and version

**Files:**
- Modify: `zigbee_floorplan/config.yaml` (version `"0.4.0"`), `zigbee_floorplan/CHANGELOG.md`, `zigbee_floorplan/DOCS.md`

- [ ] **Step 1: Seed and serve.** Start `.\scripts\dev.ps1 serve` in the background, run the scratchpad `seed-layout.ps1` (four levels including the site plan, 22 placements), and set heights First 2.4 / Ground 2.4 / Site plan 0 / Lower ground 2.4.
- [ ] **Step 2: Check in the browser pane** (800×600): align Ground and Lower ground onto the site plan; reload and confirm the positions persisted; faint/hidden others; 3D shows four separated layers with slanted links from `workshop_presence` to the Coordinator; selecting a device in 3D highlights its links; placing and dragging clamp to the active level; scale tool on an aligned level keeps it centred; a 0.3.0 `layout.json` (copy without new fields) loads; no console errors; dark mode.
- [ ] **Step 3: Docs.** CHANGELOG 0.4.0 entry; DOCS.md: replace the All levels bullet with Align, Other levels, 2D/3D and floor heights.
- [ ] **Step 4: Report** to the user with a screenshot; commit and release only on their go-ahead.
