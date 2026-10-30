# Zigbee Floorplan

Shows your Zigbee2MQTT network on your floorplan.

## Requirements

- The **Mosquitto broker** add-on. The broker address and credentials are picked up automatically.
- **Zigbee2MQTT** connected to that broker.

## Getting started

1. **Scan.** Click **Scan now**. Zigbee2MQTT queries every router, which takes a minute
   or two and adds traffic to the mesh, so avoid running it repeatedly. The last scan
   is kept until the next one.
2. **Add levels.** Click **+ Add level** (later **Levels…**), give it a name and choose a
   floorplan image (JPEG, PNG or WebP). Add one per floor, plus one for outdoors if you
   have outdoor devices. Levels can be renamed, reordered and given a sharper image later
   without losing placements.
3. **Set the scale** (optional). On a level, click **Set scale**, click both ends of
   something you know the length of (e.g. a wall with a dimension on the plan) and enter
   the distance. You get a scale bar and the distance of each link.
4. **Align and stack levels** (if you have more than one). List the levels top to bottom
   in **Levels…** and give each its floor-to-floor **height** (use 0 for a site plan, so it
   sits at the same height as the level above it). Then open a level, click **Align**, drag
   it into place over the others and drag a corner to resize it. Pick another level tab to
   align it too; **Done** saves every level you moved. Aligning
   every level onto a scaled site plan gives them all the right scale.
5. **Place devices.** Click a device in the **Not placed** list, then click where it is
   on the plan. Drag a device to move it. Select a device and click **Move** to put it on
   another level.
6. **Walls** (optional). On a level, click **Walls**, then **Detect walls**: the add-on
   finds the thick straight lines on the plan (in your browser; nothing is uploaded).
   Click a wrong one and press Delete (or **Delete wall**); drag to draw a missing one,
   holding Shift for an angled wall. Right-drag pans while you're in wall mode. Walls
   are shown in 3D and counted for each link.

## Reading the map

- **Markers:** purple square = coordinator, blue = router, green = end device.
  A red outline means *orphan* (in no neighbour table and not seen for a day); amber
  means *unlisted* (seen recently, but in no neighbour table).
- **Lines** are the links from the last scan, coloured by the weaker direction's link
  quality (LQI): green good (≥ 100), amber fair (50–99), red poor (< 50), grey dotted
  unmeasured (common for battery devices). Thicker lines are parent–child links.
- **Names** shows or hides the device names on the map (the selected device is always
  labelled).
- **Show** has a chip for each level with a plan: click one to turn that level on or off,
  in 2D and 3D. Levels that are on are drawn faint around the one you're working on,
  which is always shown. **⇅ n** next to a device means it has *n* links to devices on
  levels that are turned off.
- **3D** shows a model of the building: each level's plan at its height, with its walls
  standing and the devices and links in between. Drag to orbit, right-drag to pan,
  scroll to zoom; hover a device for its name and click it to select it. Switch back to
  2D to place, move, align, set the scale or edit walls.
- **Click a device** to highlight its links and see each one with LQI in both directions
  ("hears it" is how well this device hears the other), its role, the distance
  (including the height between floors, once both levels have a scale) and how many
  walls or floors it passes through.

Mouse wheel zooms, dragging the background pans, and the buttons in the corner zoom and fit.

## Options

| Option | Default | Description |
|---|---|---|
| `base_topic` | `zigbee2mqtt` | Zigbee2MQTT's MQTT base topic. |
| `scan_timeout_seconds` | `300` | How long to wait for a network scan before giving up. |

Levels, images and placements are stored in the add-on's data folder and included in
Home Assistant backups.

## Theme

The half-moon button in the header picks the theme: **Auto** follows your device's light
or dark setting, or choose **Light**, **Dark** or **Hologram** (a dark blueprint look with
glowing lines, in 2D and 3D). The choice is remembered in your browser.
