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

- `layout.json` — `{ floors: [{id, name, image, width, height, pxPerMetre, imageVersion}], placements: {ieee: {floorId, x, y}} }`
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
- All levels view (0.3.0): a grid of FloorCanvas panels plus one absolutely positioned
  SVG overlay for cross-level links. The overlay reads each marker's on-screen position
  from the DOM and re-measures when any panel reports a view change, so lines follow
  per-panel pan/zoom without re-rendering the panels. Endpoints of markers panned out
  of view are clamped to their panel's edge.
- Later: align levels to the site plan (offset/scale per level) to enable a ghost of
  the level above/below and a stacked 3D view like UniFi Design Center.

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
