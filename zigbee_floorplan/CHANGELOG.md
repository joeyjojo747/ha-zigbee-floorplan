# Changelog

## 0.7.0

- **Names** checkbox next to the link filters shows or hides device names on the map, in
  2D and 3D (3D now labels every device, not just the one under the pointer). The selected
  device is always labelled. Remembered per browser.

## 0.6.1

- **Hologram**: links are bolder and glow, in 2D and 3D. In 3D they keep the same width on
  screen however far you zoom out.

## 0.6.0

- **Themes**: a theme menu in the header (the half-moon button) chooses Auto, Light, Dark
  or the new **Hologram** theme: a dark blueprint with glowing cyan walls, neon links and
  devices, in 2D and 3D.

## 0.5.1

- **Show levels**: the Faint/Hidden setting is replaced by a chip per level, so you can
  turn each level on or off, in 2D and 3D. The level you're working on is always shown.
  If you had other levels hidden, they start turned off.

## 0.5.0

- **Walls**: detect the walls on a plan automatically (in the browser, nothing is
  uploaded), then fix them up: delete wrong ones, draw missing ones.
- **3D model**: the 3D view is now a real 3D scene (three.js) with each plan at its
  level, walls standing, and devices and links in between. Orbit, pan and zoom; click a
  device to select it.
- Each link in the device panel shows how many walls or floors it passes through.
- The 3D view loads only when opened, so the page is lighter.

## 0.4.2

- Align mode stays on when you pick another level, so you can align several levels in
  one go. **Done** saves every level you moved; **Cancel** or Esc drops them all.

## 0.4.1

- Add-on icon and logo in the add-on store.

## 0.4.0

- All levels now share one panel with one pan and zoom. The level tabs pick the level
  you're working on; the others are drawn faint underneath, or hidden.
- **Align**: drag a level to line it up with the others (e.g. onto the site plan) and
  drag a corner to resize it. Resizing sets the level's scale.
- **Floor heights** in the Levels dialog (floor to floor, 2.4 m by default; 0 for a level
  at the same height as the one above, such as a site plan).
- **3D** view: levels stacked by height, with links between floors drawn between them.
- Link distances include the height between floors.
- The side-by-side All levels view is replaced by the above.

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
