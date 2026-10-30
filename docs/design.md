# Zigbee Floorplan — design

A Home Assistant add-on that draws the Zigbee2MQTT mesh on the house floorplan,
in the spirit of UniFi Design Center.

## Goals

- Place every Zigbee device on a floorplan image, one image per level.
- Draw the links Zigbee2MQTT reports between devices, coloured by signal quality.
- Make weak spots obvious: poor links, overloaded routers, orphaned devices.
- Install like any other add-on; open from the HA sidebar.

Non-goals (for now): RF simulation, editing Zigbee2MQTT config, controlling devices.

## Environment

| | |
|---|---|
| Home Assistant | HA OS 18.4, Core/Supervisor 2026.10.4 |
| Hardware | Raspberry Pi 4, 64-bit (`aarch64`) |
| Zigbee2MQTT | 2.14.2-1 add-on, base topic `zigbee2mqtt` |
| Broker | Mosquitto add-on |

## Architecture

```
Mosquitto ◄─MQTT─► Zigbee2MQTT
    ▲
    │ MQTT (credentials from Supervisor: services: mqtt:need)
┌───┴──────────── zigbee_floorplan add-on ─────────────┐
│ Node 22 / TypeScript                                 │
│  Fastify HTTP API + static web UI on :8099 (ingress) │
│  mqtt.js client → bridge/devices, networkmap scans   │
│  /data: layout.json, floor images, scans/            │
│ Web UI: React (+ Konva for the floorplan editor)     │
└──────────────────────────────────────────────────────┘
```

All browser URLs are relative so the UI works behind the ingress path prefix.

## Zigbee2MQTT data

| Purpose | Topic |
|---|---|
| Device list (retained) | `zigbee2mqtt/bridge/devices` |
| Request scan | `zigbee2mqtt/bridge/request/networkmap` `{"type":"raw","routes":false,"transaction":"…"}` |
| Scan result | `zigbee2mqtt/bridge/response/networkmap` |

### Findings from the real network (2026-10-29 capture)

- 22 devices: 1 coordinator, 6 routers, 15 end devices; 42 raw links.
- **Every router fails the routing-table request** (Tuya plugs, ZY_HPS01).
  Route data is therefore useless; scans use `routes: false` and the design
  relies on neighbour (LQI) tables only.
- Each raw link is one device's view of one neighbour:
  `target` = the device whose neighbour table it is (the reporter),
  `source` = the neighbour, `lqi` = how well the reporter hears the neighbour,
  `relationship` = the neighbour's role relative to the reporter
  (0 parent, 1 child, 2 sibling, 3 none, 4 previous child).
- Links are asymmetric (`workshop_presence` hears the coordinator at 24, the coordinator
  hears it at 101) and sometimes duplicated.
- `lqi: 0` is common for sleepy end devices — it means "not measured", not "dead".
- `lastSeen` is unreliable for some devices (coordinator, `tuya_smartplug_10`).

### Normalised model (`buildNetwork`)

- **Links** are merged per unordered device pair. Each keeps both directional
  reports; `lqi` is the weakest *measured* value (0 ignored, `null` when none).
- **Quality**: `good` ≥ 100, `fair` 50–99, `poor` < 50, `unknown` when unmeasured.
- **Parent/child** is taken from any report that says so.
- **Device status**:
  - `linked` — appears in at least one link.
  - `unlisted` — in no link but seen within 24 h (e.g. `garage_light`).
  - `orphan` — in no link and not seen for 24 h (e.g. `workshop_main_motion`).
- Scan failures (`failed: ["routingTable"]`) are kept per device for display.

## Floorplans

Four levels, each with its own image and scale (pixels per metre, set by drawing
a line over a known dimension):

| Level | Image | Scale reference |
|---|---|---|
| Site / outdoor | `site_plan_floorplan.jpg` | boundary 91.485 m |
| Lower ground | `chepy_floorplan_LG.jpg` | garage 7.9 m |
| Ground | `floorplan_ground_floor.jpg` | to be measured |
| First | `floorplan_first_floor.jpg` | to be measured |

Device positions are stored as fractions (0–1) of the image size, so a sharper
replacement image keeps placements. Links between levels render as a stub with
an "↑ / ↓ level" badge.

## Storage (`/data`)

- `layout.json` — `{ floors: [{id, name, image, width, height, pxPerMetre, imageVersion, x, y, floorHeight}], placements: {ieee: {floorId, x, y}} }`
  (floors in display order; image size is measured by the browser on upload)
- `floors/<id>.<ext>` — uploaded images
- `scans/latest.json` — last raw scan; history (SQLite) comes later.

Layout changes are serialised and applied to a copy, so a failed change never
leaves a half-written layout. Rules live in `src/server/layout.ts` (pure, tested).

## HTTP API

| Method | Path | |
|---|---|---|
| GET | `api/status` | MQTT connection, last scan time, scan in progress |
| GET | `api/network` | normalised network from the latest scan |
| POST | `api/scan` | trigger a scan (one at a time) |
| GET | `api/layout` | levels and placements |
| POST | `api/floors` | add a level `{name}` |
| PATCH | `api/floors/:id` | rename / set scale `{name?, pxPerMetre?}` |
| PUT | `api/floors/order` | reorder `{ids}` |
| DELETE | `api/floors/:id` | delete a level and its placements |
| PUT | `api/floors/:id/image?width&height` | upload image (raw JPEG/PNG/WebP body) |
| GET | `api/floors/:id/image?v=` | the image (cached; `v` is `imageVersion`) |
| PUT / DELETE | `api/placements/:ieee` | place `{floorId, x, y}` / unplace a device |

## Editor (UI)

- One SVG per level in image-pixel units: image, links, markers. Markers and labels are
  scaled by the current zoom so they keep a constant on-screen size.
- Place: pick a device in the tray, click the plan. Move: drag. Escape cancels.
- Links are drawn when both ends are on the shown level; links to other levels show as
  a "⇅ n" badge and in the details panel, where clicking jumps to that level.
- Scale tool: two clicks plus a known distance gives `pxPerMetre`.
- All levels view (0.3.0): a grid of FloorCanvas panels with an overlay for cross-level
  links. Replaced in 0.4.0 by the building view below.

## Building view (0.4.0)

All levels in one panel with one pan/zoom, levels aligned to each other, and floor
heights — modelled on UniFi Design Center's align mode and 3D view.

### Model

- **Building frame:** a shared 2D coordinate space in metres (x right, y down, as on
  the plans). Each level is placed in it by its image's top-left corner and its scale:
  `building = (floor.x, floor.y) + imagePx / pxPerMetre`.
- New `Floor` fields: `x`, `y` (metres, default 0) and `floorHeight` (floor-to-floor metres,
  default 2.4, range 0–20).
- `pxPerMetre` is the level's scale for both the scale bar and alignment. A level with
  no scale is drawn as if 20 m wide (`width / 20` px per metre) until it is scaled or
  resized in align mode, which saves `pxPerMetre`.
- **Order and elevation:** levels are listed top to bottom. A level's elevation is the
  sum of the `floorHeight`s of the levels below it, so the bottom level is at 0. Height 0
  puts the level above at the same elevation; the site plan uses it to share the
  ground floor's elevation. Example: First (2.4), Ground (2.4), Site plan (0),
  Lower ground (2.4) → elevations 4.8, 2.4, 2.4, 0.
- Existing layouts load with `x = y = 0` and `floorHeight = 2.4`. Placements are unchanged
  (still 0–1 fractions of the image).
- Device position in 3D: building `(x, y)` plus the level's elevation as `z`. Link
  distance is the 3D distance when both levels have a scale, otherwise not shown.
- API: `PATCH api/floors/:id` also accepts `x`, `y` and `floorHeight`.

### View

- The plan view is the single panel. Level tabs pick the **active level**; the
  separate All levels tab and grid are removed.
- **Shown levels (0.5.1):** a Show chip per level with an image turns it on or off, in 2D and 3D. The active level is always shown, and every level is shown while aligning. Remembered per browser.
- **2D:** one SVG in building metres. Levels are drawn bottom to top; the active level
  is solid, others faint. Active-level devices are full strength, other levels' devices
  dimmed. A link is drawn when both its devices are visible. Placing, dragging and the
  scale tool work on the active level only.
- **3D:** each level is drawn with an SVG matrix that flattens it (y × 0.5) and lifts it
  by its elevation × an exaggeration factor so floors separate. Markers and labels are
  drawn upright at their projected positions, and links are straight lines between
  projected points, so links between floors are slanted lines. Select, pan and zoom
  only.
- Markers and labels keep a constant on-screen size, as before.

### Align mode

- **Align** (2D only) draws a frame around the active level: drag inside to move,
  drag a corner to resize with the aspect ratio kept (the opposite corner stays fixed).
- Other levels show underneath; the level being aligned is drawn at 60% opacity.
- **Done** saves `x`, `y` and `pxPerMetre`; **Esc** cancels.
- The Levels dialog gets a height field per level.

### Code

- `src/web/geometry.ts` (pure, tested): image px ↔ building metres, elevation per level,
  3D projection, aligned resize from a corner drag, 3D link distance.
- `layout.ts` validates the new fields; `FloorCanvas` is replaced by a building canvas
  that renders all levels; `AllLevels.tsx` is removed.
- Tests: geometry unit tests and layout tests for the new fields and migration;
  manual check on the dev server with the four plans.
- Not in this version: rotation, per-level attenuation, coverage.

## Walls and 3D model (0.5.0)

Turn each plan into walls, show a real 3D model of the house with the mesh in it, and
count the walls each link passes through.

- **Wall model:** `Floor.walls: {x1, y1, x2, y2, t}[]` in image pixels (centreline ends
  and thickness), default `[]`, at most 2000 per level. Replacing the image scales them.
  `PUT api/floors/:id/walls` replaces a level's walls; validated in `layout.ts`.
- **Detection** (`src/web/walls.ts`, pure, runs in the browser on the image's pixels):
  dark pixels (luminance < 110) are eroded with a 3×3 square, which removes thin lines
  (text strokes, dimension lines, hatching); long horizontal and vertical runs of what's
  left (≥ 3% of the image's longer side, min 20 px) are merged across adjacent rows or
  columns into bands, and each band becomes one wall with its measured thickness.
  Axis-aligned only; angled walls are drawn by hand.
- **Wall editor** (2D, active level): **Walls** mode draws the walls over the plan.
  **Detect walls** replaces them with the detected set; click a wall and press Delete
  (or the button) to remove it; drag on the plan to draw one, snapped to horizontal or
  vertical unless Shift is held. Each change is saved straight away.
- **3D view:** the 3D toggle shows a three.js scene instead of the flattened view.
  Building metres map to three.js as x → X, y → Z, elevation → Y. Each level is a slab
  textured with its plan; walls are boxes as tall as the level's `floorHeight` (1 m when
  0); devices are coloured markers 1 m above their level; links are lines coloured by
  quality. Orbit, pan and zoom with OrbitControls; hovering shows a device's name;
  clicking selects it. Other shown levels are see-through.
- **Wall counts:** for a link on one level, the number of that level's walls its straight
  line crosses (touching within 2% of either end doesn't count); for a link between
  levels, the number of floors it passes through. Shown with each link in the device panel.
- Not in this version: rooms, doors and windows as objects, coverage.

## Themes (0.6.0)

- A theme menu in the header offers Auto (follows the system), Light, Dark and Hologram.
  The choice is remembered per browser. The resolved theme is `data-theme` on `<html>`,
  set by an inline script in `index.html` before the first paint and kept in step by App
  (in a layout effect, so the 3D view reads the new colours when it rebuilds).
- **Hologram:** navy background with a blueprint grid; cyan outlines and glow on the
  controls; neon link and device colours. In 2D the plans are inverted and tinted cyan by a
  CSS filter, and the active level's walls are traced as glowing lines. In 3D the plan
  textures are recoloured on a canvas (ink becomes light), walls are additive translucent
  boxes with bright edges, and devices get additive halos instead of a bloom pass, so the
  view still renders only on change.

## Phases

1. **Scaffold** (0.1.x) — add-on packaging, MQTT client, scan + normalised
   network API, device and link tables, tests on real data, prebuilt images.
2. **Floorplan editor** (0.2.0) — levels with images and scale, tray and drag-to-place,
   links drawn and coloured with filters, device detail panel, cross-level links.
3. **Usability** — HA-area pre-sorting, scheduled scans, history, PNG export,
   label decluttering, pinch zoom.
4. **Insights** — weak-link and single-point-of-failure flags, LQI vs distance,
   estimated coverage overlay, suggested router spots, MQTT discovery sensors.

## Development

- No Node on the dev PC: all npm commands run in `node:24-alpine` via Docker
  (`scripts/dev.ps1`), with `node_modules` in a Docker volume (keeps it out of OneDrive).
- Offline mode: with `FIXTURE_DIR` set and no `MQTT_HOST`, the server serves the
  captured scan, so the UI can be developed without touching the real mesh.
- GitHub Actions builds multi-arch images to GHCR; the Pi pulls them (see README).
- The add-on store can only add **public** GitHub repositories.
