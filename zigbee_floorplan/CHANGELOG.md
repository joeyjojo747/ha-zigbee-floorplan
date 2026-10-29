# Changelog

## 0.3.0

- **All levels** view: every level side by side, with links between levels drawn
  across the panels. Each panel pans and zooms on its own and the lines follow.
- Selecting a device highlights its links on every level, with LQI labels.
- Devices can be placed and moved on any panel in the All levels view.

## 0.2.0

- Floorplan editor: add levels with a floorplan image, rename, reorder, replace or delete them.
- Place devices by clicking them in the tray and then the plan; drag to move.
- Links drawn between placed devices, coloured by signal quality, with filters for
  parent–child, router-neighbour and unmeasured links.
- Click a device for its details and every link with LQI in both directions;
  neighbours on other levels are marked and one click away.
- Set each level's scale from a known distance to see a scale bar and link distances.
- Device and link tables moved to the List view. Dark mode dims the floorplan image.

## 0.1.1

- Install and update from a prebuilt image instead of building on the device.
- Base image settings moved from the deprecated `build.yaml` into the Dockerfile.

## 0.1.0

- Initial scaffold: add-on packaging with ingress and automatic MQTT setup.
- Network scan via Zigbee2MQTT, merged into one link per device pair.
- Placeholder page listing devices (linked, unlisted, orphaned) and links by quality.
