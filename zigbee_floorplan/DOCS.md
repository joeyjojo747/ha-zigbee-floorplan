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
4. **Place devices.** Click a device in the **Not placed** list, then click where it is
   on the plan. Drag a device to move it. Select a device and click **Move** to put it on
   another level.

## Reading the map

- **Markers:** purple square = coordinator, blue = router, green = end device.
  A red outline means *orphan* (in no neighbour table and not seen for a day); amber
  means *unlisted* (seen recently, but in no neighbour table).
- **Lines** are the links from the last scan, coloured by the weaker direction's link
  quality (LQI): green good (≥ 100), amber fair (50–99), red poor (< 50), grey dotted
  unmeasured (common for battery devices). Thicker lines are parent–child links.
- **⇅ n** next to a device: it has *n* links to devices on other levels.
- **Click a device** to highlight its links and see each one with LQI in both directions
  ("hears it" is how well this device hears the other), its role and the distance.

Mouse wheel zooms, dragging the background pans, and the buttons in the corner zoom and fit.

## Options

| Option | Default | Description |
|---|---|---|
| `base_topic` | `zigbee2mqtt` | Zigbee2MQTT's MQTT base topic. |
| `scan_timeout_seconds` | `300` | How long to wait for a network scan before giving up. |

Levels, images and placements are stored in the add-on's data folder and included in
Home Assistant backups.
